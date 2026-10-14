// ScopeFSM — the dominant, structural, auditable defense of the B8 separator
// (docs/research/B8-SEPARATOR-DESIGN.md, Stage 0). App state is a finite-state machine;
// each command is reachable only in certain scopes. matchL1 is only ever called
// with the reachable subset, so an out-of-scope intent is structurally absent —
// never scored, never fired.
//
// THE load-bearing edit: sign_and_next is reachable ONLY in case_open,
// NEVER while dictating. So a stray "sign"/"signed" in findings prose is
// unfireable by construction — no threshold involved. Provable by reading the table.

import { COMMANDS, type CommandDef } from '../commands.ts';

export type Scope =
  | 'worklist'
  | 'case_open'
  | 'dictating_findings'
  | 'dictating_impression';

// Reachable intents per scope (∪ globals). Read this table to audit FAR safety.
// Every scope here is reachable from 'worklist' via advance(); see the transition
// table below. (A 'pending_confirm' state is NOT a scope — destructive confirmation
// is handled out-of-band in the Pipeline via an isolated 'confirm' / button.)
// Worklist navigation — reachable in worklist + case_open (never while dictating).
const NAV = ['open_case', 'next_case', 'previous_case', 'first_case', 'last_case', 'goto_nth', 'compare_prior'];
const REACHABLE: Record<Scope, ReadonlySet<string>> = {
  worklist: new Set(NAV),
  case_open: new Set([
    ...NAV,
    'begin_findings', 'begin_impression', 'generate_impression', 'undo', 'sign_and_next',
  ]),
  // dictating: NO navigation, NO destructive — only stop / undo / generate (+globals)
  dictating_findings: new Set(['stop_dictation', 'undo', 'generate_impression']),
  dictating_impression: new Set(['stop_dictation', 'undo', 'generate_impression']),
};

// Globals (reachable in EVERY scope) are intentionally EMPTY: every intent we trust
// is already covered by a per-scope entry above, so nothing needs an always-on bypass
// of the scope gate. The obvious candidate, "stop", was deliberately REJECTED as a
// global (too prose-common — "the bleeding stopped"); it stays scope-gated to
// dictating only, and abort uses the confirm/cancel path. Keep this set empty unless
// an intent is proven both safe and unreachable any other way.
const GLOBALS = new Set<string>([]);

export class ScopeFsm {
  private scope: Scope;

  constructor(initial: Scope = 'worklist') {
    this.scope = initial;
  }

  get current(): Scope {
    return this.scope;
  }

  set(scope: Scope): void {
    this.scope = scope;
  }

  /** Commands reachable in the current scope (∪ globals) — the only set matchL1 sees. */
  reachable(): CommandDef[] {
    const ids = REACHABLE[this.scope];
    return COMMANDS.filter((c) => ids.has(c.intent) || GLOBALS.has(c.intent));
  }

  /** Advance the scope given a fired intent (the FSM transition table). */
  advance(intent: string): void {
    switch (intent) {
      case 'open_case':
      case 'next_case':
      case 'previous_case':
      case 'first_case':
      case 'last_case':
      case 'goto_nth': this.scope = 'case_open'; break;
      case 'begin_findings': this.scope = 'dictating_findings'; break;
      case 'begin_impression': this.scope = 'dictating_impression'; break;
      case 'stop_dictation':
      case 'generate_impression': this.scope = 'case_open'; break;
      // sign_and_next stays in case_open after the (confirmed) sign + advance.
      default: break;
    }
  }
}
