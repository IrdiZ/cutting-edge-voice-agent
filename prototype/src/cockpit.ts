// Mock reporting cockpit — the UI that reacts to commands. Deliberately a thin
// stub: enough surface to SEE a command take effect (worklist nav, findings,
// async impression, prior, sign), with a tiny undo history.

import { WORKLIST } from './commands.ts';
import type { Match } from './decoder.ts';
import type { DictTarget } from './pipeline.ts';

interface CaseState {
  findings: string;
  impression: string;
  signed: boolean;
}

export class Cockpit {
  private idx = -1;
  private cases: CaseState[] = WORKLIST.map(() => ({ findings: '', impression: '', signed: false }));
  private history: { idx: number; snapshot: CaseState }[] = [];
  private dictTarget: DictTarget | null = null;
  private dictBuf = '';

  // DOM refs
  private wl = byId('worklist');
  private title = byId('case-title');
  private statusEl = byId('case-status');
  private findingsEl = byId('findings');
  private impressionEl = byId('impression');
  private impChip = byId('imp-chip');
  private prior = byId('prior');

  constructor() {
    this.renderWorklist();
  }

  apply(m: Match): void {
    switch (m.intent) {
      case 'open_case': this.openByName(m.slotName); break;
      case 'next_case': this.select(this.idx + 1); break;
      case 'previous_case': this.select(this.idx - 1); break;
      case 'first_case': this.select(0); break;
      case 'last_case': this.select(WORKLIST.length - 1); break;
      case 'goto_nth': if (m.slotNumber) this.select(m.slotNumber - 1); break;
      case 'compare_prior': this.prior.classList.toggle('hidden'); break;
      case 'generate_impression': this.generateImpression(); break;
      case 'undo': this.undo(); break;
      case 'sign_and_next': this.signAndNext(); break;
      // begin_findings / begin_impression / stop_dictation are driven by the
      // pipeline's dictation-start/stop events (startDictation/stopDictation), not here.
    }
  }

  // ── Dictation lane: speech routed into a report field ──
  startDictation(target: DictTarget): void {
    if (this.idx < 0) this.select(0);
    this.snapshot();
    this.dictTarget = target;
    this.dictBuf = '';
    this.setBody(this.fieldEl(target), '…', true);
    this.setStatus('dictating');
  }

  dictate(target: DictTarget, text: string, isFinal: boolean): void {
    const live = `${this.dictBuf} ${text}`.trim();
    this.setBody(this.fieldEl(target), live || '…', !live);
    // Persist on EVERY call, not only on isFinal: a partial-only utterance (no
    // final ever arrives — e.g. mic cut) must not be lost. dictBuf only advances
    // on isFinal so the running buffer isn't double-appended across partials.
    if (this.idx >= 0) this.cases[this.idx]![target] = live;
    if (isFinal) this.dictBuf = live;
  }

  stopDictation(): void {
    if (this.dictTarget && this.idx >= 0) {
      // The spoken "stop" can leak in as a prematurely-finalized fragment ("sto"/"stop")
      // just before stop_dictation fires. Strip a trailing stop-homophone token so it
      // doesn't persist in the report (the reported "STO" artifact).
      const text = stripTrailingStop(this.dictBuf);
      this.dictBuf = text;
      this.cases[this.idx]![this.dictTarget] = text;
      this.setBody(this.fieldEl(this.dictTarget), text || '—', !text);
    }
    this.dictTarget = null;
    if (this.idx >= 0) this.setStatus(this.cases[this.idx]!.signed ? 'signed' : 'open');
  }

  private fieldEl(target: DictTarget): HTMLElement {
    return target === 'findings' ? this.findingsEl : this.impressionEl;
  }

  private openByName(name?: string): void {
    // No silent default-to-first-case (that hid the slot bug). Slot-gating in the
    // decoder means open_case only fires once a name resolves, so `name` is set.
    if (!name) return;
    const i = WORKLIST.findIndex((w) => w.name.toLowerCase() === name.toLowerCase());
    if (i >= 0) this.select(i);
  }

  private select(i: number): void {
    if (i < 0 || i >= WORKLIST.length) return;
    this.idx = i;
    const w = WORKLIST[i]!;
    const c = this.cases[i]!;
    this.title.textContent = `${w.name} · ${w.id}`;
    this.setStatus(c.signed ? 'signed' : 'open');
    this.setBody(this.findingsEl, c.findings || '—', !c.findings);
    this.setBody(this.impressionEl, c.impression || '—', !c.impression);
    this.renderWorklist();
  }

  private generateImpression(): void {
    if (this.idx < 0) return;
    const c = this.cases[this.idx]!;
    this.snapshot();
    this.impChip.classList.remove('hidden'); // async "generating…" chip
    window.setTimeout(() => {
      c.impression = 'No acute, actionable finding. Routine follow-up as clinically indicated.';
      this.setBody(this.impressionEl, c.impression, false);
      this.impChip.classList.add('hidden');
    }, 650);
  }

  private signAndNext(): void {
    if (this.idx < 0) return;
    const c = this.cases[this.idx]!;
    this.snapshot(); // BEFORE signing, so undo can revert the signature (never-event)
    c.signed = true;
    this.setStatus('signed');
    this.renderWorklist();
    const next = this.idx + 1;
    if (next < WORKLIST.length) window.setTimeout(() => this.select(next), 500);
  }

  private undo(): void {
    const last = this.history.pop();
    if (!last) return;
    this.cases[last.idx] = last.snapshot;
    if (last.idx === this.idx) this.select(this.idx);
  }

  private snapshot(): void {
    if (this.idx < 0) return;
    this.history.push({ idx: this.idx, snapshot: { ...this.cases[this.idx]! } });
    if (this.history.length > 20) this.history.shift();
  }

  private setStatus(s: 'idle' | 'open' | 'dictating' | 'signed'): void {
    this.statusEl.textContent = s;
    this.statusEl.className = 'status' + (s === 'dictating' ? ' dictating' : s === 'signed' ? ' signed' : '');
  }

  private setBody(el: HTMLElement, text: string, muted: boolean): void {
    el.textContent = text;
    el.classList.toggle('muted', muted);
    el.classList.remove('flash');
    void el.offsetWidth; // reflow to restart the animation
    el.classList.add('flash');
  }

  private renderWorklist(): void {
    this.wl.innerHTML = '';
    WORKLIST.forEach((w, i) => {
      const li = document.createElement('li');
      li.className = (i === this.idx ? 'active ' : '') + (this.cases[i]!.signed ? 'signed' : '');
      // Escape name + id: once the worklist is a real patient feed these are a
      // PHI-XSS sink (a name like `<img onerror>` would execute via innerHTML).
      li.innerHTML = `<span class="pname">${escapeHtml(w.name)}</span><span class="pid">${escapeHtml(w.id)}</span>`;
      if (this.cases[i]!.signed) li.innerHTML += '<span class="sig">SIGNED</span>';
      this.wl.appendChild(li);
    });
  }
}

/** Minimal HTML-entity escape for values interpolated into innerHTML — the
 * worklist name/id are a PHI-XSS sink once they come from a real feed. EXPORTED
 * so tests can pin it. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

/** Remove a trailing stop-command homophone ("sto"/"stop"/"stops") that leaked into the
 * report as a prematurely-finalized dictation fragment just before stop_dictation fired.
 * EXPORTED so tests can pin it. */
export function stripTrailingStop(text: string): string {
  const toks = text.split(/\s+/);
  const last = (toks[toks.length - 1] ?? '').toLowerCase().replace(/[^a-z]/g, '');
  const STOP_ARTIFACTS = new Set(['sto', 'stop', 'stops', 'stopp', 'stp', 'stahp', 'staap']);
  if (last && STOP_ARTIFACTS.has(last)) { toks.pop(); return toks.join(' ').trimEnd(); }
  return text;
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
}
