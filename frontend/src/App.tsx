import { useCallback, useEffect, useState } from "react";

const SESSION_STORAGE_KEY = "cf_ai_verbatim_session_id";

type ChunkResponse =
  | { ok: true; sessionId: string; chunks: string[] }
  | { ok: false; error: string };

export default function App() {
  const [text, setText] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chunks, setChunks] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    localStorage.removeItem(SESSION_STORAGE_KEY);
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
    } catch {
      setError("Network error — is the Worker running on port 8787?");
    } finally {
      setLoading(false);
    }
  }, [text, sessionId, persistSession]);

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
          </section>
        )}
      </main>
    </div>
  );
}
