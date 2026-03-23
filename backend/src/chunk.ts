import type { Env } from "./bindings";
import { WORKERS_AI_LLAMA_3_3 } from "./constants";

const MAX_TEXT_CHARS = 32_000;
/** Prompt-only targets; the Worker does not reject chunks solely for word count outside this band. */
const CHUNK_TARGET_MIN_WORDS = 7;
const CHUNK_TARGET_MAX_WORDS = 30;

const CHUNK_SYSTEM = `You split prose into memorization-sized phrases. Rules:
- Each chunk must be a single contiguous substring of the user's text (copy verbatim; do not paraphrase).
- Aim for roughly ${CHUNK_TARGET_MIN_WORDS}-${CHUNK_TARGET_MAX_WORDS} words per chunk when it fits natural boundaries; shorter or longer segments are acceptable if required for coherent breaks.
- Break only at natural boundaries: commas, periods, semicolons, colons, or complete clauses (never mid-word).
- Preserve original punctuation and spacing inside each chunk.
- Cover the entire user text from start to finish with no gaps and no overlap between chunks.
- Output ONLY valid JSON with this exact shape: {"chunks":["...","..."]}
- No markdown, no code fences, no commentary.`;

/** Best-effort string for Workers AI / upstream failures (e.g. InferenceUpstreamError, code 1031). */
function formatAiError(e: unknown): string {
  if (e instanceof Error) {
    const withCause = e as Error & { cause?: unknown };
    const parts = [e.message];
    if (withCause.cause instanceof Error) {
      parts.push(withCause.cause.message);
    } else if (withCause.cause != null) {
      parts.push(String(withCause.cause));
    }
    return parts.filter(Boolean).join(" — ");
  }
  if (typeof e === "object" && e !== null && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

function getLlmText(result: unknown): string {
  if (typeof result === "object" && result !== null && "response" in result) {
    const r = (result as { response: unknown }).response;
    if (typeof r === "string") return r;
  }
  if (typeof result === "string") return result;
  return "";
}

/** Workers AI may return parsed JSON as `response: { chunks: string[] }` instead of a JSON string. */
function tryStructuredChunksFromAiResult(result: unknown): string[] | null {
  if (typeof result !== "object" || result === null || !("response" in result)) {
    return null;
  }
  const resp = (result as { response: unknown }).response;
  if (typeof resp !== "object" || resp === null || !("chunks" in resp)) {
    return null;
  }
  const arr = (resp as { chunks: unknown }).chunks;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const out: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    const c = arr[i];
    if (typeof c !== "string" || !c.trim()) return null;
    out.push(c.trim());
  }
  return out;
}

function parseChunksJson(raw: string): string[] {
  let s = raw.trim();
  const fence = /^```(?:json)?\s*/i;
  if (fence.test(s)) {
    s = s.replace(fence, "").replace(/\s*```\s*$/i, "").trim();
  }
  const parsed: unknown = JSON.parse(s);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("chunks" in parsed) ||
    !Array.isArray((parsed as { chunks: unknown }).chunks)
  ) {
    throw new Error("Missing chunks array");
  }
  const chunks = (parsed as { chunks: unknown[] }).chunks.map((c, i) => {
    if (typeof c !== "string" || !c.trim()) {
      throw new Error(`Invalid chunk at index ${i}`);
    }
    return c.trim();
  });
  if (chunks.length === 0) throw new Error("Empty chunks");
  return chunks;
}

export async function semanticChunkWithAi(env: Env, text: string): Promise<string[]> {
  let result: unknown;
  try {
    result = await env.AI.run(WORKERS_AI_LLAMA_3_3, {
      messages: [
        { role: "system", content: CHUNK_SYSTEM },
        {
          role: "user",
          content: `Split this text into chunks as JSON:\n\n${text}`,
        },
      ],
    });
  } catch (e) {
    throw new Error(`Workers AI: ${formatAiError(e)}`);
  }

  let chunks: string[];
  const structured = tryStructuredChunksFromAiResult(result);
  if (structured) {
    chunks = structured;
  } else {
    const raw = getLlmText(result);
    if (!raw) throw new Error("Empty model response");
    try {
      chunks = parseChunksJson(raw);
    } catch {
      throw new Error("Could not parse model JSON");
    }
  }

  return chunks;
}

async function sessionExists(db: D1Database, id: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS ok FROM sessions WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ ok: number }>();
  return row?.ok === 1;
}

export async function replaceChunksForSession(
  db: D1Database,
  sessionId: string,
  chunks: string[]
): Promise<void> {
  await db.prepare("DELETE FROM chunks WHERE session_id = ?").bind(sessionId).run();

  const stmts = chunks.map((content, chunkIndex) =>
    db
      .prepare(
        "INSERT INTO chunks (session_id, chunk_index, content) VALUES (?, ?, ?)"
      )
      .bind(sessionId, chunkIndex, content)
  );
  if (stmts.length > 0) await db.batch(stmts);
}

export type ChunkRequestBody = {
  text?: unknown;
  sessionId?: unknown;
};

export async function handleChunkRequest(
  env: Env,
  body: ChunkRequestBody
): Promise<
  | { ok: true; sessionId: string; chunks: string[] }
  | { ok: false; status: number; error: string }
> {
  const text = typeof body.text === "string" ? body.text : "";
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, status: 400, error: "Missing or empty text" };
  }
  if (trimmed.length > MAX_TEXT_CHARS) {
    return {
      ok: false,
      status: 400,
      error: `Text exceeds ${MAX_TEXT_CHARS} characters`,
    };
  }

  const db = env.db;
  let sessionId =
    typeof body.sessionId === "string" && body.sessionId.trim()
      ? body.sessionId.trim()
      : "";

  let createdNewSession = false;
  if (sessionId) {
    if (!(await sessionExists(db, sessionId))) {
      return { ok: false, status: 404, error: "sessionId not found" };
    }
  } else {
    sessionId = crypto.randomUUID();
    createdNewSession = true;
    await db
      .prepare("INSERT INTO sessions (id, created_at) VALUES (?, ?)")
      .bind(sessionId, Date.now())
      .run();
  }

  let chunks: string[];
  try {
    chunks = await semanticChunkWithAi(env, trimmed);
  } catch (e) {
    if (createdNewSession) {
      await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
    }
    const msg = e instanceof Error ? e.message : "Chunking failed";
    return { ok: false, status: 502, error: msg };
  }

  await replaceChunksForSession(db, sessionId, chunks);

  return { ok: true, sessionId, chunks };
}
