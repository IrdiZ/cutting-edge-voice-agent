// Web Speech API adapter — the M1 first light. Zero install; gives live interim
// results so the whole fire-on-partial loop is exercised today.
//
// ⚠ In Chrome this is CLOUD-BACKED (audio → Google). It validates the LOOP and
// the measurement structure, NOT the on-device latency target. M2 replaces it
// with an on-device WebGPU engine behind this same SttAdapter interface.

import type { AdapterHooks, SttAdapter } from './types.ts';

// Minimal local shape — avoids depending on lib.dom's (partial) SpeechRecognition typings.
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onspeechstart: (() => void) | null;
  onend: (() => void) | null;
}
interface RecognitionEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

export function webSpeechAvailable(): boolean {
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w['SpeechRecognition'] || w['webkitSpeechRecognition']);
}

export class WebSpeechAdapter implements SttAdapter {
  readonly name = 'Web Speech API';
  readonly note = 'cloud-backed (Chrome→Google) — validates the loop, not the latency target';

  private rec: Recognition | null = null;
  private running = false;
  private active = false; // inside an utterance segment
  private t0 = 0;
  // onend fires on every error/timeout; restarting in a tight loop becomes a storm and,
  // once the engine is wedged, a silently dead mic. Back off, and after a ceiling surface
  // an error and STOP restarting (never a silent dead mic — the user must be told).
  private restarts = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private lastStartMs = 0; // when rec.start() last fired — a long-lived session is healthy
  private static readonly RESTART_BASE_MS = 250;
  private static readonly RESTART_MAX_MS = 4000;
  private static readonly RESTART_CEILING = 8;

  async start(hooks: AdapterHooks): Promise<void> {
    const w = window as unknown as Record<string, unknown>;
    const Ctor = (w['SpeechRecognition'] || w['webkitSpeechRecognition']) as
      | (new () => Recognition)
      | undefined;
    if (!Ctor) {
      hooks.onError?.('Web Speech API not available in this browser');
      return;
    }
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;

    const begin = () => {
      this.active = true;
      this.t0 = performance.now();
      hooks.onUtteranceStart();
    };

    rec.onspeechstart = () => { if (!this.active) begin(); };
    rec.onresult = (e: RecognitionEvent) => {
      this.restarts = 0; // a real result means the engine is healthy — reset the backoff
      if (!this.active) begin();
      const r = e.results[e.results.length - 1];
      if (!r) return;
      const alt = r[0];
      if (!alt) return;
      hooks.onPartial({ text: alt.transcript, isFinal: r.isFinal, tMs: performance.now() - this.t0 });
      if (r.isFinal) this.active = false;
    };
    rec.onerror = (ev) => {
      if (ev.error && ev.error !== 'no-speech' && ev.error !== 'aborted') hooks.onError?.(ev.error);
    };
    rec.onend = () => {
      if (!this.running) return;
      // A session that ran a while before ending was healthy (a silence/no-speech
      // timeout), not a restart storm — clear the backoff so an idle-but-working mic
      // is never permanently disabled. The ceiling only catches tight restart loops.
      if (Date.now() - this.lastStartMs > 3000) this.restarts = 0;
      if (this.restarts >= WebSpeechAdapter.RESTART_CEILING) {
        // Give up rather than spin: tell the user instead of leaving a silent dead mic.
        this.running = false;
        hooks.onError?.('speech recognition keeps failing to restart — mic stopped, please retry');
        return;
      }
      const delay = Math.min(
        WebSpeechAdapter.RESTART_MAX_MS,
        WebSpeechAdapter.RESTART_BASE_MS * 2 ** this.restarts,
      );
      this.restarts++;
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        if (!this.running) return; // stop() raced us
        try { this.lastStartMs = Date.now(); rec.start(); } catch { /* restart race: onend will fire again and re-schedule */ }
      }, delay);
    };

    this.rec = rec;
    this.running = true;
    this.restarts = 0;
    this.lastStartMs = Date.now();
    rec.start();
  }

  stop(): void {
    this.running = false;
    this.active = false;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    this.restarts = 0;
    try { this.rec?.stop(); } catch { /* noop */ }
  }
}
