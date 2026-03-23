import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { maskChunkForStep } from "./maskPractice";
import {
  buildPieces,
  countWordPieces,
  type Piece,
  type WordPiece,
} from "./practicePieces";

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

type Outcome = "correct" | "wrong";

type Props = {
  payload: PracticePayload;
  sessionId: string;
  checkLoading: boolean;
  setCheckLoading: (v: boolean) => void;
  onPracticeUpdate: (p: PracticePayload) => void;
  onCheckFailure: (message: string) => void;
};

/**
 * Inline first-letter practice: cursor moves word-by-word (including hidden words).
 * Punctuation-only tokens advance on any non-control key; no letter appended.
 */
export function PracticeInline({
  payload,
  sessionId,
  checkLoading,
  setCheckLoading,
  onPracticeUpdate,
  onCheckFailure,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const maskedDisplay = maskChunkForStep(payload.chunkPlain, payload.step, {
    step2Parity: payload.step2ParityVariant,
  });
  const pieces: Piece[] = buildPieces(payload.chunkPlain, maskedDisplay);
  const wordPieces = pieces.filter((p): p is WordPiece => p.type === "word");
  const wordCount = countWordPieces(pieces);

  const [cursorAt, setCursorAt] = useState(0);
  const [outcomes, setOutcomes] = useState<Record<number, Outcome>>({});
  const [builtString, setBuiltString] = useState("");
  const submittedRef = useRef(false);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const runCheck = useCallback(
    async (input: string) => {
      setCheckLoading(true);
      try {
        const res = await fetch(
          `/api/practice/${encodeURIComponent(sessionId)}/check`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ input }),
          }
        );
        const data = (await res.json()) as CheckResponse;
        if (!res.ok || data.ok === false) {
          const msg =
            "error" in data && typeof data.error === "string"
              ? data.error
              : `Request failed (${res.status})`;
          onCheckFailure(msg);
          return;
        }
        if (!data.correct) {
          onCheckFailure(
            data.feedback
              ? formatMismatchFeedback(data.feedback)
              : "Not quite — try again or use Retry."
          );
          return;
        }
        onPracticeUpdate(data.practice);
      } catch {
        onCheckFailure("Network error");
      } finally {
        setCheckLoading(false);
        submittedRef.current = false;
      }
    },
    [sessionId, setCheckLoading, onPracticeUpdate, onCheckFailure, payload]
  );

  const finishOrAdvance = useCallback(
    (nextCursor: number, nextBuilt: string) => {
      if (nextCursor >= wordCount) {
        setCursorAt(wordCount);
        if (!submittedRef.current) {
          submittedRef.current = true;
          void runCheck(nextBuilt);
        }
      } else {
        setCursorAt(nextCursor);
      }
    },
    [wordCount, runCheck]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (checkLoading || payload.completedSession) return;
      if (wordCount === 0) return;
      if (cursorAt >= wordCount) return;

      const current = wordPieces[cursorAt];
      if (!current) return;

      // Punctuation-only token: advance on a single non-control character or Enter.
      if (!current.contributing) {
        if (e.key === "Enter" || (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey)) {
          e.preventDefault();
          finishOrAdvance(cursorAt + 1, builtString);
        }
        return;
      }

      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!/\w/.test(e.key)) return;

      e.preventDefault();
      const typed = e.key.toLowerCase();
      const ok = typed === current.expectedLower;
      setOutcomes((o) => ({ ...o, [current.wordIndex]: ok ? "correct" : "wrong" }));
      const nextBuilt = builtString + typed;
      setBuiltString(nextBuilt);
      finishOrAdvance(cursorAt + 1, nextBuilt);
    },
    [
      checkLoading,
      payload.completedSession,
      wordCount,
      cursorAt,
      wordPieces,
      builtString,
      finishOrAdvance,
    ]
  );

  const liveMsg =
    wordCount > 0 && cursorAt < wordCount
      ? `Word ${cursorAt + 1} of ${wordCount}. Type the first letter of each word.`
      : checkLoading
        ? "Checking…"
        : "";

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-400">
        Chunk {payload.currentChunkIndex + 1} of {payload.totalChunks} — Step{" "}
        {payload.step} of 3
      </p>
      <p className="sr-only" aria-live="polite">
        {liveMsg}
      </p>
      <div
        ref={containerRef}
        tabIndex={0}
        role="textbox"
        aria-label="Practice: type the first letter of each word in order"
        aria-multiline={true}
        onKeyDown={handleKeyDown}
        className="rounded-md border border-slate-600 bg-slate-950/80 px-3 py-3 font-serif text-lg leading-relaxed outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
      >
        {pieces.map((p, i) => {
          if (p.type === "space") {
            return <span key={i}>{p.text}</span>;
          }
          const w = p;
          const outcome = outcomes[w.wordIndex];
          const isCurrent = w.wordIndex === cursorAt && cursorAt < wordCount;
          const isPast = w.wordIndex < cursorAt;
          const isFuture = w.wordIndex > cursorAt;

          let text: string;
          let className = "rounded px-0.5 transition-colors";

          if (isPast) {
            text = w.raw;
            if (outcome === "wrong") {
              className += " text-red-400";
            } else {
              className += " text-slate-100";
            }
          } else if (isCurrent) {
            text = w.display;
            className +=
              " text-slate-100 ring-2 ring-sky-500/90 underline decoration-sky-400 decoration-2 underline-offset-2";
          } else {
            text = w.display;
            className += " text-slate-500";
          }

          if (isFuture) {
            className += " select-none";
          }

          return (
            <span key={i} className={className}>
              {text}
            </span>
          );
        })}
      </div>
      <p className="text-xs text-slate-500">
        Click the passage, then type one letter per word in order (case-insensitive). Hidden words
        are included—follow the cursor. Retry still changes Step 2 masking.
      </p>
    </div>
  );
}
