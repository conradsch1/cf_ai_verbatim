/**
 * Mirrors `frontend/src/practicePieces.ts`: whitespace split with capturing groups,
 * sequential `wordIndex` per word token.
 */
export type WordPieceInfo = {
  wordIndex: number;
  raw: string;
  contributing: boolean;
};

export function getWordPieceAt(
  chunk: string,
  wordIndex: number
): WordPieceInfo | null {
  const plainParts = chunk.split(/(\s+)/);
  let wi = 0;
  for (let i = 0; i < plainParts.length; i++) {
    const raw = plainParts[i] ?? "";
    if (/^\s+$/.test(raw)) continue;
    if (raw === "") continue;
    if (wi === wordIndex) {
      const m = raw.match(/\w/);
      return {
        wordIndex: wi,
        raw,
        contributing: !!m,
      };
    }
    wi++;
  }
  return null;
}
