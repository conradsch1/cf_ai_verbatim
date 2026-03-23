# AI Prompts Log

This document tracks the AI assistance and prompts used to develop this application, fulfilling the Cloudflare assignment requirements.

### Feature/Task: Project initialization (monorepo scaffold)
* **Goal:** Initialize the cf_ai_verbatim monorepo per PROJECT_SPEC: backend (Hono Cloudflare Worker with Workers AI, D1, Durable Object MemorizationSession), frontend (Vite + React + Tailwind), placeholder POST `/api/chunk`, `/api/hint`, `/api/review`, SM-2 stubs and `calculateNextReview` from the spec, README with Technical Architecture, and append this prompt log.
* **My Prompt:** "Analyze PROJECT_SPEC.md and .cursorrules. We are starting the development of cf_ai_verbatim. Task 1: Project Scaffolding — initialize monorepo: /backend Cloudflare Worker using Hono with wrangler.toml bindings for Workers AI (Llama 3.3 and Whisper), Durable Object class MemorizationSession, D1 Database db; /frontend Vite + React + Tailwind. Task 2: Core Logic Setup — Hono router with placeholder POST endpoints for /api/chunk, /api/hint, /api/review; in the Durable Object stub SM-2 variables and calculateNextReview using the math from the spec. Task 3: Documentation — README.md with project title and Technical Architecture; CRITICAL: log this initialization in PROMPTS.md exactly as defined in our rules. Does this structure look correct based on Cloudflare requirements?"
* **Outcome:** Added root `package.json` (workspaces), `.gitignore`; `backend/` with `wrangler.toml`, `package.json`, `tsconfig.json`, `src/index.ts` (Hono + CORS + POST routes + health), `src/memorization-session.ts` (Durable Object stub + SM-2 state), `src/sm2.ts` (`calculateNextReview`), `src/constants.ts` (Workers AI model IDs); `frontend/` Vite + React + TS + Tailwind v4 (`vite.config.ts`, `index.html`, `src/*`); updated `README.md`; appended this entry to `PROMPTS.md`.

### Feature/Task: Phase 1–2 — D1 schema and AI semantic chunking
* **Goal:** Add D1 migrations for sessions/chunks, implement `POST /api/chunk` with Llama 3.3 (Workers AI), persist chunks, optional `sessionId` / `X-Session-Id` for re-chunking; minimal frontend to paste text and list chunks; document migrations in README.
* **Planning prompt:** "Plan our next steps" — established phased roadmap: Phase 1 (D1 schema + migrations, session identity, DO vs D1 roles); Phase 2 (`POST /api/chunk` with Llama 3.3, persist chunks, minimal frontend); later phases for practice, hints, review/SM-2, voice, docs.
* **My Prompt:** "implement Phase 1–2"
* **Outcome:** Added [`backend/migrations/0001_sessions_and_chunks.sql`](backend/migrations/0001_sessions_and_chunks.sql); [`backend/src/bindings.ts`](backend/src/bindings.ts) (`Env`); [`backend/src/chunk.ts`](backend/src/chunk.ts) (LLM JSON chunking prompt + validation 7–15 words, D1 writes); updated [`backend/src/index.ts`](backend/src/index.ts) (chunk route, CORS header); updated [`frontend/src/App.tsx`](frontend/src/App.tsx) (textarea, session in `localStorage`, chunk list); updated [`README.md`](README.md) (D1 apply steps). **Chunking LLM instructions** (for assignment traceability): system text in `backend/src/chunk.ts` constant `CHUNK_SYSTEM` plus user message prefix `Split this text into chunks as JSON:\n\n`.

### Feature/Task: Workers AI error 1031 — clearer errors and docs
* **Goal:** Explain error code 1031 / 502 on chunking and improve surfacing of Workers AI failure messages; document troubleshooting in README.
* **My Prompt:** "It gave me error code: 1031"
* **Outcome:** Updated [`backend/src/chunk.ts`](backend/src/chunk.ts) (`formatAiError`, wrap `env.AI.run` in try/catch, prefix `Workers AI:`); added **Troubleshooting** section to [`README.md`](README.md) (1031 / InferenceUpstreamError, workers.dev onboarding, Llama terms, quotas); appended this entry to `PROMPTS.md`.

### Feature/Task: Debug 502 "Empty model response" — structured Workers AI response
* **Goal:** Find why `/api/chunk` returned 502 with `Empty model response`; fix parsing of `env.AI.run` return value.
* **My Prompt:** Debug-mode thread: 502 + UI "Empty model response"; pasted `[agent-debug]` log showing `response` as object with `chunks`, `extractedLen: 0`.
* **Outcome:** Confirmed Workers AI returns `response: { chunks: string[] }` (not a JSON string). Added `tryStructuredChunksFromAiResult` in [`backend/src/chunk.ts`](backend/src/chunk.ts) before `getLlmText` + `parseChunksJson`. Post-fix log: `chunkSource: "structured"`, `chunkCount: 7`. Removed temporary `[agent-debug]` / ingest instrumentation after verification.

### Feature/Task: Align chunk system prompt with strict word-count validation
* **Goal:** Resolve mismatch between prompt wording ("roughly" 7–15 words) and strict `validateChunkSizes` enforcement.
* **My Prompt:** "There is a problem in the system prompt it tells the model each chunk should be roughly MIN_WORDS - MAX_WORDS but in validateChunkSizes the code strictly enforces 7-15 words per chunk. Does my assessment seem correct to you?"
* **Outcome:** Confirmed same `MIN_WORDS`/`MAX_WORDS` constants are used in both prompt and validator; updated `CHUNK_SYSTEM` in [`backend/src/chunk.ts`](backend/src/chunk.ts) to require an inclusive min–max explicitly instead of "roughly".

### Feature/Task: Restore repo after accidental undo all
* **Goal:** Restore deleted monorepo sources (backend/frontend, root package.json, .gitignore, README) after editor undo; keep existing PROMPTS history.
* **My Prompt:** "I accidently pressed undo all but I didn't mean to. Can you restore everything?"
* **Outcome:** Recreated root [`package.json`](package.json), [`.gitignore`](.gitignore), full [`README.md`](README.md); [`backend/`](backend/) (wrangler, migrations, `src/*` including chunking + SM-2 + DO); [`frontend/`](frontend/) (Vite + React + Tailwind + `App.tsx` chunk UI). [`PROMPTS.md`](PROMPTS.md) left intact; [`backend/wrangler.toml`](backend/wrangler.toml) uses prior `database_id` `8b75fec7-0ef6-4da8-ae24-30c185f0cdeb` — user should confirm it still matches their Cloudflare D1.

### Feature/Task: Tolerant chunking (7–30 words) + spec and PROMPTS
* **Goal:** Shift chunking to a tolerant policy: LLM aims for 7–30 words; remove strict per-chunk word-count rejection in the Worker; update [`PROJECT_SPEC.md`](PROJECT_SPEC.md) and [`PROMPTS.md`](PROMPTS.md).
* **My Prompt:** "Let's change the chunking policy the to be tolerant, not strict. The LLM should aim for chunks of size 7-30 words. Please also update the PROJECT_SPEC accordingly also include this planning prompt in the PROMPTS.md"
* **Outcome:** [`backend/src/chunk.ts`](backend/src/chunk.ts): `CHUNK_TARGET_MIN_WORDS`/`CHUNK_TARGET_MAX_WORDS` (7/30), prompt-only; rewrote `CHUNK_SYSTEM` for tolerant aiming; removed `validateChunkSizes` and `wordCount`. [`PROJECT_SPEC.md`](PROJECT_SPEC.md): Feature A updated to 7–30 aim + enforcement bullet. [`frontend/src/App.tsx`](frontend/src/App.tsx): UI copy. Supersedes strict 7–15 (later 7–15 inclusive) validation described in earlier Phase 1–2 log entry.
---