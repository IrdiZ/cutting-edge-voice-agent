// Word-error-rate + helpers for the STT bake-off. Normalizes casing/punctuation so
// "Next, case." and "next case" compare equal, and folds number-words to digits so
// "three nodules" == "3 nodules" (correct radiology numerals aren't counted as errors).

// Whole-token number-word -> digit folding (0–20 covers the script's numerals). Only
// applied to entire tokens, so "someone"/"oneself" are never rewritten.
const NUM_WORDS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11',
  twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16',
  seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20',
};

export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => NUM_WORDS[w] ?? w);
}

/** Word-level Levenshtein / reference length, CLAMPED to [0,1]. 0 = perfect, 1 = all
 * wrong. Clamping is the standard convention: a long mishear can exceed the reference
 * length (raw WER > 1), which would let a single rambling clip dominate the mean. */
export function wer(reference: string, hypothesis: string): number {
  const r = normalizeWords(reference);
  const h = normalizeWords(hypothesis);
  if (r.length === 0) return h.length === 0 ? 0 : 1;
  let prev = Array.from({ length: h.length + 1 }, (_, i) => i);
  let curr = new Array<number>(h.length + 1).fill(0);
  for (let i = 1; i <= r.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= h.length; j++) {
      const cost = r[i - 1] === h[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return Math.min(1, prev[h.length]! / r.length);
}

export function mean(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}
export function pct(x: number): string {
  return Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '–';
}
