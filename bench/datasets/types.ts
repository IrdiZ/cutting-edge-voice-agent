// Dataset shapes for the Phase-0 inputs (PHASE-0-BENCH.md §C).
//
// NO REAL PHI. The synthetic generator produces a mock worklist; real
// reading-room audio is dropped into datasets/audio/ (git-ignored) and
// referenced via `audioPath`.

export interface CommandSample {
  id: string;
  audioPath?: string;
  /** Ground-truth transcript (drives synthetic replay + WER). */
  transcript: string;
  intent: string;
  slots?: Record<string, string>;
  /** True for the embedded-command-in-dictation set (separator/B8 test). */
  embeddedInDictation?: boolean;
}

export interface DictationSample {
  id: string;
  audioPath?: string;
  transcript: string;
  /** Hard clinical terms present, for the WER set. */
  hardTerms?: string[];
}

export interface Dataset {
  /** Mock worklist names/anatomy/drugs for proper-noun slot resolution (B5). */
  worklist: string[];
  /** Clean commands. */
  commands: CommandSample[];
  /** Pure dictation (no commands) — feeds WER + false-accept testing. */
  dictation: DictationSample[];
  /** Adversarial negatives: dictation that LOOKS command-like. Drives false-accept. */
  negatives: CommandSample[];
}
