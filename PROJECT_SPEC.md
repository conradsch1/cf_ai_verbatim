# Project Specification: cf_ai_verbatim

## 0. Project Overview
This is an AI-powered text memorization application built for a Cloudflare internship assignment. It generalizes the "3-step memorization method" (progressive fading) to help users memorize long, complex texts (like creeds, speeches, or poetry) word-for-word.

## 1. Strict Assignment Requirements
The following components MUST be implemented to satisfy the Cloudflare AI app assignment:
* **LLM:** Use Llama 3.3 (via Workers AI) or an external LLM for core intelligence.
* **Workflow / Coordination:** Use Cloudflare Workflows, Workers, or Durable Objects to coordinate the app logic.
* **User Input:** Must support input via **Chat or Voice** (using Pages or Realtime).
* **Memory or State:** Must maintain state across sessions.
* **Repository Prefix:** The repository name must start with `cf_ai_`.
* **Documentation:** Must include a `README.md` with setup instructions and a `PROMPTS.md` containing all AI prompts used during development.

## 2. The Core User Journey
1.  **Input:** User provides a long text string.
2.  **Processing (LLM):** AI chunks the text into semantic, manageable units.
3.  **Practice (User Input):** User performs a 3-step fading exercise for each chunk.
4.  **Assistance (Chat/Voice):** AI provides context-aware hints upon request if the user is stuck.
5.  **Review (Memory/State):** User self-evaluates performance (SM-2 algorithm) to schedule future reviews.

## 3. Feature Specifications & Logic

### Feature A: AI Semantic Chunking
* **Requirement:** LLM / Workflow
* **Logic:** Use Llama 3.3 to break long text into "natural" chunks, **aiming** for roughly **7–30 words** per chunk when coherent breaks allow.
* **Constraint:** Chunks must break at logical points (commas, periods, or complete clauses) rather than arbitrary word counts.
* **Enforcement:** **Tolerant** — the Worker accepts valid model output (non-empty chunks, parseable JSON) and does **not** reject responses solely because a chunk is slightly outside the 7–30 word target band; natural boundaries take priority over exact length.

### Feature B: The 3-Step Memorization Engine
* **Requirement:** User Input / Workflow
* **Mechanism:** Progressive Fading.
    * **Step 1 (Familiarize):** Full text is visible.
    * **Step 2 (Partial Recall):** **Every other word** is hidden (alternating by index), not a random half. For masking, a **word** is a **whitespace-delimited** token (e.g. `well-known` is one token; `say,` is one token). Validation uses the **same** tokenization: the user types only the **first letter** of each token (punctuation attached to a token is not typed separately).
    * **Step 3 (Mastery):** 100% of words are hidden.
* **Retry:** If validation fails, the user can **retry the same step** before moving on; the app does **not** advance to the next step or chunk until the input is correct (or the user abandons flow elsewhere, if you add that later).
* **Wrong-answer feedback:** A failed check (no step advance) may return **structured mismatch feedback**—e.g. letter count vs expected, or first differing word position and letters—so the user knows what went wrong without revealing the full answer as a cheat sheet.
* **Step 2 retry behavior:** Each time the user **retries** Step 2 on the same chunk (after a failed check), **which** words are hidden **flips** (e.g. swap odd/even index parity) so a different alternating pattern is shown.
* **Validation Logic:** User types the **first letter** of each whitespace-delimited word (same tokens as Step 2 masking). **Do not** require typing punctuation as its own keystrokes—commas, quotes, etc. that sit next to letters are covered by typing the first letter of that token.
    * *Technical Implementation:* Split the chunk on whitespace; for each non-empty token, take the first “word character” match (e.g. first `\w` in the token, which skips leading quotes before the first letter). Concatenate those characters in order. Comparison must be **case-insensitive**; whitespace in the user’s input is ignored.
* **Practice UI:** The client may present an **inline, word-by-word** typing flow (cursor moves through every word token, including masked ones; per-word coloring for correct vs incorrect first letters) while still submitting the same concatenated letter sequence to `POST /api/practice/:sessionId/check` when the sequence is complete.

### Feature C: Context-Aware Hints
* **Requirement:** LLM / Chat Input
* **Logic:** If a user is stuck, they can request a hint via a chat-style interface.
* **LLM Prompting:** The AI should provide a synonym, rhyme, or context clue for the specific word *without* revealing the word itself.

### Feature D: Spaced Repetition (SM-2 Algorithm)
* **Requirement:** Memory or State
* **Logic:** After Step 3, the user chooses from: **Fail, Hard, Medium, Easy**.
* **Algorithm (SM-2):**
    * **Quality Scores ($q$):** Fail=1, Hard=3, Medium=4, Easy=5.
    * **Interval ($I$):** If $q < 3$, reset. If $q \ge 3$, scale $I$ by the Easiness Factor ($EF$).
    * **EF Formula:** $EF = EF + (0.1 - (5 - q) \times (0.08 + (5 - q) \times 0.02))$. 
    * *Constraint:* $EF$ must not drop below 1.3.

## 4. Agent Instructions
* **Auto-Logging:** You MUST append the prompt used for every major code generation or refactor to `PROMPTS.md`.
* **Cloudflare Context:** Prioritize using Cloudflare Workers, Durable Objects, and Workers AI.
* **Documentation:** Help draft the `README.md` to ensure it includes clear "running instructions" as required by the assignment.