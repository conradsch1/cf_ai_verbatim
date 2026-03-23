import { useCallback, useEffect, useState } from "react";

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
  completedSession: boolean;
};

type KeystrokeMismatchFeedback =
  | { kind: "length"; expectedLength: number; actualLength: number }
  | {
      kind: "mismatch";
      index: number;
      wordIndex: number;
      totalWords: number;
      expectedChar: string | null;
      actualChar: string | null;
      expectedLength: number;
      actualLength: number;
    };

type CheckResponse =
  | { ok: true; correct: false; feedback: KeystrokeMismatchFeedback }
  | { ok: true; correct: true; practice: PracticePayload }
  | { ok: false; error: string };

function formatMismatchFeedback(f: KeystrokeMismatchFeedback): string {
  if (f.kind === "length") {
    return `You entered ${f.actualLength} letter${f.actualLength === 1 ? "" : "s"}; this chunk needs ${f.expectedLength}.`;
  }
  const ec = f.expectedChar === null ? "(end)" : `"${f.expectedChar}"`;
  const ac =
    f.actualChar === null ? "nothing here yet" : `"${f.actualChar}"`;
  return `First difference at word ${f.wordIndex} of ${f.totalWords}: expected ${ec}, you had ${ac}. Try again or use Retry (Step 2 changes which words are hidden).`;
}

export default function App() {
  const [text, setText] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chunks, setChunks] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [practice, setPractice] = useState<PracticePayload | null>(null);
  const [practiceLoading, setPracticeLoading] = useState(false);
  const [practiceInput, setPracticeInput] = useState("");
  const [practiceError, setPracticeError] = useState<string | null>(null);
  const [checkLoading, setCheckLoading] = useState(false);
  const [retryLoading, setRetryLoading] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) setSessionId(stored);
  }, []);

  const persistSession = useCallback((id: string) => {
    setSessionId(id);
    localStorage.setItem(SESSION_STORAGE_KEY, id);
  }, []);

  const clearSession = useCallback(() => {
    setSessionId(null);
    setChunks([]);
    setPractice(null);
    setPracticeInput("");
    setPracticeError(null);
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }, []);

  const fetchPractice = useCallback(async (sid: string) => {
    setPracticeLoading(true);
    setPracticeError(null);
    try {
      const res = await fetch(`/api/practice/${encodeURIComponent(sid)}`);
      const data = (await res.json()) as PracticePayload | { ok: false; error: string };
      if (!res.ok || !("maskedText" in data) || data.ok !== true) {
        const msg =
          "error" in data && typeof data.error === "string"
            ? data.error
            : `Request failed (${res.status})`;
        setPracticeError(msg);
        setPractice(null);
        return;
      }
      setPractice(data);
      setPracticeInput("");
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
      setPracticeInput("");
    } catch {
      setError("Network error — is the Worker running on port 8787?");
    } finally {
      setLoading(false);
    }
  }, [text, sessionId, persistSession]);

  const submitCheck = useCallback(async () => {
    if (!sessionId || !practice || practice.completedSession) return;
    setPracticeError(null);
    setCheckLoading(true);
    try {
      const res = await fetch(
        `/api/practice/${encodeURIComponent(sessionId)}/check`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: practiceInput }),
        }
      );
      const data = (await res.json()) as CheckResponse;
      if (!res.ok || data.ok === false) {
        const msg =
          "error" in data && typeof data.error === "string"
            ? data.error
            : `Request failed (${res.status})`;
        setPracticeError(msg);
        return;
      }
      if (!data.correct) {
        setPracticeError(
          "feedback" in data && data.feedback
            ? formatMismatchFeedback(data.feedback)
            : "Not quite — try again or use Retry (Step 2 changes which words are hidden)."
        );
        return;
      }
      setPractice(data.practice);
      setPracticeInput("");
      setPracticeError(null);
    } catch {
      setPracticeError("Network error");
    } finally {
      setCheckLoading(false);
    }
  }, [sessionId, practice, practiceInput]);

  const submitRetry = useCallback(async () => {
    if (!sessionId) return;
    setPracticeError(null);
    setRetryLoading(true);
    try {
      const res = await fetch(
        `/api/practice/${encodeURIComponent(sessionId)}/retry`,
        { method: "POST" }
      );
      const data = (await res.json()) as PracticePayload | { ok: false; error: string };
      if (!res.ok || !("maskedText" in data) || data.ok !== true) {
        const msg =
          "error" in data && typeof data.error === "string"
            ? data.error
            : `Request failed (${res.status})`;
        setPracticeError(msg);
        return;
      }
      setPractice(data);
    } catch {
      setPracticeError("Network error");
    } finally {
      setRetryLoading(false);
    }
  }, [sessionId]);

  const startPractice = useCallback(() => {
    if (sessionId) void fetchPractice(sessionId);
  }, [sessionId, fetchPractice]);

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">cf_ai_verbatim</h1>
          <p className="mt-2 text-slate-400">
            Paste text below. Llama 3.3 (Workers AI) aims for ~7–30 word chunks at natural
            boundaries (tolerant sizing); results are stored in D1.
          </p>
        </div>

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

        {chunks.length > 0 && (
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

        {practice && (
          <section className="flex flex-col gap-4 rounded-lg border border-slate-700 bg-slate-900/50 p-4">
            <h2 className="text-lg font-medium text-slate-200">Practice</h2>
            {practice.completedSession ? (
              <p className="text-emerald-400">
                Session complete — you finished all chunks through Step 3.
              </p>
            ) : (
              <>
                <p className="text-sm text-slate-400">
                  Chunk {practice.currentChunkIndex + 1} of {practice.totalChunks} — Step{" "}
                  {practice.step} of 3
                </p>
                <p className="rounded-md border border-slate-600 bg-slate-950/80 px-3 py-3 font-serif text-lg leading-relaxed text-slate-100">
                  {practice.maskedText}
                </p>
                <p className="text-xs text-slate-500">
                  Type the first letter of each word (same words as the hidden pattern); skip
                  punctuation. Case-insensitive; spaces in your input are ignored.
                </p>
                <input
                  type="text"
                  value={practiceInput}
                  onChange={(e) => setPracticeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submitCheck();
                  }}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  placeholder="Your answer…"
                  autoComplete="off"
                  spellCheck={false}
                />
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void submitCheck()}
                    disabled={checkLoading || practice.completedSession}
                    className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {checkLoading ? "Checking…" : "Check"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void submitRetry()}
                    disabled={retryLoading || practice.completedSession}
                    className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                  >
                    {retryLoading ? "Retry…" : "Retry"}
                  </button>
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
