// B8 separator eval — measures FALSE-ACCEPT RATE (the medico-legal headline) and
// command recall against the 128-utterance labeled corpus, comparing:
//   BASELINE  — the old naive matcher (any command match fires; no scope, no floor)
//   SGFM @case_open       — coverage floor only (worst case: full set reachable)
//   SGFM @dictating       — scope gate + floor (realistic: dictation context)
//
// This is a SAFETY GATE, not just a report: it process.exit(1) (with a FAIL message)
// if any never-event regresses — FAR>0 on dictation (at case_open or dictating), any
// destructive (sign) false-fire, or command recall below a conservative floor.
//
// Run: node eval/run-eval.ts   (from prototype/, Node 26 native TS)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { COMMANDS } from '../src/commands.ts';
import { matchL1 } from '../src/decoder.ts';
import { classifyAtScope } from '../src/separator/index.ts';
import { ScopeFsm, type Scope } from '../src/separator/scopeFsm.ts';

interface Item { text: string; label: 'command' | 'dictation' | 'mixed'; intent: string; commandSpan: string; category: string }

// Light runtime shape check — the corpus is the source of truth for every metric below,
// so a malformed/truncated file must fail LOUDLY here, not silently skew a denominator.
function isItem(x: unknown): x is Item {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return typeof o.text === 'string'
    && (o.label === 'command' || o.label === 'dictation' || o.label === 'mixed')
    && typeof o.intent === 'string'
    && typeof o.commandSpan === 'string'
    && typeof o.category === 'string';
}
function loadCorpus(path: string): Item[] {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(raw)) throw new Error(`corpus must be a JSON array, got ${typeof raw}`);
  raw.forEach((it, i) => { if (!isItem(it)) throw new Error(`corpus item ${i} is malformed: ${JSON.stringify(it)}`); });
  return raw as Item[];
}

const here = dirname(fileURLToPath(import.meta.url));
const corpus = loadCorpus(join(here, 'separator-corpus.json'));

const fired = (d: { decision: string }) => d.decision === 'command' || d.decision === 'pending';
// Baseline = old behavior: any command in the FULL registry matches → it fires.
const baselineFires = (text: string) => matchL1(text, COMMANDS) !== null;

const dict = corpus.filter((i) => i.label === 'dictation'); // must NEVER fire a command
const cmds = corpus.filter((i) => i.label === 'command'); // should fire (recall)
const mixed = corpus.filter((i) => i.label === 'mixed'); // embedded command after prose

function farOn(items: Item[], classify: (t: string) => boolean): { far: number; n: number; hits: string[] } {
  const hits = items.filter((i) => classify(i.text)).map((i) => i.text);
  return { far: hits.length / items.length, n: items.length, hits };
}

console.log(`\nB8 SEPARATOR EVAL — ${corpus.length} utterances  (${dict.length} dictation, ${cmds.length} command, ${mixed.length} mixed)\n`);

// ── False-accept rate on pure-dictation (incl. adversarial near-misses) ──
const base = farOn(dict, baselineFires);
const sgfmCase = farOn(dict, (t) => fired(classifyAtScope(t, 'case_open')));
const sgfmDict = farOn(dict, (t) => fired(classifyAtScope(t, 'dictating_findings')));

const pct = (x: number) => (x * 100).toFixed(1) + '%';
console.log('FALSE-ACCEPT RATE on dictation (lower = safer):');
console.log(`  BASELINE (naive, no scope/floor)   ${pct(base.far)}  (${base.hits.length}/${base.n})`);
console.log(`  SGFM @ case_open (floor only)      ${pct(sgfmCase.far)}  (${sgfmCase.hits.length}/${sgfmCase.n})`);
console.log(`  SGFM @ dictating (scope + floor)   ${pct(sgfmDict.far)}  (${sgfmDict.hits.length}/${sgfmDict.n})`);

// ── The medico-legal headline: can a DESTRUCTIVE (sign) ever fire on dictation? ──
// Meaningful test is @case_open, where sign_and_next IS reachable. @dictating it is
// structurally unreachable (scope gate) — we assert both stay 0 so the gate can't rot.
const destrBase = dict.filter((i) => { const m = matchL1(i.text, COMMANDS); return m?.tier === 'destructive'; });
const destrCase = dict.filter((i) => classifyAtScope(i.text, 'case_open').decision === 'pending');
const destrDict = dict.filter((i) => classifyAtScope(i.text, 'dictating_findings').decision === 'pending');
console.log('\nDESTRUCTIVE false-fire on dictation (must be 0):');
console.log(`  BASELINE                ${destrBase.length}`);
console.log(`  SGFM @ case_open        ${destrCase.length}   (sign reachable — the meaningful test)`);
console.log(`  SGFM @ dictating        ${destrDict.length}   (sign unreachable by scope gate)`);

// ── Command recall (should still fire the right intent) ──
// Classify each command at a scope where it is REACHABLE (stop/undo/generate live in
// dictating; the rest in case_open). Only score intents the v1 registry supports —
// the corpus invents extras (open_study, set_window_preset, …) which are out of scope.
const KNOWN = new Set(COMMANDS.map((c) => c.intent));
const SCOPE_OF: Record<string, Scope> = {
  stop_dictation: 'dictating_findings', undo: 'dictating_findings', generate_impression: 'dictating_findings',
};
const supported = cmds.filter((c) => KNOWN.has(c.intent));
const unsupported = cmds.filter((c) => !KNOWN.has(c.intent));
let hit = 0;
const misses: string[] = [];
for (const c of supported) {
  const scope = SCOPE_OF[c.intent] ?? 'case_open';
  const d = classifyAtScope(c.text, scope);
  if (fired(d) && 'intent' in d && d.intent === c.intent) hit++;
  else misses.push(`${c.text}  (want ${c.intent}, got ${d.decision}${'intent' in d ? ':' + d.intent : ''})`);
}
const recall = supported.length ? hit / supported.length : 1;
console.log(`\nCOMMAND RECALL (reachable scope, supported intents): ${pct(recall)} (${hit}/${supported.length})`);
if (unsupported.length) console.log(`  (${unsupported.length} corpus items use intents not in the v1 registry — excluded)`);

// ── MIXED (embedded-command) diagnostics — NOT gated yet ──
// Each mixed item is prose followed by a trailing command. We classify the WHOLE
// cumulative utterance at the trailing intent's reachable scope and report (a) whether
// any command fires and (b) whether the LABELED trailing intent is the one that fires.
// Whole-utterance scoring under-counts on purpose: the brevity penalty buries a command
// trailing long prose. True credit needs streaming-PARTIAL scoring (fire on the late
// partial after the prose has committed) — that harness is the follow-up. Reported here
// so no corpus item is silently ignored.
const mixedSupported = mixed.filter((m) => KNOWN.has(m.intent));
const mixedUnsupported = mixed.filter((m) => !KNOWN.has(m.intent));
let mixedFiresAny = 0;
let mixedFiresRight = 0;
for (const m of mixedSupported) {
  const scope = SCOPE_OF[m.intent] ?? 'case_open';
  const d = classifyAtScope(m.text, scope);
  if (fired(d)) mixedFiresAny++;
  if (fired(d) && 'intent' in d && d.intent === m.intent) mixedFiresRight++;
}
const mixDen = mixedSupported.length;
console.log('\nMIXED embedded-command (diagnostic only — whole-utterance, not gated):');
console.log(`  fires a command at all            ${pct(mixDen ? mixedFiresAny / mixDen : 0)} (${mixedFiresAny}/${mixDen} supported intents)`);
console.log(`  fires the LABELED trailing intent ${pct(mixDen ? mixedFiresRight / mixDen : 0)} (${mixedFiresRight}/${mixDen})`);
if (mixedUnsupported.length) console.log(`  (${mixedUnsupported.length} mixed items use intents not in the v1 registry — excluded from rates)`);
console.log('  NOTE: low whole-utterance firing is expected; streaming-partial scoring is the follow-up.');

// ── Diagnostics ──
if (sgfmDict.hits.length) {
  console.log('\nResidual false-accepts @ dictating (for tuning):');
  for (const h of sgfmDict.hits.slice(0, 12)) console.log(`  · "${h}"`);
}
if (misses.length) {
  console.log('\nRecall misses (for tuning):');
  for (const m of misses.slice(0, 12)) console.log(`  · ${m}`);
}

// ── SAFETY GATE — exit non-zero on any never-event regression ──
const RECALL_FLOOR = 0.80; // conservative; current is 0.824 so improvements pass, regressions fail
const failures: string[] = [];
if (sgfmCase.far > 0) failures.push(`FAR @ case_open is ${pct(sgfmCase.far)} (${sgfmCase.hits.length}/${sgfmCase.n}), must be 0%`);
if (sgfmDict.far > 0) failures.push(`FAR @ dictating is ${pct(sgfmDict.far)} (${sgfmDict.hits.length}/${sgfmDict.n}), must be 0%`);
if (destrCase.length > 0) failures.push(`${destrCase.length} destructive (sign) false-fire(s) @ case_open, must be 0`);
if (destrDict.length > 0) failures.push(`${destrDict.length} destructive (sign) false-fire(s) @ dictating, must be 0`);
if (recall < RECALL_FLOOR) failures.push(`command recall ${pct(recall)} is below floor ${pct(RECALL_FLOOR)}`);

console.log('');
if (failures.length) {
  console.error('GATE FAIL — safety/quality regression detected:');
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error('');
  process.exit(1);
}
console.log(`GATE PASS — FAR 0% (case_open + dictating), 0 destructive false-fires, recall ${pct(recall)} ≥ ${pct(RECALL_FLOOR)}.`);
console.log('');
