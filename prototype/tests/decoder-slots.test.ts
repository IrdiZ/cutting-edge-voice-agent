// Decoder ranking + matcher + slot-resolution contracts. These pin the behaviours
// the prior hardening pass introduced (MAX_GAP sentence-eater guard, the compare_prior
// specificity nudge, goto_nth number-gating, closed-set name recovery) so a future
// edit can't silently undo them.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchL1 } from '../src/decoder.ts';
import { COMMANDS } from '../src/commands.ts';
import { classifyAtScope } from '../src/separator/index.ts';
import { resolveNameNearest, resolveNumber, matchQuality } from '../src/slots.ts';

const COMPARE = COMMANDS.filter((c) => c.intent === 'compare_prior');

// ── Ranking ──
test('a co-occurring specific command outranks the generic name-slot open_case', () => {
  // "open delacroix and compare priors" — both open_case and compare_prior match;
  // the specificity nudge must pick compare_prior (the old recall miss).
  const d = classifyAtScope('open delacroix and compare priors', 'case_open');
  assert.equal(d.decision, 'command');
  assert.equal('intent' in d && d.intent, 'compare_prior');
});

test('tier priority: an isolated "sign" at case_open is destructive (pending), not navigation', () => {
  const d = classifyAtScope('sign', 'case_open');
  assert.equal(d.decision, 'pending');
});

// ── MAX_GAP sentence-eater guard ──
test('a multi-token trigger does NOT match across a wide content-word gap', () => {
  // 'show' ... 'prior' separated by >1 content word after filler-stripping → not a command.
  assert.equal(matchL1('show the chest images and the prior', COMPARE), null);
});

test('the same multi-token trigger DOES match when its tokens are adjacent', () => {
  const m = matchL1('show prior', COMPARE);
  assert.equal(m?.intent, 'compare_prior');
});

// ── goto_nth number-gating ──
test('goto_nth fires with an ordinal and carries the 1-based slotNumber', () => {
  const d = classifyAtScope('go to the third case', 'case_open');
  assert.equal(d.decision, 'command');
  assert.equal('intent' in d && d.intent, 'goto_nth');
  assert.equal('slotNumber' in d && d.slotNumber, 3);
});

test('goto_nth does NOT fire without a number present', () => {
  const d = classifyAtScope('go to the case', 'case_open');
  assert.notEqual('intent' in d && d.intent, 'goto_nth');
});

// ── Slot resolution ──
test('open_case recovers a mistranscribed name via closed-set nearest match', () => {
  const d = classifyAtScope('open the petell case', 'worklist');
  assert.equal(d.decision, 'command');
  assert.equal('intent' in d && d.intent, 'open_case');
  assert.equal('slotName' in d && d.slotName, 'patel');
});

test('resolveNameNearest recovers fuzzy names but rejects clearly-unrelated tokens', () => {
  assert.equal(resolveNameNearest(['petell']), 'patel');
  assert.equal(resolveNameNearest(['anderson']), 'anderson');
  // non-name prose tokens must not bind to a worklist name (wrong-patient hazard)
  assert.equal(resolveNameNearest(['report']), null);
  assert.equal(resolveNameNearest(['the', 'study', 'findings']), null);
});

test('resolveNameNearest recovers near-homophones and short-name mishears', () => {
  assert.equal(resolveNameNearest(['bower']), 'bauer'); // Bauer is spoken "bower"
  assert.equal(resolveNameNearest(['cha']), 'chen');    // short name, dropped phoneme
  // but unrelated short words still reject (no wrong-patient open)
  assert.equal(resolveNameNearest(['report']), null);
  assert.equal(resolveNameNearest(['window']), null);
  assert.equal(resolveNameNearest(['case']), null);
});

test('resolveNumber parses ordinals, cardinals, and digits; rejects non-numbers', () => {
  assert.equal(resolveNumber(['third']), 3);
  assert.equal(resolveNumber(['five']), 5);
  assert.equal(resolveNumber(['7']), 7);
  assert.equal(resolveNumber(['hello', 'world']), null);
});

test('matchQuality bands: exact=1, phonetic-skeleton=0.5, unrelated=0', () => {
  assert.equal(matchQuality('open', 'open'), 1);
  assert.equal(matchQuality('opan', 'open'), 0.5); // same skeleton (vowels dropped)
  assert.equal(matchQuality('xyz', 'open'), 0);
});
