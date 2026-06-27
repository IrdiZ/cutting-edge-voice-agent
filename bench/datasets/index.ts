// Dataset loader. Prefers a real-audio manifest if one is present, else falls
// back to the deterministic synthetic dataset.
//
// To use real reading-room audio (the single most important Phase-0 asset, §C):
//   1. Drop wav/flac files under datasets/audio/ (git-ignored).
//   2. Write datasets/audio/manifest.json as { commands, dictation, negatives }
//      using the shapes in ./types.ts, with `audioPath` on each sample.
//   3. loadDataset() will pick it up automatically.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Dataset } from './types.ts';
import { makeSyntheticDataset } from './synthetic.ts';

const here = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(here, 'audio', 'manifest.json');

export function loadDataset(): { dataset: Dataset; source: 'real-audio' | 'synthetic' } {
  if (existsSync(MANIFEST)) {
    const parsed = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Partial<Dataset>;
    // Light shape check: any present top-level field must be an array, so a
    // malformed manifest fails here with a clear message instead of blowing up
    // deep inside scoreEngine on a non-iterable.
    for (const key of ['worklist', 'commands', 'dictation', 'negatives'] as const) {
      if (parsed[key] !== undefined && !Array.isArray(parsed[key])) {
        throw new Error(`Malformed manifest ${MANIFEST}: "${key}" must be an array`);
      }
    }
    return {
      dataset: {
        worklist: parsed.worklist ?? [],
        commands: parsed.commands ?? [],
        dictation: parsed.dictation ?? [],
        negatives: parsed.negatives ?? [],
      },
      source: 'real-audio',
    };
  }
  return { dataset: makeSyntheticDataset(), source: 'synthetic' };
}

export type { Dataset } from './types.ts';
