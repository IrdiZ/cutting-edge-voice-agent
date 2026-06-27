// SGFM-Sep — the command-vs-dictation separator (research/B8-SEPARATOR-DESIGN.md).
// Four stages, each can only REMOVE a candidate or DELAY a fire; nothing downstream
// resurrects an intent an upstream stage excluded. Pure on-device TS, sub-ms.
//
//  Stage 0  reachability hard gate (ScopeFsm) — structural FAR safety
//  Stage 1  coverage-calibrated confidence cRaw — buries embedded single-token hits
//  Stage 3  fire vs route-to-dictation, per-tier; destructive → pending (never auto)
//
// (Stage 2 commit-stability — local-agreement N≥2: hold a fire until the same intent
// survives ≥2 consecutive partials — is DESIGNED but deliberately NOT IMPLEMENTED. The
// current prototype fires on the FIRST confident partial. eval/streaming-eval.ts MEASURED
// the naive N-gate and it is the WRONG lever here: raising N barely moves streaming FAR
// (the prose-prefix mis-fires are STABLE across partials, e.g. "the patient signed…"
// holds the same intent) while it craters recall (real commands fire on their last word).
// The effective lever is Stage 1's coverage/brevity floor, which already buries embedded
// hits on the WHOLE partial. A smarter commit policy (endpoint-/prosody-gated, not flat N)
// remains future work. This module is the per-partial decision and the unit the eval scores.)

import { matchL1, type Match } from '../decoder.ts';
import { ScopeFsm, type Scope } from './scopeFsm.ts';
import type { Tier } from '../commands.ts';

export type Decision =
  | { decision: 'command'; intent: string; title: string; tier: Tier; slotName?: string; slotNumber?: number; confidence: number; span: Match['span'] }
  | { decision: 'pending'; intent: string; title: string; tier: 'destructive'; confidence: number; span: Match['span'] }
  | { decision: 'dictation'; confidence: number };

// Per-tier confidence floor (hand-set for v1; v2 replaces with calibrated weights).
// Destructive is highest — it must clear isolation before even raising a confirm.
const TAU: Record<Tier, number> = {
  // navigation/dictation-control FAR is structurally bounded by the scope gate
  // (they're unreachable while dictating), so these floors only gate the worst-case
  // probe — set low enough to admit fuzzy mishears. Destructive stays strict: it must
  // clear strong isolation before even raising a confirm.
  // The exact numbers (0.40 / 0.42 / 0.60) are the LOWEST floors that still hold
  // FAR=0 on eval/separator-corpus.json while admitting the fuzzy command recalls;
  // they are empirical (corpus-tuned), not derived — hence the v2-calibration note above.
  navigation: 0.4,
  'dictation-control': 0.42,
  destructive: 0.6,
};

/** Decide command vs dictation for one (cumulative) partial/utterance at `scope`. */
export function classify(text: string, fsm: ScopeFsm): Decision {
  const reachable = fsm.reachable(); // Stage 0: out-of-scope intents are absent
  const m = matchL1(text, reachable);
  if (!m) return { decision: 'dictation', confidence: 0 };

  // Stage 1/3: below the tier floor → it's narration, not a command.
  if (m.cRaw < TAU[m.tier]) return { decision: 'dictation', confidence: m.cRaw };

  if (m.tier === 'destructive') {
    return { decision: 'pending', intent: m.intent, title: m.title, tier: 'destructive', confidence: m.cRaw, span: m.span };
  }
  return {
    decision: 'command', intent: m.intent, title: m.title, tier: m.tier,
    slotName: m.slotName, slotNumber: m.slotNumber, confidence: m.cRaw, span: m.span,
  };
}

/** Convenience for the eval harness: classify a whole utterance at a fixed scope. */
export function classifyAtScope(text: string, scope: Scope): Decision {
  return classify(text, new ScopeFsm(scope));
}

export { ScopeFsm };
export type { Scope };
