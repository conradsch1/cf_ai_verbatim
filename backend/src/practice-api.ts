import type { Env } from "./bindings";
import { sessionExists } from "./chunk";
import {
  expectedKeystrokes,
  inputsMatch,
  keystrokeMismatchFeedback,
  type KeystrokeMismatchFeedback,
} from "./keystrokes";
import { maskChunkForStep } from "./mask";
import type { PracticeState } from "./memorization-session";

const DO_ORIGIN = "http://memorization-session.internal";

export type PracticePayload = {
  ok: true;
  sessionId: string;
  currentChunkIndex: number;
  step: 1 | 2 | 3;
  step2ParityVariant: 0 | 1;
  totalChunks: number;
  maskedText: string;
  /** Verbatim chunk for inline practice UI. */
  chunkPlain: string;
  /** Concatenation of first `\w` per contributing token; same as server validation. */
  expectedFirstLetters: string;
  completedSession: boolean;
};

function doStub(env: Env, sessionId: string) {
  const id = env.MEMORIZATION_SESSION.idFromName(sessionId);
  return env.MEMORIZATION_SESSION.get(id);
}

async function syncPracticeDO(
  stub: DurableObjectStub,
  totalChunks: number
): Promise<PracticeState> {
  const res = await stub.fetch(
    new Request(`${DO_ORIGIN}/practice/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ totalChunks }),
    })
  );
  const data = (await res.json()) as { ok?: boolean; state?: PracticeState };
  if (!data.state) throw new Error("Durable Object sync failed");
  return data.state;
}

async function advanceDO(stub: DurableObjectStub): Promise<PracticeState> {
  const res = await stub.fetch(
    new Request(`${DO_ORIGIN}/practice/advance`, { method: "POST" })
  );
  const data = (await res.json()) as { state?: PracticeState };
  if (!data.state) throw new Error("Durable Object advance failed");
  return data.state;
}

async function retryDO(stub: DurableObjectStub): Promise<PracticeState> {
  const res = await stub.fetch(
    new Request(`${DO_ORIGIN}/practice/retry`, { method: "POST" })
  );
  const data = (await res.json()) as { state?: PracticeState };
  if (!data.state) throw new Error("Durable Object retry failed");
  return data.state;
}

async function loadOrderedChunks(
  db: D1Database,
  sessionId: string
): Promise<string[]> {
  const { results } = await db
    .prepare(
      "SELECT content FROM chunks WHERE session_id = ? ORDER BY chunk_index ASC"
    )
    .bind(sessionId)
    .all<{ content: string }>();
  return results.map((r) => r.content);
}

function currentChunkText(chunks: string[], state: PracticeState): string {
  if (chunks.length === 0) return "";
  if (state.completedSession) return chunks[chunks.length - 1] ?? "";
  const i = Math.min(state.currentChunkIndex, chunks.length - 1);
  return chunks[i] ?? "";
}

function normalizeStep(s: PracticeState["step"]): 1 | 2 | 3 {
  const n = Number(s);
  if (n === 1 || n === 2 || n === 3) return n;
  return 1;
}

function buildPracticePayload(
  sessionId: string,
  chunks: string[],
  state: PracticeState
): PracticePayload {
  const step = normalizeStep(state.step);
  const chunk = currentChunkText(chunks, state);
  const maskedText = maskChunkForStep(chunk, step, {
    step2Parity: state.step2ParityVariant,
  });
  const expectedFirstLetters = expectedKeystrokes(chunk);
  return {
    ok: true,
    sessionId,
    currentChunkIndex: state.currentChunkIndex,
    step,
    step2ParityVariant: state.step2ParityVariant,
    totalChunks: state.totalChunks,
    maskedText,
    chunkPlain: chunk,
    expectedFirstLetters,
    completedSession: state.completedSession,
  };
}

export async function getPracticePayload(
  env: Env,
  sessionId: string
): Promise<PracticePayload | { error: string; status: number }> {
  if (!(await sessionExists(env.db, sessionId))) {
    return { error: "Session not found", status: 404 };
  }
  const chunks = await loadOrderedChunks(env.db, sessionId);
  if (chunks.length === 0) {
    return { error: "No chunks for this session", status: 404 };
  }
  const stub = doStub(env, sessionId);
  const state = await syncPracticeDO(stub, chunks.length);
  return buildPracticePayload(sessionId, chunks, state);
}

export async function postPracticeCheck(
  env: Env,
  sessionId: string,
  input: string
): Promise<
  | { ok: true; correct: false; feedback: KeystrokeMismatchFeedback }
  | { ok: true; correct: true; practice: PracticePayload }
  | { error: string; status: number }
> {
  if (!(await sessionExists(env.db, sessionId))) {
    return { error: "Session not found", status: 404 };
  }
  const chunks = await loadOrderedChunks(env.db, sessionId);
  if (chunks.length === 0) {
    return { error: "No chunks for this session", status: 404 };
  }
  const stub = doStub(env, sessionId);
  const state = await syncPracticeDO(stub, chunks.length);

  if (state.completedSession) {
    const practice = await getPracticePayload(env, sessionId);
    if ("error" in practice) return practice;
    return { ok: true, correct: true, practice };
  }

  const chunk = currentChunkText(chunks, state);
  const expected = expectedKeystrokes(chunk);
  if (!inputsMatch(expected, input)) {
    return {
      ok: true,
      correct: false,
      feedback: keystrokeMismatchFeedback(chunk, input),
    };
  }

  const newState = await advanceDO(stub);
  const practice = buildPracticePayload(sessionId, chunks, newState);
  return { ok: true, correct: true, practice };
}

export async function postPracticeRetry(
  env: Env,
  sessionId: string
): Promise<PracticePayload | { error: string; status: number }> {
  if (!(await sessionExists(env.db, sessionId))) {
    return { error: "Session not found", status: 404 };
  }
  const chunks = await loadOrderedChunks(env.db, sessionId);
  if (chunks.length === 0) {
    return { error: "No chunks for this session", status: 404 };
  }
  const stub = doStub(env, sessionId);
  await syncPracticeDO(stub, chunks.length);
  await retryDO(stub);
  return getPracticePayload(env, sessionId);
}

export async function getSessionChunks(
  env: Env,
  sessionId: string
): Promise<{ ok: true; chunks: string[] } | { error: string; status: number }> {
  if (!(await sessionExists(env.db, sessionId))) {
    return { error: "Session not found", status: 404 };
  }
  const chunks = await loadOrderedChunks(env.db, sessionId);
  return { ok: true, chunks };
}
