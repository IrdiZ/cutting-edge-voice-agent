// Minimal L1 command matcher — a STUB for the bench spine, not the product
// decoder. Phase 2 builds the real parallel cascade (regex/FST + SymSpell slots
// + Model2Vec + LLM fallback) per docs/SCAFFOLD-AND-PHASES.md. This version only does
// substring phrase matching on a partial so the trace/scorecard plumbing has
// something to fire on. It is deliberately dumb and deterministic.

export interface CommandDef {
  intent: string;
  /** Lowercased trigger phrasings; first match wins. */
  phrasings: string[];
  /** Cost tier gates the commit policy (A1/A6). Destructive must not fire eagerly. */
  tier: 'navigation' | 'dictation-control' | 'destructive';
}

export interface Match {
  intent: string;
  tier: CommandDef['tier'];
  /** Which phrasing matched. */
  phrase: string;
}

/** Return the first command whose phrasing appears in the (lowercased) partial text, else null. */
export function matchL1(text: string, commands: readonly CommandDef[]): Match | null {
  const hay = ` ${text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  for (const cmd of commands) {
    for (const phrase of cmd.phrasings) {
      if (hay.includes(` ${phrase} `)) {
        return { intent: cmd.intent, tier: cmd.tier, phrase };
      }
    }
  }
  return null;
}
