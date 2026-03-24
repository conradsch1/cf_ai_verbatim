import { DurableObject } from "cloudflare:workers";
import type { Env } from "./bindings";
import {
  DEFAULT_SM2_STATE,
  type SM2State,
  calculateNextReview,
  type QualityScore,
} from "./sm2";

const STORAGE_PRACTICE = "practice";
const STORAGE_SM2 = "sm2";

function coercePractice(raw: unknown): PracticeState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const totalChunks = Number(o.totalChunks);
  const currentChunkIndex = Number(o.currentChunkIndex);
  const step = Number(o.step);
  const pv = Number(o.step2ParityVariant);
  if (
    !Number.isFinite(totalChunks) ||
    totalChunks < 0 ||
    !Number.isFinite(currentChunkIndex) ||
    currentChunkIndex < 0
  ) {
    return null;
  }
  if (step !== 1 && step !== 2 && step !== 3) return null;
  if (pv !== 0 && pv !== 1) return null;
  return {
    totalChunks,
    currentChunkIndex,
    step: step as PracticeState["step"],
    step2ParityVariant: pv as PracticeState["step2ParityVariant"],
    completedSession: Boolean(o.completedSession),
  };
}

function coerceSm2(raw: unknown): SM2State | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const easinessFactor = Number(o.easinessFactor);
  const intervalDays = Number(o.intervalDays);
  const repetitions = Number(o.repetitions);
  if (
    !Number.isFinite(easinessFactor) ||
    !Number.isFinite(intervalDays) ||
    !Number.isFinite(repetitions)
  ) {
    return null;
  }
  return { easinessFactor, intervalDays, repetitions };
}

export type PracticeState = {
  totalChunks: number;
  currentChunkIndex: number;
  step: 1 | 2 | 3;
  step2ParityVariant: 0 | 1;
  completedSession: boolean;
};

const defaultPractice = (): PracticeState => ({
  totalChunks: 0,
  currentChunkIndex: 0,
  step: 1,
  step2ParityVariant: 0,
  completedSession: false,
});

/**
 * Per-session coordination: SM-2 (stub) + practice cursor (chunk, step, Step 2 parity).
 * Practice + SM-2 are persisted to DO storage so step survives DO eviction between requests.
 */
export class MemorizationSession extends DurableObject {
  private sm2State: SM2State = { ...DEFAULT_SM2_STATE };
  private practice: PracticeState = defaultPractice();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      const [pRaw, sRaw] = await Promise.all([
        this.ctx.storage.get<unknown>(STORAGE_PRACTICE),
        this.ctx.storage.get<unknown>(STORAGE_SM2),
      ]);
      const p = coercePractice(pRaw);
      if (p) this.practice = p;
      const s = coerceSm2(sRaw);
      if (s) this.sm2State = s;
    });
  }

  private async persistPractice(): Promise<void> {
    await this.ctx.storage.put(STORAGE_PRACTICE, this.practice);
  }

  private async persistSm2(): Promise<void> {
    await this.ctx.storage.put(STORAGE_SM2, this.sm2State);
  }

  getSm2State(): SM2State {
    return { ...this.sm2State };
  }

  async applyReview(quality: QualityScore): Promise<SM2State> {
    this.sm2State = calculateNextReview(this.sm2State, quality);
    await this.persistSm2();
    return this.getSm2State();
  }

  getPracticeState(): PracticeState {
    return { ...this.practice };
  }

  /** Align DO with D1 chunk count; reset cursor if count changes. */
  syncPracticeTotalChunks(totalChunks: number): void {
    if (this.practice.totalChunks !== totalChunks) {
      this.practice = {
        ...defaultPractice(),
        totalChunks,
      };
    }
  }

  /** Call only after a correct check. */
  advanceAfterSuccess(): PracticeState {
    const p = this.practice;
    if (p.completedSession || p.totalChunks === 0) return this.getPracticeState();

    // Use Number() so string "2" from any serialization path still matches (strict === would skip).
    const step = Number(p.step);
    if (step === 1) {
      p.step = 2;
      p.step2ParityVariant = 0;
      return this.getPracticeState();
    }
    if (step === 2) {
      p.step = 3;
      p.step2ParityVariant = 0;
      return this.getPracticeState();
    }
    if (step === 3) {
      if (p.currentChunkIndex < p.totalChunks - 1) {
        p.currentChunkIndex += 1;
        p.step = 1;
        p.step2ParityVariant = 0;
      } else {
        p.completedSession = true;
      }
      return this.getPracticeState();
    }
    return this.getPracticeState();
  }

  /** Retry after failed check: Step 2 toggles hidden-word parity; no advance. */
  retryStep(): PracticeState {
    const p = this.practice;
    if (p.completedSession || p.totalChunks === 0) return this.getPracticeState();
    if (p.step === 2) {
      p.step2ParityVariant = p.step2ParityVariant === 0 ? 1 : 0;
    }
    return this.getPracticeState();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && path === "/practice/state") {
      return Response.json(this.getPracticeState());
    }

    if (request.method === "POST" && path === "/practice/reset-for-chunks") {
      let body: { totalChunks?: number };
      try {
        body = (await request.json()) as { totalChunks?: number };
      } catch {
        return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
      }
      const n = typeof body.totalChunks === "number" ? body.totalChunks : 0;
      this.practice = { ...defaultPractice(), totalChunks: n };
      await this.persistPractice();
      return Response.json({ ok: true, state: this.getPracticeState() });
    }

    if (request.method === "POST" && path === "/practice/sync") {
      let body: { totalChunks?: number };
      try {
        body = (await request.json()) as { totalChunks?: number };
      } catch {
        return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
      }
      const n = typeof body.totalChunks === "number" ? body.totalChunks : 0;
      this.syncPracticeTotalChunks(n);
      await this.persistPractice();
      return Response.json({ ok: true, state: this.getPracticeState() });
    }

    if (request.method === "POST" && path === "/practice/advance") {
      const state = this.advanceAfterSuccess();
      await this.persistPractice();
      return Response.json({ ok: true, state });
    }

    if (request.method === "POST" && path === "/practice/retry") {
      const state = this.retryStep();
      await this.persistPractice();
      return Response.json({ ok: true, state });
    }

    return Response.json(
      {
        ok: true,
        message: "MemorizationSession",
        sm2: this.getSm2State(),
        practice: this.getPracticeState(),
      },
      { headers: { "content-type": "application/json" } }
    );
  }
}
