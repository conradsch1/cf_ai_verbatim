/**
 * Mirrors backend/src/mask.ts so masked segments align with server GET /api/practice.
 */
export type Step2Parity = 0 | 1;

export function maskChunkForStep(
  chunk: string,
  step: 1 | 2 | 3,
  options?: { step2Parity?: Step2Parity }
): string {
  if (step === 1) return chunk;
  if (step === 2) {
    const p = options?.step2Parity ?? 0;
    return maskStep2(chunk, p);
  }
  return maskStep3(chunk);
}

function maskStep2(chunk: string, step2Parity: Step2Parity): string {
  const parts = chunk.split(/(\s+)/);
  let wordIndex = 0;
  return parts
    .map((part) => {
      if (/^\s+$/.test(part)) return part;
      if (part === "") return part;
      const hide = wordIndex % 2 === step2Parity;
      wordIndex += 1;
      if (!hide) return part;
      return "_".repeat(part.length);
    })
    .join("");
}

function maskStep3(chunk: string): string {
  const parts = chunk.split(/(\s+)/);
  return parts
    .map((part) => {
      if (/^\s+$/.test(part)) return part;
      if (part === "") return part;
      return "_".repeat(part.length);
    })
    .join("");
}
