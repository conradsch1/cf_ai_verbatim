import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./bindings";
import { handleChunkRequest, type ChunkRequestBody } from "./chunk";
import { MemorizationSession } from "./memorization-session";
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
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
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

app.post("/api/hint", (c) =>
  c.json({
    ok: true,
    message: "not implemented",
    endpoint: "/api/hint",
  })
);

app.post("/api/review", (c) =>
  c.json({
    ok: true,
    message: "not implemented",
    endpoint: "/api/review",
  })
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
