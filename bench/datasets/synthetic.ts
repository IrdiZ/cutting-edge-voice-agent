// Deterministic synthetic dataset generator (no RNG, no real PHI).
//
// Produces a mock worklist + a command corpus with multiple phrasings,
// pure-dictation samples (with hard clinical terms for WER), and adversarial
// negatives (dictation that reads like a command — drives the false-accept
// measurement that PHASE-0-BENCH.md §D weights heaviest).
//
// This is a STAND-IN until real reading-room audio lands in datasets/audio/.

import type { CommandSample, Dataset, DictationSample } from './types.ts';

const WORKLIST = [
  'Anderson', 'Bauer', 'Chen', 'Delacroix', 'Okafor', 'Patel', 'Rossi', 'Schmidt', 'Yamamoto', 'Zielinski',
];

// intent -> phrasings (synonyms + trailing pleasantries). First ~10 commands per G2.
const COMMANDS: Array<{ intent: string; phrasings: string[]; tier: 'navigation' | 'dictation-control' | 'destructive' }> = [
  { intent: 'open_case', phrasings: ['open case', 'open the case', 'pull up case', 'load case'], tier: 'navigation' },
  { intent: 'next_case', phrasings: ['next case', 'next study', 'go to next'], tier: 'navigation' },
  { intent: 'previous_case', phrasings: ['previous case', 'go back', 'prior study'], tier: 'navigation' },
  { intent: 'findings_dictation', phrasings: ['findings are', 'begin findings', 'start findings'], tier: 'dictation-control' },
  { intent: 'impression_dictation', phrasings: ['impression', 'begin impression', 'start impression'], tier: 'dictation-control' },
  { intent: 'generate_impression', phrasings: ['generate impression', 'generate the impression', 'auto impression'], tier: 'dictation-control' },
  { intent: 'undo', phrasings: ['undo', 'undo that', 'scratch that'], tier: 'dictation-control' },
  { intent: 'compare_prior', phrasings: ['compare with prior', 'show prior', 'open prior'], tier: 'navigation' },
  { intent: 'sign_and_next', phrasings: ['sign and next', 'finalize and next'], tier: 'destructive' },
  { intent: 'sign_report', phrasings: ['sign report', 'finalize report', 'sign off'], tier: 'destructive' },
];

const HARD_TERMS = ['oligodendroglioma', 'steatohepatitis', 'pneumomediastinum', 'spondylolisthesis'];

function buildCommands(): CommandSample[] {
  const out: CommandSample[] = [];
  for (const cmd of COMMANDS) {
    cmd.phrasings.forEach((phrase, i) => {
      // Attach a worklist name as a slot to navigation/sign commands, round-robin.
      const needsName = cmd.tier !== 'dictation-control';
      const name = WORKLIST[(out.length + i) % WORKLIST.length]!;
      const transcript = needsName ? `${phrase} for ${name}` : phrase;
      out.push({
        id: `${cmd.intent}#${i}`,
        transcript,
        intent: cmd.intent,
        slots: needsName ? { patient: name } : undefined,
      });
    });
  }
  return out;
}

function buildDictation(): DictationSample[] {
  return [
    { id: 'dict#0', transcript: 'there is a small focus of oligodendroglioma in the left frontal lobe', hardTerms: ['oligodendroglioma'] },
    { id: 'dict#1', transcript: 'the liver demonstrates findings consistent with steatohepatitis without focal lesion', hardTerms: ['steatohepatitis'] },
    { id: 'dict#2', transcript: 'no pneumomediastinum and the cardiomediastinal silhouette is unremarkable', hardTerms: ['pneumomediastinum'] },
    { id: 'dict#3', transcript: 'mild spondylolisthesis at L4 L5 with no acute fracture', hardTerms: ['spondylolisthesis'] },
  ];
}

// Dictation that LOOKS command-like but is narrative — should NOT fire a command.
function buildNegatives(): CommandSample[] {
  return [
    { id: 'neg#0', transcript: 'the patient was asked to sign the consent form prior to the study', intent: 'NONE' },
    { id: 'neg#1', transcript: 'findings are best correlated with the previous case from last year', intent: 'NONE' },
    { id: 'neg#2', transcript: 'the impression of the radiologist was that no follow up was needed', intent: 'NONE' },
    { id: 'neg#3', transcript: 'we will go back to review the comparison once the prior is available', intent: 'NONE' },
  ];
}

export function makeSyntheticDataset(): Dataset {
  return {
    worklist: [...WORKLIST],
    commands: buildCommands(),
    dictation: buildDictation(),
    negatives: buildNegatives(),
  };
}

export { COMMANDS, WORKLIST, HARD_TERMS };
