// The live reactive loop's destructive-confirm state machine — the highest-stakes
// safety logic. Pins all five never-event scenarios so a future edit to the confirm
// flow can't silently re-open one. (This file importing at all also proves pipeline.ts
// is type-strippable by Node's native runner — the parameter-property fix.)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Pipeline, isConfirmUtterance, type PipelineEvent } from '../src/pipeline.ts';
import { escapeHtml, stripTrailingStop } from '../src/cockpit.ts';
import type { Partial } from '../src/adapters/types.ts';

const P = (text: string, isFinal = false, tMs = 100): Partial => ({ text, isFinal, tMs });

/** A pipeline already advanced to case_open (via a nav command), events reset. */
function atCaseOpen(): { pipe: Pipeline; events: PipelineEvent[] } {
  const events: PipelineEvent[] = [];
  const pipe = new Pipeline((ev) => events.push(ev));
  pipe.begin();
  pipe.feed(P('next case', true, 200)); // worklist → case_open
  events.length = 0; // discard setup
  return { pipe, events };
}

function utterance(pipe: Pipeline, partials: Partial[]): void {
  pipe.begin();
  for (const p of partials) pipe.feed(p);
}

const committedSign = (evs: PipelineEvent[]) =>
  evs.some((e) => e.type === 'command' && e.match.intent === 'sign_and_next');
const raisedPending = (evs: PipelineEvent[]) => evs.some((e) => e.type === 'pending');
const cleared = (evs: PipelineEvent[]) => evs.some((e) => e.type === 'pending-cleared');

test('destructive NEVER auto-fires from the stream — it only ever goes pending', () => {
  const { pipe, events } = atCaseOpen();
  utterance(pipe, [P('sign'), P('sign and'), P('sign and next', true)]);
  assert.ok(raisedPending(events), 'expected a pending event');
  assert.ok(!committedSign(events), 'destructive must not auto-commit from the stream');
});

test('one-breath "sign confirm" in a SINGLE utterance does NOT sign (isolation held)', () => {
  const { pipe, events } = atCaseOpen();
  utterance(pipe, [P('sign'), P('sign confirm', true)]);
  assert.ok(!committedSign(events), 'same-utterance sign+confirm must HOLD, not commit');
});

test('a SEPARATE isolated "confirm" utterance commits the pending signature', () => {
  const { pipe, events } = atCaseOpen();
  utterance(pipe, [P('sign and next', true)]); // arm
  events.length = 0;
  utterance(pipe, [P('confirm', true)]); // separate confirm
  assert.ok(committedSign(events), 'isolated confirm in a new utterance must commit');
});

test('ambient prose after arming fail-closed CANCELS (never signs)', () => {
  const { pipe, events } = atCaseOpen();
  utterance(pipe, [P('sign and next', true)]);
  events.length = 0;
  utterance(pipe, [P('the fracture is confirmed', true)]); // contains "confirmed" but is prose
  assert.ok(!committedSign(events), 'ambient prose must not sign');
  assert.ok(cleared(events), 'pending must be fail-closed cancelled');
});

test('a different command after arming fail-closed CANCELS the pending sign', () => {
  const { pipe, events } = atCaseOpen();
  utterance(pipe, [P('sign and next', true)]);
  events.length = 0;
  utterance(pipe, [P('next case', true)]);
  assert.ok(!committedSign(events), 'a different command must not sign');
  assert.ok(cleared(events), 'pending must be cleared');
});

test('button confirmPending() commits; cancelPending() emits pending-cleared', () => {
  const a = atCaseOpen();
  utterance(a.pipe, [P('sign and next', true)]);
  a.events.length = 0;
  a.pipe.confirmPending();
  assert.ok(committedSign(a.events), 'button confirm must commit');

  const b = atCaseOpen();
  utterance(b.pipe, [P('sign and next', true)]);
  b.events.length = 0;
  b.pipe.cancelPending();
  assert.ok(cleared(b.events), 'button cancel must emit pending-cleared');
});

// ── dictation does not echo the command words on the arming breath ──
const dictTexts = (evs: PipelineEvent[]) =>
  evs.flatMap((e) => (e.type === 'dictation' ? [e.text] : []));

test('"begin findings ..." in one breath does NOT leak the command words into the report', () => {
  const { pipe, events } = atCaseOpen();
  // one continuous breath, as sherpa emits cumulative word-by-word partials
  utterance(pipe, [
    P('i begin'),
    P('i begin findings'),
    P('i begin findings we have'),
    P('i begin findings we have a large mass', true),
  ]);
  const dict = dictTexts(events);
  assert.ok(dict.length > 0, 'expected dictation to start');
  const last = dict[dict.length - 1]!;
  assert.ok(!/\bbegin\b/i.test(last) && !/\bfindings\b/i.test(last), `command words leaked: "${last}"`);
  assert.match(last, /we have a large mass/i, `dictation content lost: "${last}"`);
});

test('one-shot final "begin findings <prose>" still captures the prose (no dropped tail)', () => {
  const { pipe, events } = atCaseOpen();
  utterance(pipe, [P('begin findings the lungs are clear', true)]); // whole breath as one final
  const dict = dictTexts(events);
  assert.ok(dict.length > 0, 'a single final arming partial must still dictate its tail');
  assert.match(dict[dict.length - 1]!, /the lungs are clear/i);
  assert.ok(!/findings/i.test(dict[dict.length - 1]!), 'command word leaked on one-shot final');
});

// ── a state-changing command re-anchors: the rest of the breath fires in the new scope ──
const firedIntents = (evs: PipelineEvent[]) =>
  evs.flatMap((e) => (e.type === 'command' ? [e.match.intent] : []));

test('"stop dictation … generate" in one breath fires BOTH (stop exits, generate fires in case_open)', () => {
  const events: PipelineEvent[] = [];
  const pipe = new Pipeline((ev) => events.push(ev));
  pipe.begin(); pipe.feed(P('next case', true));        // worklist → case_open
  pipe.begin(); pipe.feed(P('begin findings', true));   // → dictating_findings
  events.length = 0;
  pipe.begin();                                          // ONE continuous breath
  pipe.feed(P('stop'));
  pipe.feed(P('stop dictation'));
  pipe.feed(P('stop dictation generate', true));
  const intents = firedIntents(events);
  assert.ok(intents.includes('stop_dictation'), 'stop_dictation should fire');
  assert.ok(intents.includes('generate_impression'), 'generate must fire in the new scope, same breath');
});

// ── isConfirmUtterance isolation contract (the deleted-CONFIRM_RE-bug guard) ──
test('isConfirmUtterance accepts only isolated confirmations', () => {
  for (const yes of ['confirm', 'confirm sign', 'sign confirm', 'the confirm please']) {
    assert.equal(isConfirmUtterance(yes), true, `should accept "${yes}"`);
  }
  for (const no of ['the fracture is confirmed', 'sign and next', 'yes', 'confirmed', 'we sign off after the next study']) {
    assert.equal(isConfirmUtterance(no), false, `should reject "${no}"`);
  }
});

// ── stop-command artifact stripping (the "STO" left-in-findings fix) ──
test('stripTrailingStop removes a leaked stop fragment but keeps real dictation', () => {
  assert.equal(stripTrailingStop('there is a large mass sto'), 'there is a large mass');
  assert.equal(stripTrailingStop('the lungs are clear stop'), 'the lungs are clear');
  assert.equal(stripTrailingStop('there is a large mass'), 'there is a large mass'); // untouched
  assert.equal(stripTrailingStop('the lesion is stable'), 'the lesion is stable');   // "stable" != stop
});

// ── XSS output-encoding contract (PHI-XSS sink in the worklist render) ──
test('escapeHtml neutralizes every HTML-significant character', () => {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(escapeHtml(`"&'`), '&quot;&amp;&#39;');
  assert.equal(escapeHtml('Anderson'), 'Anderson');
});
