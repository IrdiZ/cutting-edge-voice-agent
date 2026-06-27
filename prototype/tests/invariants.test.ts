// Structural safety invariants — the unit-test backstop for the FAR=0 / destructive-
// never-fires guarantees the eval gate measures over the corpus. These pin the
// MECHANISM (scope reachability + per-tier decision), so a stray edit that would
// re-open a never-event fails here even before the corpus eval runs.
//
// Run: npm test   (node --test, Node 26 native TS — no build, no deps)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { ScopeFsm, type Scope } from '../src/separator/scopeFsm.ts';
import { classifyAtScope } from '../src/separator/index.ts';
import { COMMANDS } from '../src/commands.ts';
import { matchL1 } from '../src/decoder.ts';

const here = dirname(fileURLToPath(import.meta.url));
interface Item { text: string; label: 'command' | 'dictation' | 'mixed'; intent: string; commandSpan: string; category: string }
const corpus = JSON.parse(readFileSync(join(here, '..', 'eval', 'separator-corpus.json'), 'utf8')) as Item[];
const DICTATION = corpus.filter((i) => i.label === 'dictation');

const DICTATING_SCOPES: Scope[] = ['dictating_findings', 'dictating_impression'];
const ALL_SCOPES: Scope[] = ['worklist', 'case_open', 'dictating_findings', 'dictating_impression'];

// ── ScopeFsm reachability: the load-bearing structural defense ──
test('sign_and_next is UNREACHABLE in every dictating scope (no destructive while dictating)', () => {
  for (const s of DICTATING_SCOPES) {
    const ids = new ScopeFsm(s).reachable().map((c) => c.intent);
    assert.ok(!ids.includes('sign_and_next'), `sign_and_next leaked into ${s}: ${ids.join(',')}`);
  }
});

test('no navigation is reachable while dictating (stray "next" in prose is unfireable)', () => {
  const NAV = ['open_case', 'next_case', 'previous_case', 'first_case', 'last_case', 'goto_nth', 'compare_prior'];
  for (const s of DICTATING_SCOPES) {
    const ids = new ScopeFsm(s).reachable().map((c) => c.intent);
    for (const n of NAV) assert.ok(!ids.includes(n), `${n} leaked into ${s}`);
  }
});

test('sign_and_next IS reachable at case_open (the command must still work where intended)', () => {
  const ids = new ScopeFsm('case_open').reachable().map((c) => c.intent);
  assert.ok(ids.includes('sign_and_next'));
});

test('advance() never transitions INTO a dictating scope except via begin_findings/impression', () => {
  for (const c of COMMANDS) {
    const fsm = new ScopeFsm('case_open');
    fsm.advance(c.intent);
    if (c.intent === 'begin_findings') assert.equal(fsm.current, 'dictating_findings');
    else if (c.intent === 'begin_impression') assert.equal(fsm.current, 'dictating_impression');
    else assert.ok(!DICTATING_SCOPES.includes(fsm.current), `${c.intent} wrongly entered ${fsm.current}`);
  }
});

// ── The medico-legal headline, as a unit invariant ──
test('FAR=0: no dictation corpus item fires a command at case_open OR while dictating', () => {
  for (const scope of ['case_open', ...DICTATING_SCOPES] as Scope[]) {
    for (const item of DICTATION) {
      const d = classifyAtScope(item.text, scope);
      assert.equal(d.decision, 'dictation', `"${item.text}" @ ${scope} → ${d.decision} (must be dictation)`);
    }
  }
});

test('a destructive tier can only ever yield pending|dictation — NEVER an auto command', () => {
  // Drive every reachable trigger phrasing at every scope; no destructive may decide 'command'.
  const phrases = [
    'sign', 'signed', 'finalize', 'sign off', 'sign and next', 'sign it', 'go sign off now',
    ...DICTATION.map((d) => d.text),
  ];
  for (const scope of ALL_SCOPES) {
    for (const text of phrases) {
      const d = classifyAtScope(text, scope);
      if (d.decision === 'command') {
        const def = COMMANDS.find((c) => c.intent === d.intent);
        assert.notEqual(def?.tier, 'destructive', `destructive auto-fired as command: "${text}" @ ${scope} → ${d.intent}`);
      }
    }
  }
});

test('baseline naive matcher WOULD have fired destructive on dictation (proves the guard matters)', () => {
  // Sanity: without the scope gate, some dictation matches a destructive — so the
  // structural defense above is doing real work, not vacuously passing.
  const naiveDestructive = DICTATION.filter((i) => matchL1(i.text, COMMANDS)?.tier === 'destructive');
  assert.ok(naiveDestructive.length > 0, 'expected the naive matcher to mis-fire on some dictation');
});
