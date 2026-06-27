// Proper-noun slot resolver (lite version of OPEN-QUESTIONS B5 — the real one is
// SymSpell + Double-Metaphone + Jaro-Winkler over today's worklist). STT mangles
// names ("Patel" -> "patell" / "the tell"), so exact match is useless. We resolve
// against the SMALL, KNOWN worklist using edit-distance + a phonetic skeleton.

import { WORKLIST_NAMES } from './commands.ts';

// Spoken ordinals/cardinals → 1-based index ("the third" / "case 5" / "five").
const NUMBER_WORDS: Record<string, number> = {
  one: 1, first: 1, two: 2, second: 2, three: 3, third: 3, four: 4, fourth: 4,
  five: 5, fifth: 5, six: 6, sixth: 6, seven: 7, seventh: 7, eight: 8, eighth: 8,
  nine: 9, ninth: 9, ten: 10, tenth: 10,
};

/** A single token → 1-based number, or null. Numbers were the ONE slot class with
 * no fuzzy layer (names have resolveNameNearest, triggers have matchQuality), so a
 * homophone/mishear like "forth"→fourth, "thrid"→third resolved to nothing and
 * disqualified goto_nth. We add the SAME phonetic-skeleton fallback the trigger
 * matcher uses (matchQuality's 0.5 tier), gated on length≥3 and a shared first
 * letter. Skeleton-only (not edit-distance): edit-1 collides short number words
 * with common prose ("then"→ten, "tan"→ten), which would mis-fire goto_nth. */
function numFromWord(t: string): number | null {
  if (/^\d{1,2}$/.test(t)) return parseInt(t, 10);
  if (t in NUMBER_WORDS) return NUMBER_WORDS[t]!;
  if (t.length < 3) return null;
  const sk = skeleton(t);
  // A 2-char skeleton (four/for/far/fore→"fr", ten/tan→"tn") is too lossy to fuzz
  // safely; require ≥3 so only the longer ordinals (fourth→"frth", third→"thrd")
  // fuzz-match. Bare cardinals stay exact-only (digits + dictionary), which is fine.
  if (sk.length < 3) return null;
  for (const word in NUMBER_WORDS) {
    if (word.length < 3 || word[0] !== t[0]) continue;
    if (skeleton(word) === sk) return NUMBER_WORDS[word]!;
  }
  return null;
}

/** Extract a 1-based position from utterance tokens, or null. */
export function resolveNumber(tokens: readonly string[]): number | null {
  for (const t of tokens) {
    const n = numFromWord(t);
    if (n !== null) return n;
  }
  return null;
}

/** Index of the first number token, or -1 — so the matcher can consume it as part
 * of the command span (else "go to the second" leaves "second" to re-fire). */
export function resolveNumberIndex(tokens: readonly string[]): number {
  for (let i = 0; i < tokens.length; i++) {
    if (numFromWord(tokens[i]!) !== null) return i;
  }
  return -1;
}

/** Levenshtein distance. */
function lev(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

/** Cheap phonetic skeleton: keep the first letter, drop later vowels, collapse repeats. */
function skeleton(s: string): string {
  const lc = s.toLowerCase().replace(/[^a-z]/g, '');
  if (!lc) return '';
  let out = lc[0]!;
  for (let i = 1; i < lc.length; i++) {
    const c = lc[i]!;
    if ('aeiou'.includes(c)) continue;
    if (c === out[out.length - 1]) continue; // collapse doubles
    out += c;
  }
  return out;
}

/** Like skeleton(), but also drops 'w' (a semivowel): "bower" and "bauer" both reduce
 * to "br". Used ONLY for closed-set name resolution so true homophones match without
 * loosening the edit-distance cap for unrelated words. Kept separate from skeleton()
 * so trigger/number matching is unaffected. */
function nameSkeleton(s: string): string {
  const lc = s.toLowerCase().replace(/[^a-z]/g, '');
  if (!lc) return '';
  let out = lc[0]!;
  for (let i = 1; i < lc.length; i++) {
    const c = lc[i]!;
    if ('aeiouw'.includes(c)) continue;
    if (c === out[out.length - 1]) continue;
    out += c;
  }
  return out;
}

/**
 * Match quality of `word` against canonical `target`: 1 exact, 0.5 phonetic
 * (skeleton), 0.25 edit-distance, 0 no match. Feeds the separator's
 * coverage-calibrated confidence (exact triggers count more than fuzzy ones).
 */
export function matchQuality(word: string, target: string): 0 | 0.25 | 0.5 | 1 {
  if (word === target) return 1;
  if (target.length <= 2) return 0;
  if (skeleton(word) === skeleton(target)) return 0.5;
  if (word[0] === target[0]) {
    const thresh = Math.max(1, Math.floor(target.length / 4));
    if (lev(word, target) <= thresh) return 0.25;
  }
  return 0;
}

/**
 * Closed-set name resolution (Move 2). The worklist is a small KNOWN set (~8
 * names), and when open_case is detected the user definitely meant one of them —
 * so resolve to the NEAREST worklist name (argmin distance), not a strict fuzzy
 * match. This recovers badly-mistranscribed names ("under song"/"undersum" →
 * Anderson) that exact/skeleton matching misses — robust precisely because the
 * candidate set is tiny. A tight cap (0.40) rejects clearly-unrelated words so
 * open_case doesn't fire on "open the report".
 *
 * True homophones ("Bauer" is spoken "bower") are recovered PHONETICALLY, not by a
 * looser cap: nameSkeleton treats 'w' as a semivowel so "bower" ≡ "bauer" → "br".
 * (Loosening the cap to admit "bower" at 0.40 also admitted non-homophones at the
 * same distance — "hotel"→Patel, "bossy"→Rossi — so the cap stays tight.)
 */
export function resolveNameNearest(tokens: readonly string[], maxNorm = 0.4): string | null {
  const cands: string[] = [...tokens];
  for (let i = 0; i < tokens.length - 1; i++) cands.push(tokens[i]! + tokens[i + 1]!);

  let best: string | null = null;
  let bestScore = Infinity;
  let shortHit: string | null = null; // short-name absolute-distance fallback
  for (const name of WORKLIST_NAMES) {
    for (const cand of cands) {
      if (cand.length < 3) continue;
      const d = lev(cand, name);
      const norm = d / Math.max(name.length, cand.length);
      // a phonetic match (vowels + 'w' dropped) strongly pulls the score down, so a
      // true homophone wins without loosening the distance cap for everyone
      const score = nameSkeleton(cand) === nameSkeleton(name) ? Math.min(norm, 0.2) : norm;
      if (score < bestScore) { bestScore = score; best = name; }
      // Short names ("Chen") normalize harshly: one dropped phoneme ("cha") is norm
      // 0.5, over the cap, yet clearly the intended name. Accept by ABSOLUTE distance
      // (<=2) when both are short AND share a first letter — the first-letter guard is
      // what stops common words ("the" is also lev-2 from "chen") binding to a name.
      if (d <= 2 && cand.length <= 4 && name.length <= 5 && cand[0] === name[0]) shortHit = name;
    }
  }
  return best && bestScore < maxNorm ? best : shortHit;
}
