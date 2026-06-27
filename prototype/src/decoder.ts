// L1 command matcher — the prototype's deliberately-simple but REAL discriminator
// (Phase 2 builds the full parallel cascade; this is not a no-op placeholder).
// Ordered-subsequence token match so "open the Anderson case" fires `open_case`
// and extracts the name slot. Simple + deterministic, on-device, sub-ms.

import { type CommandDef } from './commands.ts';
import { resolveNameNearest, resolveNumber, resolveNumberIndex, matchQuality } from './slots.ts';

export interface Match {
  intent: string;
  title: string;
  tier: CommandDef['tier'];
  slotName?: string;
  /** 1-based position for goto_nth ("the third" → 3). */
  slotNumber?: number;
  /** Consumed word indices of the matched trigger (inclusive). */
  span: { start: number; end: number };
  /** Coverage-calibrated lexical confidence in [0,1] — see B8-SEPARATOR-DESIGN. */
  cRaw: number;
}

// Shared normalizer (COMMAND-REGISTRY): strip discourse/politeness/filler words that
// are never command-bearing, so coverage reflects CONTENT words. "let's go to the next
// case please" → ["go","next","case"]. Keeps triggers + names; raises real-command
// coverage without helping embedded-in-prose hits (prose isn't just fillers).
const FILLER = new Set([
  'a', 'an', 'the', 'to', 'for', 'with', 'and', 'of', 'in', 'on', 'at',
  'please', 'thanks', 'thank', 'ok', 'okay', 'um', 'uh', 'uhh', 'hmm', 'er', 'well',
  'lets', 'let', 'us', 'just', 'now', 'so', 'me', 'my', 'i', 'we', 'will',
  'want', 'would', 'like', 'could', 'can', 'you', 'please', 'gonna', 'wanna',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w));
}

interface TriggerHit {
  start: number;
  end: number;
  /** Word indices actually consumed by trigger tokens (excludes any gap word). */
  consumedIdx: Set<number>;
  consumed: number; // trigger WORDS actually matched (gap-free count) — feeds brevity
  quality: number; // avg match quality of trigger tokens (1 exact / 0.5 skeleton / 0.25 edit)
}

/** Max words a needle token may skip past the previous match. Adjacent trigger tokens
 * in real commands are contiguous after filler-stripping ("go next", "sign off",
 * "show comparison"); a wider gap means the tokens are embedded in prose, not a command.
 * Bounding the gap kills the "sentence-eater" (B8 §5 / build steps v1.1–v1.2). */
const MAX_GAP = 1;

/** Ordered subsequence match where each trigger token is matched FUZZILY (and may
 * match a JOIN of two adjacent words). Adjacent matched tokens must be within MAX_GAP
 * words of each other; a wider gap rejects the hit (it's prose, not a command).
 * Returns the consumed span + true consumed-word count + match quality, or null. */
function matchTrigger(words: string[], needle: string[]): TriggerHit | null {
  if (needle.length === 0) return null;
  let i = 0;
  let j = 0;
  let start = -1;
  let end = -1;
  let prevEnd = -1; // index of the last word consumed by the previous needle token
  let qSum = 0;
  let consumed = 0;
  const consumedIdx = new Set<number>();
  while (j < words.length && i < needle.length) {
    const t = needle[i]!;
    const q1 = matchQuality(words[j]!, t);
    if (q1 > 0) {
      if (prevEnd >= 0 && j - prevEnd - 1 > MAX_GAP) return null; // gap too wide → not a command
      if (start < 0) start = j;
      end = j; prevEnd = j; qSum += q1; consumed += 1; consumedIdx.add(j); i++; j++; continue;
    }
    if (j + 1 < words.length) {
      const q2 = matchQuality(words[j]! + words[j + 1]!, t);
      if (q2 > 0) {
        if (prevEnd >= 0 && j - prevEnd - 1 > MAX_GAP) return null;
        if (start < 0) start = j;
        end = j + 1; prevEnd = j + 1; qSum += q2; consumed += 2; consumedIdx.add(j); consumedIdx.add(j + 1); i++; j += 2; continue;
      }
    }
    j++;
  }
  if (i !== needle.length) return null;
  return { start, end, consumedIdx, consumed, quality: qSum / needle.length };
}

const TIER_RANK: Record<CommandDef['tier'], number> = {
  destructive: 3, 'dictation-control': 2, navigation: 1,
};

/**
 * Coverage-calibrated lexical confidence (B8 Stage 1). The discriminator between an
 * isolated command and a command word embedded in long dictation prose:
 *   cRaw = exactFrac × brevity × position
 * - exactFrac: avg trigger match quality (exact triggers beat fuzzy ones)
 * - brevity:   penalizes NON-command words in the utterance (embedded word in long
 *              prose → low; short command utterance → high)
 * - position:  trigger starting at or before the midpoint (start ≤ ⌈totalWords/2⌉)
 *              → 1.0, else 0.7
 */
function confidence(hit: TriggerHit, totalWords: number): number {
  // After filler-stripping, command utterances are ~1-5 content words; dictation
  // narration is 8-20+. Penalize content words NOT part of the command, scaled so a
  // natural short command stays high and an embedded word in long prose drops out.
  const nonCommand = Math.max(0, totalWords - hit.consumed);
  const brevity = Math.max(0.1, 1 - nonCommand / 8);
  const position = hit.start <= Math.ceil(totalWords / 2) ? 1.0 : 0.7;
  return hit.quality * brevity * position;
}

/** Match the best command in `commands`, scored by tier then confidence. */
export function matchL1(text: string, commands: readonly CommandDef[]): Match | null {
  const words = tokenize(text);
  if (words.length === 0) return null;

  const num = resolveNumber(words);
  let best: { cmd: CommandDef; hit: TriggerHit; cRaw: number } | null = null;
  let bestScore = -1;
  for (const cmd of commands) {
    if (cmd.takesNumber && num === null) continue; // goto_nth only competes when a number is present
    let bestHit: TriggerHit | null = null;
    for (const t of cmd.triggers) {
      const h = matchTrigger(words, t);
      if (h && (!bestHit || h.quality > bestHit.quality)) bestHit = h;
    }
    if (!bestHit) continue;
    const cRaw = confidence(bestHit, words.length);
    // tier priority, then confidence; a tiny specificity nudge so a generic name-slot
    // command (open_case) never outranks a co-occurring non-slot trigger at near-equal
    // confidence ("open delacroix and compare priors" → compare_prior, not open_case).
    const score = TIER_RANK[cmd.tier] * 100 + cRaw - (cmd.takesName ? 0.05 : 0);
    if (score > bestScore) { bestScore = score; best = { cmd, hit: bestHit, cRaw }; }
  }
  if (!best) return null;

  // Slot-gating: a name-requiring command must not fire until the name is present.
  let slotName: string | undefined;
  if (best.cmd.takesName) {
    // The name is never the trigger word — exclude the matched trigger span so
    // e.g. "open"(→chen) can't be mistaken for a worklist name.
    const nameWords = words.filter((_, i) => !best!.hit.consumedIdx.has(i));
    const n = resolveNameNearest(nameWords);
    if (!n) return null;
    slotName = n;
  }
  const slotNumber = best.cmd.takesNumber ? (num ?? undefined) : undefined;
  // Extend the span to cover the number slot so the whole command is consumed —
  // else "go to the second" leaves "second" behind to re-fire goto_nth as the
  // partial grows into "...case".
  let spanEnd = best.hit.end;
  if (best.cmd.takesNumber) {
    const ni = resolveNumberIndex(words);
    if (ni >= 0) spanEnd = Math.max(spanEnd, ni);
  }
  return {
    intent: best.cmd.intent, title: best.cmd.title, tier: best.cmd.tier, slotName, slotNumber,
    span: { start: best.hit.start, end: spanEnd }, cRaw: best.cRaw,
  };
}
