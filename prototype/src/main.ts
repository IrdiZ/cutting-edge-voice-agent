// Wires the prototype: adapter -> pipeline -> cockpit + HUD. The mic uses the
// Web Speech adapter (M1 first light); the Simulate buttons drive the SAME
// pipeline with synthetic on-device timing, so the loop + HUD are testable with
// no microphone (and so the latency numbers reflect what an on-device engine
// would produce, not the cloud round-trip).

import { Pipeline, type PipelineEvent } from './pipeline.ts';
import { Cockpit } from './cockpit.ts';
import { Hud } from './hud.ts';
import { WebSpeechAdapter, webSpeechAvailable } from './adapters/webspeech.ts';
import { OnDeviceAdapter } from './adapters/ondevice.ts';
import { SherpaStreamingAdapter } from './adapters/sherpa.ts';
import type { Partial, SttAdapter } from './adapters/types.ts';

const cockpit = new Cockpit();
const hud = new Hud();

const confirmBar = el('confirm-bar');
const confirmText = el('confirm-text');

const pipeline = new Pipeline((ev: PipelineEvent) => {
  switch (ev.type) {
    case 'begin': hud.begin(); break;
    case 'partial': hud.partial(ev.text, ev.isFinal); break;
    case 'pending':
      hud.pending(ev.match);
      confirmText.textContent = `${ev.match.title}?`;
      confirmBar.classList.remove('hidden');
      break;
    case 'pending-cleared': confirmBar.classList.add('hidden'); hud.cleared(); break;
    case 'command':
      hud.command(ev.match, ev.trace);
      cockpit.apply(ev.match);
      confirmBar.classList.add('hidden');
      break;
    case 'dictation-start': cockpit.startDictation(ev.target); break;
    case 'dictation': cockpit.dictate(ev.target, ev.text, ev.isFinal); break;
    case 'dictation-stop': cockpit.stopDictation(); break;
    case 'end': break;
  }
});

// ---- adapters (selectable: cloud Web Speech vs on-device WebGPU) ----
const statusEl = el('adapter-status');
const setStatus = (s: string) => { statusEl.textContent = s; statusEl.title = s; };

const adapters: Record<string, SttAdapter> = {
  webspeech: new WebSpeechAdapter(),
  ondevice: new OnDeviceAdapter(setStatus),
  sherpa: new SherpaStreamingAdapter(setStatus),
};
let current: SttAdapter = adapters.sherpa!; // bake-off winner: best command acc + streaming + CPU

const micBtn = el('mic-btn') as HTMLButtonElement;
const select = el('adapter-select') as HTMLSelectElement;
let micOn = false;
let starting = false; // guards the async start()/toggle race (ignore clicks mid-start)

const HOOKS = {
  onUtteranceStart: () => pipeline.begin(),
  onPartial: (p: Partial) => pipeline.feed(p),
  onError: (msg: string) => { el('foot-note').textContent = `${current.name} error: ${msg}`; },
};

function stopMic(): void {
  if (!micOn) return;
  current.stop();
  micOn = false;
  micBtn.textContent = '🎙 Start mic';
  micBtn.classList.remove('live');
  micBtn.setAttribute('aria-pressed', 'false');
}

const FOOT: Record<string, string> = {
  webspeech: '⛔ PHI PROHIBITED: Web Speech (Chrome→Google) streams live microphone audio — patient audio (PHI) — to a third party. Do NOT use it with patient audio. Cloud-backed, so it also misrepresents the on-device latency target. Use a streaming on-device engine.',
  ondevice: 'On-device Whisper (WebGPU) — audio never leaves the machine. ⚠ Whisper is chunk-based and hallucinates ("you") on short commands — use Streaming (sherpa) instead.',
  sherpa: 'On-device streaming (sherpa-onnx Zipformer, WASM/CPU) — true word-by-word partials, no Whisper hallucination. First start loads a ~190 MB model (one-time, local).',
};

function selectAdapter(key: string): void {
  stopMic();
  current = adapters[key] ?? adapters.webspeech!;
  hud.setSource(current.note);
  hud.setSyntheticMode(false); // a real engine is selected — numbers will be measured
  el('foot-note').innerHTML = FOOT[key] ?? '';
  setStatus(key === 'webspeech' ? (webSpeechAvailable() ? 'cloud · ready' : 'cloud · n/a') : 'click mic to load model');
}

select.addEventListener('change', () => selectAdapter(select.value));

micBtn.addEventListener('click', async () => {
  if (starting) return; // a start() is already in flight — ignore the race
  if (micOn) { stopMic(); return; }
  starting = true;
  micOn = true;
  hud.setSyntheticMode(false); // a live engine's timings are measured, never synthetic
  micBtn.textContent = '⏹ Stop mic';
  micBtn.classList.add('live');
  micBtn.setAttribute('aria-pressed', 'true');
  try {
    await current.start(HOOKS); // on-device: first call downloads + compiles the model
  } catch (err) {
    // Graceful degradation: a failed start must NOT leave a zombie 'live' button.
    micOn = false;
    micBtn.textContent = '🎙 Start mic';
    micBtn.classList.remove('live');
    micBtn.setAttribute('aria-pressed', 'false');
    el('foot-note').textContent = `${current.name} failed to start: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    starting = false;
  }
});

select.value = 'sherpa';
selectAdapter('sherpa');

// ---- confirm / cancel for destructive commands ----
el('confirm-btn').addEventListener('click', () => {
  pipeline.confirmPending();
  confirmBar.classList.add('hidden');
});
el('cancel-btn').addEventListener('click', () => {
  pipeline.cancelPending();
  confirmBar.classList.add('hidden');
});

// Escape anywhere is a hard cancel of any pending destructive (zero-click safety).
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    pipeline.cancelPending();
    confirmBar.classList.add('hidden');
  }
});

// ---- simulate (no mic) ----
const SCRIPTS: { label: string; phrase: string }[] = [
  { label: 'open the Anderson case', phrase: 'open the Anderson case' },
  { label: 'open the Patel case', phrase: 'open the Patel case' },
  { label: 'open "Petell" → Patel (fuzzy)', phrase: 'open the Petell case' },
  { label: 'begin findings', phrase: 'begin findings' },
  { label: 'dictate a sentence', phrase: 'there is a small nodule in the right upper lobe' },
  { label: 'dictate w/ "sign"+"next" (must NOT fire)', phrase: 'the patient signed consent and we will sign off after the next study' },
  { label: 'generate impression', phrase: 'generate the impression please' },
  { label: 'next case', phrase: 'go to the next case' },
  { label: 'first case', phrase: 'go to the first case' },
  { label: 'last case', phrase: 'go to the last case' },
  { label: 'go to the third', phrase: 'go to the third case' },
  { label: 'compare prior', phrase: 'compare with the prior study' },
  { label: 'sign & next (destructive)', phrase: 'sign and next' },
];

const TTFP_MS = 60; // synthetic on-device time-to-first-partial
const PER_WORD_MS = 40; // synthetic per-word emission
const WALL_STEP_MS = 110; // animation pacing (decoupled from synthetic tMs)

const simWrap = el('sim-buttons');
for (const s of SCRIPTS) {
  const b = document.createElement('button');
  b.className = 'btn';
  b.textContent = s.label;
  b.addEventListener('click', () => simulate(s.phrase));
  simWrap.appendChild(b);
}

function simulate(phrase: string): void {
  stopMic();
  hud.setSyntheticMode(true); // these timings are synthetic, not measured
  const words = phrase.split(/\s+/);
  pipeline.begin();
  words.forEach((_, i) => {
    const text = words.slice(0, i + 1).join(' ');
    const isFinal = i === words.length - 1;
    const tMs = TTFP_MS + i * PER_WORD_MS + (isFinal ? 300 : 0); // final pays a synthetic endpoint wait
    window.setTimeout(() => pipeline.feed({ text, isFinal, tMs } satisfies Partial), i * WALL_STEP_MS);
  });
}

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing`);
  return node;
}
