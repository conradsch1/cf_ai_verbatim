import { useCallback, useEffect, useState } from "react";
import { PracticeInline } from "./PracticeInline";

const SESSION_STORAGE_KEY = "cf_ai_verbatim_session_id";

type ChunkResponse =
  | { ok: true; sessionId: string; chunks: string[] }
  | { ok: false; error: string };

type PracticePayload = {
  ok: true;
  sessionId: string;
  currentChunkIndex: number;
  step: 1 | 2 | 3;
  step2ParityVariant: 0 | 1;
  totalChunks: number;
  maskedText: string;
  chunkPlain: string;
  expectedFirstLetters: string;
  completedSession: boolean;
};

function isPracticePayload(
  data: unknown
): data is PracticePayload {
  return (
    typeof data === "object" &&
    data !== null &&
    "ok" in data &&
    (data as { ok: unknown }).ok === true &&
    "chunkPlain" in data &&
    typeof (data as { chunkPlain: unknown }).chunkPlain === "string"
  );
}

export default function App() {
  const [text, setText] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chunks, setChunks] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [practice, setPractice] = useState<PracticePayload | null>(null);
  const [practiceLoading, setPracticeLoading] = useState(false);
  const [practiceError, setPracticeError] = useState<string | null>(null);
  const [checkLoading, setCheckLoading] = useState(false);
  const [retryLoading, setRetryLoading] = useState(false);
  const [practiceResetSignal, setPracticeResetSignal] = useState(0);
  const [peekSource, setPeekSource] = useState(false);

  const practicing = !!(practice && !practice.completedSession);
  const showMemorizationAndChunks = !practicing || peekSource;

  useEffect(() => {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) setSessionId(stored);
  }, []);

  useEffect(() => {
    if (practice?.completedSession) {
      setPeekSource(false);
    }
  }, [practice?.completedSession]);

  const persistSession = useCallback((id: string) => {
    setSessionId(id);
    localStorage.setItem(SESSION_STORAGE_KEY, id);
  }, []);

  const clearSession = useCallback(() => {
    setSessionId(null);
    setChunks([]);
    setPractice(null);
    setPracticeError(null);
    setPracticeResetSignal(0);
    setPeekSource(false);
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }, []);

  const fetchPractice = useCallback(async (sid: string) => {
    setPeekSource(false);
    setPracticeLoading(true);
    setPracticeError(null);
    try {
      const res = await fetch(`/api/practice/${encodeURIComponent(sid)}`);
      const data: unknown = await res.json();
      if (!res.ok || !isPracticePayload(data)) {
        const msg =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : `Request failed (${res.status})`;
        setPracticeError(msg);
        setPractice(null);
        return;
      }
      setPractice(data);
      setPracticeResetSignal((n) => n + 1);
    } catch {
      setPracticeError("Network error — is the Worker running on port 8787?");
      setPractice(null);
    } finally {
      setPracticeLoading(false);
    }
  }, []);

  const submitChunk = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (sessionId) headers["X-Session-Id"] = sessionId;

      const res = await fetch("/api/chunk", {
        method: "POST",
        headers,
        body: JSON.stringify({
          text,
          ...(sessionId ? { sessionId } : {}),
        }),
      });

      const data = (await res.json()) as ChunkResponse;
      if (!res.ok || !data.ok) {
        const msg =
          data.ok === false ? data.error : `Request failed (${res.status})`;
        setError(msg);
        return;
      }
      persistSession(data.sessionId);
      setChunks(data.chunks);
      setPractice(null);
      setPeekSource(false);
    } catch {
      setError("Network error — is the Worker running on port 8787?");
    } finally {
      setLoading(false);
    }
  }, [text, sessionId, persistSession]);

  const submitRetry = useCallback(async () => {
    if (!sessionId) return;
    setPracticeError(null);
    setRetryLoading(true);
    try {
      const res = await fetch(
        `/api/practice/${encodeURIComponent(sessionId)}/retry`,
        { method: "POST" }
      );
      const data: unknown = await res.json();
      if (!res.ok || !isPracticePayload(data)) {
        const msg =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : `Request failed (${res.status})`;
        setPracticeError(msg);
        return;
      }
      setPractice(data);
      setPracticeResetSignal((n) => n + 1);
    } catch {
      setPracticeError("Network error");
    } finally {
      setRetryLoading(false);
    }
  }, [sessionId]);

  const startPractice = useCallback(() => {
    if (sessionId) void fetchPractice(sessionId);
  }, [sessionId, fetchPractice]);

  const handleCheckFailure = useCallback((message: string) => {
    setPracticeError(message);
    setPracticeResetSignal((n) => n + 1);
  }, []);

  const handlePracticeUpdate = useCallback((p: PracticePayload) => {
    setPractice(p);
    setPracticeError(null);
  }, []);

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">cf_ai_verbatim</h1>
          <p className="mt-2 text-slate-400">
            {practicing && !peekSource ? (
              <>
                You are practicing — the full passage and chunk list are hidden. Use{" "}
                <span className="text-slate-300">Peek</span> below to show them, or finish the
                session to return to chunking.
              </>
            ) : (
              <>
                Paste text below. Llama 3.3 (Workers AI) aims for ~7–30 word chunks at natural
                boundaries (tolerant sizing); results are stored in D1.
              </>
            )}
          </p>
        </div>

        {showMemorizationAndChunks && (
          <div className="flex flex-col gap-2">
            <label htmlFor="mem-text" className="text-sm font-medium text-slate-300">
              Text to memorize
            </label>
            <textarea
              id="mem-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              placeholder="Long passage, speech, creed…"
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void submitChunk()}
            disabled={loading || !text.trim()}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Chunking…" : "Chunk with AI"}
          </button>
          <button
            type="button"
            onClick={clearSession}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            New session
          </button>
          {sessionId && (
            <span className="text-xs text-slate-500">
              Session: <code className="text-slate-400">{sessionId.slice(0, 8)}…</code>
            </span>
          )}
        </div>

        {error && (
          <p className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}

        {chunks.length > 0 && showMemorizationAndChunks && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-medium text-slate-200">
              Chunks ({chunks.length})
            </h2>
            <ol className="list-decimal space-y-2 pl-5 text-slate-300">
              {chunks.map((c, i) => (
                <li key={i} className="leading-relaxed">
                  {c}
                </li>
              ))}
            </ol>
            {sessionId && (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={startPractice}
                  disabled={practiceLoading}
                  className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                >
                  {practiceLoading ? "Loading…" : "Start practice"}
                </button>
              </div>
            )}
          </section>
        )}

        {practicing && (
          <div className="flex flex-col gap-3 rounded-lg border border-emerald-900/50 bg-emerald-950/25 px-4 py-3">
            <p className="text-sm text-emerald-100/90">
              <span className="font-medium text-emerald-200">Practice mode.</span> Your full
              memorization text and chunk list are hidden so they cannot be used as a cheat sheet.
              Use <strong className="font-medium">Peek</strong> if you need them, or{" "}
              <strong className="font-medium">New session</strong> to start over.
            </p>
            <div>
              <button
                type="button"
                onClick={() => setPeekSource((p) => !p)}
                className="rounded-lg border border-emerald-700/80 bg-emerald-900/40 px-4 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-900/60"
              >
                {peekSource ? "Hide source & chunks again" : "Peek at source & chunks"}
              </button>
            </div>
          </div>
        )}

        {practice && sessionId && (
          <section className="flex flex-col gap-4 rounded-lg border border-slate-700 bg-slate-900/50 p-4">
            <h2 className="text-lg font-medium text-slate-200">Practice</h2>
            {practice.completedSession ? (
              <p className="text-emerald-400">
                Session complete — you finished all chunks through Step 3.
              </p>
            ) : (
              <>
                <PracticeInline
                  key={`${practice.sessionId}-${practice.currentChunkIndex}-${practice.step}-${practice.step2ParityVariant}-${practiceResetSignal}`}
                  payload={practice}
                  sessionId={sessionId}
                  checkLoading={checkLoading}
                  setCheckLoading={setCheckLoading}
                  onPracticeUpdate={handlePracticeUpdate}
                  onCheckFailure={handleCheckFailure}
                />
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void submitRetry()}
                    disabled={retryLoading || checkLoading || practice.completedSession}
                    className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                  >
                    {retryLoading ? "Retry…" : "Retry"}
                  </button>
                  {checkLoading && (
                    <span className="self-center text-sm text-slate-400">Checking…</span>
                  )}
                </div>
              </>
            )}
            {practiceError && (
              <p className="rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">
                {practiceError}
              </p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
