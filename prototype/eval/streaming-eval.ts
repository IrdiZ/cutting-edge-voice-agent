// Streaming-partial eval — the measurement the whole-utterance gate (run-eval.ts)
// cannot give. The mission FIRES ON STREAMING PARTIALS, so the honest safety question
// is not "does the FINAL transcript fire?" but "does ANY PREFIX fire?" — including a
// prefix of dictation prose that momentarily looks like a command (the sentence-eater /
// revision mis-fire the whole-utterance scorer is blind to).
//
// We replay each corpus utterance as cumulative word prefixes through the real
// separator under a LocalAgreement-N commit gate (a command commits only when the SAME
// fireable intent survives N consecutive partials — the docs/COMMAND-REGISTRY.md "commit gate").
// N=1 is today's fire-on-first-confident-partial; N>=2 is the designed stability gate.
//
// Run: node eval/streaming-eval.ts   (diagnostic — NOT a gate; run-eval.ts is the gate)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classify, ScopeFsm, type Scope } from '../src/separator/index.ts';
import { COMMANDS } from '../src/commands.ts';

interface Item { text: string; label: 'command' | 'dictation' | 'mixed'; intent: string; commandSpan: string; category: string }
const here = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(here, 'separator-corpus.json'), 'utf8')) as Item[];

const KNOWN = new Set(COMMANDS.map((c) => c.intent));
// Where each intent is reachable / would be spoken (mirrors run-eval.ts).
const SCOPE_OF: Record<string, Scope> = {
  stop_dictation: 'dictating_findings', undo: 'dictating_findings', generate_impression: 'dictating_findings',
};
const scopeFor = (intent: string): Scope => SCOPE_OF[intent] ?? 'case_open';

interface FireResult { intent: string | null; pending: boolean; atPrefix: number; prefixText: string }

/** Replay `text` as cumulative word prefixes at `scope`; fire when a fireable intent
 *  (command OR destructive→pending) is stable across N consecutive prefixes. Returns the
 *  first such fire, or null. Mirrors the live claim-once behaviour. */
function streamUtterance(text: string, scope: Scope, n: number): FireResult {
  const words = text.split(/\s+/).filter(Boolean);
  let streakIntent: string | null = null;
  let streak = 0;
  for (let i = 0; i < words.length; i++) {
    const prefix = words.slice(0, i + 1).join(' ');
    const d = classify(prefix, new ScopeFsm(scope)); // scope held — one utterance, no self-advance
    if (d.decision === 'command' || d.decision === 'pending') {
      if (d.intent === streakIntent) streak++;
      else { streakIntent = d.intent; streak = 1; }
      if (streak >= n) return { intent: d.intent, pending: d.decision === 'pending', atPrefix: i, prefixText: prefix };
    } else {
      streakIntent = null; streak = 0;
    }
  }
  return { intent: null, pending: false, atPrefix: -1, prefixText: '' };
}

const dict = corpus.filter((i) => i.label === 'dictation');
const cmds = corpus.filter((i) => i.label === 'command' && KNOWN.has(i.intent));
const mixed = corpus.filter((i) => i.label === 'mixed' && KNOWN.has(i.intent));
const pct = (x: number) => (x * 100).toFixed(1) + '%';

console.log(`\nSTREAMING-PARTIAL EVAL — replay every prefix through the separator + LocalAgreement-N gate`);
console.log(`(${dict.length} dictation, ${cmds.length} command, ${mixed.length} mixed; diagnostic, not a gate)\n`);

interface Row { n: number; farDict: number; farCase: number; destrCase: number; recall: number; mixedRecall: number }
const rows: Row[] = [];
const firstFar: { n: number; hits: { text: string; intent: string; at: string }[] } = { n: 0, hits: [] };

for (const n of [1, 2, 3]) {
  // Streaming FAR: ANY prefix of dictation prose that fires is a false-accept.
  const dictHitsCase = dict.map((i) => ({ i, r: streamUtterance(i.text, 'case_open', n) })).filter((x) => x.r.intent !== null);
  const dictHitsDict = dict.filter((i) => streamUtterance(i.text, 'dictating_findings', n).intent !== null);
  const destrCase = dict.filter((i) => { const r = streamUtterance(i.text, 'case_open', n); return r.pending; });
  // Recall: the command fires the right intent on some prefix, in its reachable scope.
  const recallHits = cmds.filter((i) => streamUtterance(i.text, scopeFor(i.intent), n).intent === i.intent);
  // Mixed recovery: the trailing command fires the LABELED intent (prose prefix must not pre-empt it).
  const mixedHits = mixed.filter((i) => streamUtterance(i.text, scopeFor(i.intent), n).intent === i.intent);

  rows.push({
    n,
    farDict: dictHitsDict.length / dict.length,
    farCase: dictHitsCase.length / dict.length,
    destrCase: destrCase.length,
    recall: recallHits.length / cmds.length,
    mixedRecall: mixedHits.length / mixed.length,
  });
  if (n === 1) firstFar.hits = dictHitsCase.map((x) => ({ text: x.i.text, intent: x.r.intent!, at: x.r.prefixText }));
}

console.log('LocalAgreement N | FAR@dictating | FAR@case_open | sign-pending@case_open | cmd recall | mixed recall');
console.log('-----------------|---------------|---------------|------------------------|------------|-------------');
for (const r of rows) {
  console.log(
    `       N=${r.n}        |    ${pct(r.farDict).padStart(6)}     |    ${pct(r.farCase).padStart(6)}     |` +
    `          ${String(r.destrCase).padStart(2)}            |   ${pct(r.recall).padStart(6)}   |   ${pct(r.mixedRecall).padStart(6)}`,
  );
}

console.log('\nReadout:');
console.log('  · FAR@dictating should be ~0 at every N (scope gate makes nav/destructive unreachable while dictating).');
console.log('  · FAR@case_open is the streaming exposure the whole-utterance gate is blind to; watch it fall as N rises.');
console.log('  · A higher N trades a one-partial latency cost for fewer prefix mis-fires — the docs/COMMAND-REGISTRY.md commit gate.');
if (firstFar.hits.length) {
  console.log('\n  N=1 streaming false-accepts @ case_open (prefix that fired):');
  for (const h of firstFar.hits.slice(0, 12)) console.log(`    · "${h.text}"  → ${h.intent}  @ "${h.at}"`);
}
console.log('');
