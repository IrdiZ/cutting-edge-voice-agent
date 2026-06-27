// The live HUD: transcript, last command, latency breakdown, command log.

import type { Match } from './decoder.ts';
import type { TraceSummary } from './trace.ts';

export class Hud {
  private transcript = byId('transcript');
  private lastCmd = byId('last-cmd');
  private ttfp = byId('lat-ttfp');
  private dec = byId('lat-dec');
  private m2c = byId('lat-m2c');
  private note = byId('lat-note');
  private log = byId('cmd-log');
  private synthetic = false; // true when numbers come from the Simulate buttons
  private sourceNote = ''; // last provenance note (cloud vs on-device)

  setSource(note: string): void {
    this.sourceNote = note.includes('cloud') ? '· cloud, not on-device' : '· on-device ✓';
    this.renderNote();
  }

  /** Mark the latency numbers as SYNTHETIC (Simulate buttons) vs real, so a green
   * sub-100 badge is never mistaken for a measurement. */
  setSyntheticMode(on: boolean): void {
    this.synthetic = on;
    this.renderNote();
  }

  private renderNote(): void {
    this.note.textContent = this.synthetic ? '· SYNTHETIC (simulated timing)' : this.sourceNote;
    this.note.classList.toggle('synthetic', this.synthetic);
  }

  begin(): void {
    this.transcript.innerHTML = '<span class="interim">…</span>';
  }

  partial(text: string, isFinal: boolean): void {
    this.transcript.innerHTML = `<span class="${isFinal ? 'final' : 'interim'}">${escape(text)}</span>`;
  }

  pending(m: Match): void {
    this.lastCmd.innerHTML = `<span class="intent">${escape(m.intent)}</span> — <span class="slot">pending confirm ⚠</span>`;
  }

  /** A pending destructive was cancelled (Escape / Cancel / fail-closed) — clear the
   * stale "pending confirm ⚠" so the HUD never implies a signature is still armed. */
  cleared(): void {
    this.lastCmd.innerHTML = '<span class="slot">— cancelled</span>';
  }

  command(m: Match, t: TraceSummary): void {
    this.lastCmd.innerHTML =
      `<span class="intent">${escape(m.intent)}</span>` + (m.slotName ? ` · <span class="slot">${escape(m.slotName)}</span>` : '');
    this.setMs(this.ttfp, t.ttfp);
    this.setMs(this.dec, t.decode);
    this.setMs(this.m2c, t.m2c, true);
    this.addLog(m, t);
  }

  private addLog(m: Match, t: TraceSummary): void {
    const li = document.createElement('li');
    if (m.tier === 'destructive') li.className = 'destructive';
    const m2c = t.m2c === null ? '–' : `${t.m2c} ms${this.synthetic ? ' (sim)' : ''}`;
    li.innerHTML = `<span class="ci">${escape(m.intent)}${m.slotName ? ' · ' + escape(m.slotName) : ''}</span><span class="cm">${m2c}</span>`;
    this.log.prepend(li);
    while (this.log.children.length > 12) this.log.lastChild?.remove();
  }

  private setMs(el: HTMLElement, v: number | null, headline = false): void {
    if (v === null) { el.textContent = '– ms'; el.classList.remove('sub100'); return; }
    el.textContent = `${v} ms`;
    if (headline) el.classList.toggle('sub100', v < 100);
  }
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
}

function escape(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c));
}
