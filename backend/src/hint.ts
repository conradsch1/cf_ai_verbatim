import type { Env } from "./bindings";
import { WORKERS_AI_LLAMA_3_3 } from "./constants";
import { loadChunksAndSyncPracticeState } from "./practice-api";
import { getWordPieceAt } from "./wordPieces";

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

function extractTextFromAiResult(result: unknown): string {
  if (typeof result === "object" && result !== null && "response" in result) {
    const r = (result as { response: unknown }).response;
    if (typeof r === "string") return r.trim();
  }
  if (typeof result === "string") return result.trim();
  return "";
}

/** Best-effort: reject if hint repeats the token or a long alphanumeric slice of it. */
function containsLeak(hint: string, rawToken: string): boolean {
  const h = hint.toLowerCase();
  const raw = rawToken.toLowerCase();
  if (h.includes(raw)) return true;
  const parts = raw.match(/\w+/g) ?? [];
  for (const p of parts) {
    if (p.length >= 4 && h.includes(p)) return true;
  }
  return false;
}

const HINT_SYSTEM = `You help someone memorize verbatim text. They type only the first letter of each word.

Rules:
- Output EXACTLY one or two short sentences with a single clue.
- The clue must be a synonym association, a rhyme hint, or a context clue about meaning or grammatical role.
- NEVER output the target word or obvious morphological variants (plural, possessive, -ed, -ing) of that word.
- Do not answer with only the first letter.
- No markdown, no code fences, no preamble.`;

const HINT_RETRY_SYSTEM = `${HINT_SYSTEM}

You must reply again: the previous attempt was invalid because it leaked the word. Use only indirect associations or scene context.`;

export type HintRequestBody = {
  sessionId?: unknown;
  chunkIndex?: unknown;
  wordIndex?: unknown;
};

export async function handleHintRequest(
  env: Env,
  body: HintRequestBody
): Promise<
  | { ok: true; hint: string }
  | { ok: false; error: string; status: number }
> {
  const sessionId =
    typeof body.sessionId === "string" && body.sessionId.trim()
      ? body.sessionId.trim()
      : "";
  const chunkIndex =
    typeof body.chunkIndex === "number" && Number.isFinite(body.chunkIndex)
      ? body.chunkIndex
      : typeof body.chunkIndex === "string"
        ? Number.parseInt(body.chunkIndex, 10)
        : NaN;
  const wordIndex =
    typeof body.wordIndex === "number" && Number.isFinite(body.wordIndex)
      ? body.wordIndex
      : typeof body.wordIndex === "string"
        ? Number.parseInt(body.wordIndex, 10)
        : NaN;

  if (!sessionId) {
    return { ok: false, error: "Missing sessionId", status: 400 };
  }
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    return { ok: false, error: "Invalid chunkIndex", status: 400 };
  }
  if (!Number.isInteger(wordIndex) || wordIndex < 0) {
    return { ok: false, error: "Invalid wordIndex", status: 400 };
  }

  const loaded = await loadChunksAndSyncPracticeState(env, sessionId);
  if (!loaded.ok) {
    return { ok: false, error: loaded.error, status: loaded.status };
  }

  const { chunks, state } = loaded;
  if (state.completedSession) {
    return {
      ok: false,
      error: "Practice session is already complete",
      status: 400,
    };
  }
  if (chunkIndex !== state.currentChunkIndex) {
    return {
      ok: false,
      error: "chunkIndex does not match current practice chunk",
      status: 400,
    };
  }
  if (chunkIndex >= chunks.length) {
    return { ok: false, error: "Invalid chunk index", status: 400 };
  }

  const chunk = chunks[chunkIndex] ?? "";
  const piece = getWordPieceAt(chunk, wordIndex);
  if (!piece) {
    return { ok: false, error: "wordIndex out of range for this chunk", status: 400 };
  }
  if (!piece.contributing) {
    return {
      ok: false,
      error: "No letter hint for this token (punctuation-only)",
      status: 400,
    };
  }

  const userContent = `Chunk (verbatim):
"""
${chunk}
"""

Word token index (whitespace-delimited words, same as the practice UI): ${wordIndex}

Target token (do NOT repeat this token or its letters in your reply): ${piece.raw}

Reply with one short clue only.`;

  async function runModel(system: string): Promise<string> {
    const result: unknown = await env.AI.run(WORKERS_AI_LLAMA_3_3, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
    });
    return extractTextFromAiResult(result);
  }

  try {
    let hint = await runModel(HINT_SYSTEM);
    if (!hint) {
      return { ok: false, error: "Empty hint from model", status: 502 };
    }
    if (containsLeak(hint, piece.raw)) {
      hint = await runModel(HINT_RETRY_SYSTEM);
      if (!hint || containsLeak(hint, piece.raw)) {
        return {
          ok: false,
          error: "Could not generate a safe hint; try again.",
          status: 502,
        };
      }
    }
    return { ok: true, hint };
  } catch (e) {
    return {
      ok: false,
      error: `Workers AI: ${formatAiError(e)}`,
      status: 502,
    };
  }
}
