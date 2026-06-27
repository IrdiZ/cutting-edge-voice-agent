// Streaming-partial structural safety — the never-event guarantees, checked at the
// level the mission actually fires at (every PREFIX of an utterance), not just the whole
// utterance. eval/streaming-eval.ts is the human-readable diagnostic; this is the gate-
// grade invariant: while dictating, NO prefix of report prose may ever fire a navigation
// or destructive command (those are scope-gated unreachable). Only dictation-control
// (stop/undo/generate) is reachable — and even a transient mis-fire there is recoverable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { classify, ScopeFsm, type Scope } from '../src/separator/index.ts';
import { COMMANDS, type Tier } from '../src/commands.ts';

const here = dirname(fileURLToPath(import.meta.url));
interface Item { text: string; label: 'command' | 'dictation' | 'mixed'; intent: string; commandSpan: string; category: string }
const corpus = JSON.parse(readFileSync(join(here, '..', 'eval', 'separator-corpus.json'), 'utf8')) as Item[];
const DICTATION = corpus.filter((i) => i.label === 'dictation');
const TIER = new Map<string, Tier>(COMMANDS.map((c) => [c.intent, c.tier]));

/** Every fireable decision over the cumulative prefixes of `text` at `scope`. */
function firesOverPrefixes(text: string, scope: Scope) {
  const words = text.split(/\s+/).filter(Boolean);
  const out: { intent: string; tier: Tier | undefined; decision: string; prefix: string }[] = [];
  for (let i = 0; i < words.length; i++) {
    const prefix = words.slice(0, i + 1).join(' ');
    const d = classify(prefix, new ScopeFsm(scope));
    if (d.decision === 'command' || d.decision === 'pending') {
      out.push({ intent: d.intent, tier: TIER.get(d.intent), decision: d.decision, prefix });
    }
  }
  return out;
}

test('STREAMING never-event: no dictation prefix fires NAVIGATION while dictating', () => {
  for (const item of DICTATION) {
    for (const f of firesOverPrefixes(item.text, 'dictating_findings')) {
      assert.notEqual(f.tier, 'navigation', `nav "${f.intent}" fired on prefix "${f.prefix}" of dictation "${item.text}"`);
    }
  }
});

test('STREAMING never-event: no dictation prefix EVER raises a DESTRUCTIVE pending while dictating', () => {
  for (const item of DICTATION) {
    for (const f of firesOverPrefixes(item.text, 'dictating_findings')) {
      assert.notEqual(f.tier, 'destructive', `destructive "${f.intent}" raised on prefix "${f.prefix}" of "${item.text}"`);
    }
  }
});

test('STREAMING: any dictating-scope prefix mis-fire is dictation-control tier only (recoverable, scope-gated)', () => {
  for (const item of DICTATION) {
    for (const f of firesOverPrefixes(item.text, 'dictating_findings')) {
      assert.equal(f.tier, 'dictation-control', `unexpected ${f.tier} fire on "${f.prefix}"`);
    }
  }
});
