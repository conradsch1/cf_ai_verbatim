import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./bindings";
import { handleChunkRequest, type ChunkRequestBody } from "./chunk";
import { MemorizationSession } from "./memorization-session";
import { handleHintRequest, type HintRequestBody } from "./hint";
import {
  getPracticePayload,
  getSessionChunks,
  postPracticeCheck,
  postPracticeRetry,
} from "./practice-api";

export type { Env } from "./bindings";

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    // Reflect request origin so local Vite (5173) and same-origin deployed Worker both work
    origin: (origin) => origin ?? "http://localhost:5173",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "X-Session-Id"],
  })
);

app.post("/api/chunk", async (c) => {
  let body: ChunkRequestBody;
  try {
    body = (await c.req.json()) as ChunkRequestBody;
  } catch {
    return c.json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const headerSession = c.req.header("X-Session-Id")?.trim();
  if (headerSession && !body.sessionId) {
    body = { ...body, sessionId: headerSession };
  }

  const result = await handleChunkRequest(c.env, body);
  if (!result.ok) {
    return c.json({ ok: false, error: result.error }, result.status);
  }
  return c.json({
    ok: true,
    sessionId: result.sessionId,
    chunks: result.chunks,
  });
});

app.post("/api/hint", async (c) => {
  let body: HintRequestBody;
  try {
    body = (await c.req.json()) as HintRequestBody;
  } catch {
    return c.json({ ok: false, error: "Invalid JSON body" }, 400);
  }
  const result = await handleHintRequest(c.env, body);
  if (!result.ok) {
    return c.json({ ok: false, error: result.error }, result.status);
  }
  return c.json({ ok: true, hint: result.hint });
});

app.post("/api/review", (c) =>
  c.json(
    {
      ok: false,
      deferred: true,
      message:
        "Spaced repetition (POST /api/review) is deferred. See README.md: Roadmap / future work.",
      endpoint: "/api/review",
    },
    501
  )
);

app.get("/api/session/:sessionId/chunks", async (c) => {
  const sessionId = c.req.param("sessionId")?.trim() ?? "";
  if (!sessionId) {
    return c.json({ ok: false, error: "Missing sessionId" }, 400);
  }
  const result = await getSessionChunks(c.env, sessionId);
  if ("error" in result) {
    return c.json({ ok: false, error: result.error }, result.status);
  }
  return c.json({ ok: true, sessionId, chunks: result.chunks });
});

app.get("/api/practice/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId")?.trim() ?? "";
  if (!sessionId) {
    return c.json({ ok: false, error: "Missing sessionId" }, 400);
  }
  const result = await getPracticePayload(c.env, sessionId);
  if ("error" in result) {
    return c.json({ ok: false, error: result.error }, result.status);
  }
  return c.json(result);
});

app.post("/api/practice/:sessionId/check", async (c) => {
  const sessionId = c.req.param("sessionId")?.trim() ?? "";
  if (!sessionId) {
    return c.json({ ok: false, error: "Missing sessionId" }, 400);
  }
  let body: { input?: unknown };
  try {
    body = (await c.req.json()) as { input?: unknown };
  } catch {
    return c.json({ ok: false, error: "Invalid JSON body" }, 400);
  }
  const input = typeof body.input === "string" ? body.input : "";
  const result = await postPracticeCheck(c.env, sessionId, input);
  if ("error" in result) {
    return c.json({ ok: false, error: result.error }, result.status);
  }
  if (!result.correct) {
    return c.json({
      ok: true,
      correct: false,
      feedback: result.feedback,
    });
  }
  return c.json({ ok: true, correct: true, practice: result.practice });
});

app.post("/api/practice/:sessionId/retry", async (c) => {
  const sessionId = c.req.param("sessionId")?.trim() ?? "";
  if (!sessionId) {
    return c.json({ ok: false, error: "Missing sessionId" }, 400);
  }
  const result = await postPracticeRetry(c.env, sessionId);
  if ("error" in result) {
    return c.json({ ok: false, error: result.error }, result.status);
  }
  return c.json(result);
});

app.get("/api/health", (c) => c.json({ ok: true }));

export default app;
export { MemorizationSession };
