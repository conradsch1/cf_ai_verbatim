export type WordPiece = {
  type: "word";
  raw: string;
  display: string;
  wordIndex: number;
  contributing: boolean;
  expectedLower: string | null;
};

export type SpacePiece = { type: "space"; text: string };

export type Piece = WordPiece | SpacePiece;

/** Align plain + masked chunk splits; one entry per whitespace-delimited word (mask index). */
export function buildPieces(chunkPlain: string, maskedText: string): Piece[] {
  const plainParts = chunkPlain.split(/(\s+)/);
  const maskParts = maskedText.split(/(\s+)/);
  const pieces: Piece[] = [];
  let wordIndex = 0;
  for (let i = 0; i < plainParts.length; i++) {
    const raw = plainParts[i] ?? "";
    const display = maskParts[i] ?? raw;
    if (/^\s+$/.test(raw)) {
      pieces.push({ type: "space", text: raw });
    } else if (raw === "") {
      continue;
    } else {
      const m = raw.match(/\w/);
      pieces.push({
        type: "word",
        raw,
        display,
        wordIndex: wordIndex++,
        contributing: !!m,
        expectedLower: m ? m[0].toLowerCase() : null,
      });
    }
  }
  return pieces;
}

export function countWordPieces(pieces: Piece[]): number {
  return pieces.filter((p): p is WordPiece => p.type === "word").length;
}
