// The M1 command set + a mock worklist. Cost tiers drive the commit policy
// (navigation/dictation-control fire on partials; destructive must confirm).

export type Tier = 'navigation' | 'dictation-control' | 'destructive';

export interface CommandDef {
  intent: string;
  title: string;
  tier: Tier;
  /** Alternative ordered token subsequences; ANY match fires (a name may sit between tokens). */
  triggers: string[][];
  /** This command takes a patient-name slot from the utterance. */
  takesName?: boolean;
  /** This command takes a number/ordinal slot ("the third", "case 5"). */
  takesNumber?: boolean;
}

export const WORKLIST: { id: string; name: string }[] = [
  { id: 'CT-2041', name: 'Anderson' },
  { id: 'MR-1188', name: 'Bauer' },
  { id: 'CT-2042', name: 'Chen' },
  { id: 'XR-0907', name: 'Delacroix' },
  { id: 'CT-2044', name: 'Okafor' },
  { id: 'US-3310', name: 'Patel' },
  { id: 'MR-1190', name: 'Rossi' },
  { id: 'CT-2046', name: 'Schmidt' },
];

export const COMMANDS: CommandDef[] = [
  { intent: 'open_case',           title: 'Open case',          tier: 'navigation',        triggers: [['open'], ['pull', 'up'], ['pull'], ['load']], takesName: true },
  { intent: 'next_case',           title: 'Next case',          tier: 'navigation',        triggers: [['next'], ['advance'], ['go', 'next']] },
  { intent: 'previous_case',       title: 'Previous case',      tier: 'navigation',        triggers: [['previous'], ['back'], ['prior', 'patient'], ['prior', 'case']] },
  { intent: 'first_case',          title: 'First case',         tier: 'navigation',        triggers: [['first'], ['top'], ['go', 'first'], ['top', 'list'], ['beginning']] },
  { intent: 'last_case',           title: 'Last case',          tier: 'navigation',        triggers: [['last'], ['bottom'], ['go', 'last'], ['end', 'list'], ['very', 'bottom']] },
  { intent: 'goto_nth',            title: 'Go to Nth case',     tier: 'navigation',        triggers: [['number'], ['select'], ['case'], ['go'], ['jump']], takesNumber: true },
  { intent: 'compare_prior',       title: 'Compare prior',      tier: 'navigation',        triggers: [['compare'], ['comparison'], ['show', 'prior'], ['show', 'comparison']] },
  { intent: 'begin_findings',      title: 'Begin findings',     tier: 'dictation-control', triggers: [['findings']] },
  { intent: 'begin_impression',    title: 'Begin impression',   tier: 'dictation-control', triggers: [['begin', 'impression'], ['start', 'impression'], ['dictate', 'impression'], ['go', 'impression']] },
  { intent: 'generate_impression', title: 'Generate impression',tier: 'dictation-control', triggers: [['generate'], ['create', 'impression'], ['auto', 'impression']] },
  { intent: 'stop_dictation',      title: 'Stop dictation',     tier: 'dictation-control', triggers: [['stop'], ['pause'], ['done'], ['end', 'dictation'], ['stop', 'recording']] },
  { intent: 'undo',                title: 'Undo',               tier: 'dictation-control', triggers: [['undo'], ['scratch', 'that']] },
  { intent: 'sign_and_next',       title: 'Sign & next',        tier: 'destructive',       triggers: [['sign'], ['signed'], ['finalize'], ['sign', 'off']] },
];

export const WORKLIST_NAMES = WORKLIST.map((w) => w.name.toLowerCase());
