// The scripted recording session. Say each prompt in isolation (pause between).
// Ground truth drives WER; `intent` + `scope` drive command-intent accuracy.
// Mix of command phrasings (incl. natural filler) + dictation prose.

import type { Scope } from '../separator/scopeFsm.ts';

export interface Prompt {
  id: string;
  say: string; // what to read aloud (ground-truth transcript)
  kind: 'command' | 'dictation';
  intent?: string; // for commands: expected intent
  scope: Scope; // scope to classify at (where this command is reachable / spoken)
}

export const SCRIPT: Prompt[] = [
  // ── commands (isolated) ──
  { id: 'c01', say: 'open the Anderson case', kind: 'command', intent: 'open_case', scope: 'worklist' },
  { id: 'c02', say: 'open the Patel case', kind: 'command', intent: 'open_case', scope: 'worklist' },
  { id: 'c03', say: 'next case', kind: 'command', intent: 'next_case', scope: 'case_open' },
  { id: 'c04', say: 'go to the next case', kind: 'command', intent: 'next_case', scope: 'case_open' },
  { id: 'c05', say: 'previous case', kind: 'command', intent: 'previous_case', scope: 'case_open' },
  { id: 'c06', say: 'compare with the prior study', kind: 'command', intent: 'compare_prior', scope: 'case_open' },
  { id: 'c07', say: 'begin findings', kind: 'command', intent: 'begin_findings', scope: 'case_open' },
  { id: 'c08', say: 'generate impression', kind: 'command', intent: 'generate_impression', scope: 'dictating_findings' },
  { id: 'c09', say: 'stop dictation', kind: 'command', intent: 'stop_dictation', scope: 'dictating_findings' },
  { id: 'c10', say: 'undo that', kind: 'command', intent: 'undo', scope: 'dictating_findings' },
  { id: 'c11', say: 'sign and next', kind: 'command', intent: 'sign_and_next', scope: 'case_open' },
  { id: 'c12', say: 'sign off', kind: 'command', intent: 'sign_and_next', scope: 'case_open' },
  // ── dictation (specialist prose; must NOT fire a command — incl. trap words) ──
  { id: 'd01', say: 'there is a small nodule in the right upper lobe', kind: 'dictation', scope: 'dictating_findings' },
  { id: 'd02', say: 'no acute intracranial abnormality the ventricles are symmetric', kind: 'dictation', scope: 'dictating_findings' },
  { id: 'd03', say: 'the patient signed consent prior to the examination', kind: 'dictation', scope: 'dictating_findings' },
  { id: 'd04', say: 'mild degenerative change is noted at the next vertebral level', kind: 'dictation', scope: 'dictating_findings' },
  { id: 'd05', say: 'comparison is made with the prior study from last year', kind: 'dictation', scope: 'dictating_findings' },
  { id: 'd06', say: 'findings consistent with mild hepatic steatosis without focal lesion', kind: 'dictation', scope: 'dictating_findings' },
  // Pipeline-verify probe (the "Load synthetic (JFK)" button targets this row, so it
  // never contaminates a real recording). Leave unrecorded in a normal session.
  { id: 'px', say: 'and so my fellow americans ask not what your country can do for you', kind: 'dictation', scope: 'dictating_findings' },
];
