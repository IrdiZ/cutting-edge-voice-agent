// Multi-command chaining: one utterance can fire several commands in sequence
// ("second case then third case"), without re-firing the same command as the
// cumulative partial grows. Pins the consumed-words cursor + number-slot span
// extension so a future edit can't regress to one-command-per-utterance or to the
// duplicate-fire bug.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Pipeline } from '../src/pipeline.ts';

/** Stream `phrase` as cumulative partials (fire-on-partial) from the worklist scope;
 * return the ordered list of fired command intents (+slot). */
function fired(phrase: string): string[] {
  const out: string[] = [];
  const p = new Pipeline((ev) => {
    if (ev.type === 'command') {
      const s = ev.match.slotNumber ? '#' + ev.match.slotNumber : ev.match.slotName ? '·' + ev.match.slotName : '';
      out.push(ev.match.intent + s);
    }
  });
  const words = phrase.split(' ');
  p.begin();
  words.forEach((_, i) => p.feed({ text: words.slice(0, i + 1).join(' '), isFinal: i === words.length - 1, tMs: i * 40 }));
  return out;
}

test('two numbered nav commands in one utterance both fire, in order', () => {
  assert.deepEqual(fired('go to the second case then the third case'), ['goto_nth#2', 'goto_nth#3']);
});

test('a single command fires exactly once (no duplicate as the partial grows)', () => {
  assert.deepEqual(fired('go to the next case'), ['next_case']);
  assert.deepEqual(fired('go to the second case'), ['goto_nth#2']);
});

test('chaining across command types: open-by-name then navigate', () => {
  assert.deepEqual(fired('open the anderson case then next case'), ['open_case·anderson', 'next_case']);
});

test('first then last in one breath', () => {
  assert.deepEqual(fired('first case then last case'), ['first_case', 'last_case']);
});
