import { DurableObject } from "cloudflare:workers";
import {
  DEFAULT_SM2_STATE,
  type SM2State,
  calculateNextReview,
  type QualityScore,
} from "./sm2";

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
 */
export class MemorizationSession extends DurableObject {
  private sm2State: SM2State = { ...DEFAULT_SM2_STATE };
  private practice: PracticeState = defaultPractice();

  getSm2State(): SM2State {
    return { ...this.sm2State };
  }

  applyReview(quality: QualityScore): SM2State {
    this.sm2State = calculateNextReview(this.sm2State, quality);
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

    if (p.step === 1) {
      p.step = 2;
      p.step2ParityVariant = 0;
      return this.getPracticeState();
    }
    if (p.step === 2) {
      p.step = 3;
      p.step2ParityVariant = 0;
      return this.getPracticeState();
    }
    // step 3
    if (p.currentChunkIndex < p.totalChunks - 1) {
      p.currentChunkIndex += 1;
      p.step = 1;
      p.step2ParityVariant = 0;
    } else {
      p.completedSession = true;
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

    if (request.method === "POST" && path === "/practice/sync") {
      let body: { totalChunks?: number };
      try {
        body = (await request.json()) as { totalChunks?: number };
      } catch {
        return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
      }
      const n = typeof body.totalChunks === "number" ? body.totalChunks : 0;
      this.syncPracticeTotalChunks(n);
      return Response.json({ ok: true, state: this.getPracticeState() });
    }

    if (request.method === "POST" && path === "/practice/advance") {
      const state = this.advanceAfterSuccess();
      return Response.json({ ok: true, state });
    }

    if (request.method === "POST" && path === "/practice/retry") {
      const state = this.retryStep();
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
