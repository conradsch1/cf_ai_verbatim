/**
 * Per PROJECT_SPEC Feature B: one keystroke per whitespace-delimited token—
 * the first word character in that token (so leading quotes/punctuation before
 * the letter are skipped). No separate punctuation keystrokes. Case-insensitive compare.
 */
export function expectedKeystrokes(chunk: string): string {
  const tokens = chunk.trim().split(/\s+/).filter(Boolean);
  const chars: string[] = [];
  for (const token of tokens) {
    const m = token.match(/\w/);
    if (m) chars.push(m[0]);
  }
  return chars.join("");
}

export function normalizeUserInput(input: string): string {
  return input.replace(/\s+/g, "").toLowerCase();
}

export function inputsMatch(expected: string, userInput: string): boolean {
  return normalizeUserInput(userInput) === expected.toLowerCase();
}

/** JSON-safe feedback when `inputsMatch` is false; same normalization as validation. */
export type KeystrokeMismatchFeedback =
  | { kind: "length"; expectedLength: number; actualLength: number }
  | {
      kind: "mismatch";
      index: number;
      /** 1-based word index (one letter per token); aligns with `index`. */
      wordIndex: number;
      totalWords: number;
      expectedChar: string | null;
      actualChar: string | null;
      expectedLength: number;
      actualLength: number;
    };

/**
 * Where the normalized input diverges from the expected first-letter sequence.
 * Tokens with no `\w` do not add to `expected`, so indices map to contributing words only.
 */
export function keystrokeMismatchFeedback(
  chunk: string,
  userInput: string
): KeystrokeMismatchFeedback {
  const expected = expectedKeystrokes(chunk);
  const exp = expected.toLowerCase();
  const act = normalizeUserInput(userInput);

  if (exp.length !== act.length) {
    const shorter = exp.length < act.length ? exp : act;
    const longer = exp.length < act.length ? act : exp;
    if (longer.startsWith(shorter)) {
      return {
        kind: "length",
        expectedLength: exp.length,
        actualLength: act.length,
      };
    }
  }

  const max = Math.max(exp.length, act.length);
  for (let i = 0; i < max; i++) {
    const ec = exp[i];
    const ac = act[i];
    if (ec === ac) continue;
    return {
      kind: "mismatch",
      index: i,
      wordIndex: i + 1,
      totalWords: exp.length,
      expectedChar: ec ?? null,
      actualChar: ac ?? null,
      expectedLength: exp.length,
      actualLength: act.length,
    };
  }

  return {
    kind: "length",
    expectedLength: exp.length,
    actualLength: act.length,
  };
}
