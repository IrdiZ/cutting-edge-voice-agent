// STT bake-off bench — record the script once, replay every engine on the same
// audio, score WER + command-intent accuracy + RTF. The keystone for per-component
// tuning on REAL audio (otherwise we tune blind on synthetic/clean text).

import { SCRIPT, type Prompt } from './script.ts';
import { Recorder, peakLevel, playPcm } from './recorder.ts';
import { putRecording, getAllRecordings } from './store.ts';
import { ENGINES, type Engine } from './engines.ts';
import { wer, mean, pct } from './wer.ts';
import { classifyAtScope } from '../separator/index.ts';

const recorder = new Recorder();
const recordings = new Map<string, Float32Array>(); // id -> pcm
const status = (s: string) => { byId('bench-status').textContent = s; };

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
}

function renderPrompts(): void {
  const wrap = byId('prompts');
  wrap.innerHTML = '';
  for (const p of SCRIPT) {
    const row = document.createElement('div');
    row.className = `prow ${p.kind}`;
    const pcm = recordings.get(p.id);
    const have = !!pcm && pcm.length > 0;
    // Level check: peak < ~0.02 means little/no audio captured → likely too quiet.
    const peak = have ? peakLevel(pcm!) : 0;
    const dur = have ? (pcm!.length / 16000).toFixed(1) + 's' : '';
    const lvl = !have ? '—' : peak < 0.02 ? `⚠ quiet (${peak.toFixed(3)})` : `✓ ${dur} · lvl ${peak.toFixed(2)}`;
    const lvlClass = !have ? 'empty' : peak < 0.02 ? 'empty' : 'recorded';
    row.innerHTML =
      `<span class="pid">${p.id}</span>` +
      `<span class="psay"><span class="k">${p.kind === 'command' ? p.intent : 'dictation'}</span>${p.say}</span>` +
      `<span style="display:flex;gap:6px"><button class="btn rec-one" data-id="${p.id}">${have ? 're-record' : 'record'}</button>` +
      `<button class="btn play-one" data-id="${p.id}" ${have ? '' : 'disabled'}>▶</button></span>` +
      `<span class="pstate ${lvlClass}">${lvl}</span>`;
    wrap.appendChild(row);
  }
  wrap.querySelectorAll('.rec-one').forEach((b) =>
    b.addEventListener('click', () => recordOne((b as HTMLElement).dataset.id!)));
  wrap.querySelectorAll('.play-one').forEach((b) =>
    b.addEventListener('click', () => { const pcm = recordings.get((b as HTMLElement).dataset.id!); if (pcm) playPcm(pcm); }));
}

async function recordOne(id: string): Promise<void> {
  const p = SCRIPT.find((x) => x.id === id)!;
  const stateMsg: Record<'warming' | 'listening' | 'speaking', string> = {
    warming: `⏳ wait… (getting ready for "${p.say}")`,
    listening: `🟢 SPEAK NOW: "${p.say}"`,
    speaking: `🎙 capturing "${p.say}"…`,
  };
  const pcm = await recorder.record(9000, (s) => status(stateMsg[s]));
  if (pcm.length === 0) { status(`no speech detected for ${id} — try again (speak after the prompt)`); return; }
  recordings.set(id, pcm);
  await putRecording(id, pcm);
  status(`saved ${id} (${(pcm.length / 16000).toFixed(1)}s, peak ${peakLevel(pcm).toFixed(2)})`);
  renderPrompts();
}

async function recordAll(): Promise<void> {
  for (const p of SCRIPT) {
    if (p.id === 'px') continue; // skip the synthetic-probe row
    await recordOne(p.id); // record() warms up + shows "SPEAK NOW" itself
    await new Promise((r) => setTimeout(r, 500)); // breath between prompts
  }
  status('session recorded — check levels (▶), then run the bake-off');
}

// Verify the replay+metrics path with a known clip when no mic recording exists.
// This is the ONLY network fetch in the bench; it must degrade gracefully offline so
// the page never crashes — fall back to a clear status and let the user record instead.
async function loadSynthetic(): Promise<void> {
  status('fetching JFK clip…');
  try {
    const buf = await (await fetch('https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav')).arrayBuffer();
    const ac = new OfflineAudioContext(1, 1, 16000);
    const decoded = await ac.decodeAudioData(buf);
    const pcm = decoded.getChannelData(0).slice();
    // Store under the dedicated probe row 'px' — never clobber a real recording.
    recordings.set('px', pcm);
    await putRecording('px', pcm);
    status('loaded JFK as probe (px) — run the bake-off to verify the pipeline');
    renderPrompts();
  } catch (e) {
    // Offline / CDN blocked / decode failure — never throw out of a click handler.
    status(`probe fetch failed (offline?) — ${e instanceof Error ? e.message : String(e)}. Record a session to run the bake-off.`);
  }
}

function intentHit(p: Prompt, transcript: string): boolean {
  if (p.kind !== 'command') return false;
  const d = classifyAtScope(transcript, p.scope);
  return (d.decision === 'command' || d.decision === 'pending') && 'intent' in d && d.intent === p.intent;
}

async function run(): Promise<void> {
  // Reload from IndexedDB (structured-clone copies — immune to any in-memory buffer
  // reuse) so the bake-off scores exactly the audio that was persisted.
  for (const [id, pcm] of await getAllRecordings()) recordings.set(id, pcm);
  if (recordings.size === 0) { status('no recordings — record the session or load synthetic first'); return; }
  const items = SCRIPT.filter((p) => recordings.has(p.id));
  const cmds = items.filter((p) => p.kind === 'command');
  const dicts = items.filter((p) => p.kind === 'dictation');

  type Row = { engine: string; note: string; wer: number; cmdAcc: number; far: number; rtfMs: number };
  const rows: Row[] = [];
  const transcripts = new Map<string, Map<string, string>>(); // id -> engine -> text

  for (const eng of ENGINES) {
    try {
      const transcribe = await loadEngine(eng);
      const wers: number[] = [];
      let cmdOk = 0;
      let falseFire = 0;
      let totalMs = 0;
      let totalAudioMs = 0;
      for (const p of items) {
        const pcm = recordings.get(p.id)!;
        const t0 = performance.now();
        const text = await transcribe(pcm);
        totalMs += performance.now() - t0;
        totalAudioMs += (pcm.length / 16000) * 1000;
        wers.push(wer(p.say, text));
        if (p.kind === 'command' && intentHit(p, text)) cmdOk++;
        if (p.kind === 'dictation') {
          const d = classifyAtScope(text, p.scope);
          if (d.decision === 'command' || d.decision === 'pending') falseFire++;
        }
        // DIAGNOSTIC: record what the engine actually returned.
        if (!transcripts.has(p.id)) transcripts.set(p.id, new Map());
        transcripts.get(p.id)!.set(eng.key, text);
        console.log(`[${eng.key}] ${p.id} (${(pcm.length / 16000).toFixed(1)}s) → "${text}"`);
      }
      rows.push({
        engine: eng.key, note: eng.note,
        wer: mean(wers),
        cmdAcc: cmds.length ? cmdOk / cmds.length : NaN,
        far: dicts.length ? falseFire / dicts.length : NaN,
        rtfMs: totalAudioMs ? totalMs / totalAudioMs : NaN,
      });
      renderScorecard(rows);
      renderTranscripts(items, transcripts); // incremental — a slow engine never hides earlier ones
    } catch (e) {
      status(`${eng.key} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  renderTranscripts(items, transcripts);
  status(`done — ${items.length} recordings × ${ENGINES.length} engines (see transcripts below)`);
}

const engineCache = new Map<string, (pcm: Float32Array) => Promise<string>>();
async function loadEngine(eng: Engine): Promise<(pcm: Float32Array) => Promise<string>> {
  if (!engineCache.has(eng.key)) {
    status(`loading ${eng.key}…`);
    engineCache.set(eng.key, await eng.load(status));
  }
  return engineCache.get(eng.key)!;
}

function renderScorecard(rows: { engine: string; note: string; wer: number; cmdAcc: number; far: number; rtfMs: number }[]): void {
  // Safety-first 'best': an engine that false-fires on dictation is never best, however
  // high its cmd-intent acc (a destructive false-fire is a never-event). So pick the
  // FEWEST false-fires first, then break ties by cmd-intent acc. Unknown far (NaN) is
  // treated as worst, so a known-safe engine always beats an unmeasured one.
  const safer = (r: { far: number }) => (Number.isFinite(r.far) ? r.far : Infinity);
  const best = rows.reduce((a, b) => {
    if (safer(b) !== safer(a)) return safer(b) < safer(a) ? b : a;
    return b.cmdAcc > a.cmdAcc ? b : a;
  }, rows[0]!);
  // Caveat if some OTHER engine ties/leads on cmd-intent acc but false-fires — so the
  // reader doesn't read the cmd-acc column alone and pick an unsafe engine.
  const unsafeLeader = rows.some((r) => r !== best && Number.isFinite(r.far) && r.far > 0 && r.cmdAcc >= best.cmdAcc);
  const body = rows.map((r) =>
    `<tr class="${r === best ? 'best' : ''}">` +
    `<td><b>${r.engine}</b><br><span style="color:var(--dim);font-size:11px">${r.note}</span></td>` +
    `<td>${pct(r.wer)}</td><td><b>${pct(r.cmdAcc)}</b></td><td>${pct(r.far)}</td><td>${r.rtfMs.toFixed(3)}× RT</td></tr>`,
  ).join('');
  const caveat = unsafeLeader
    ? `<div class="hint" style="color:var(--warn)">⚠ “best” = safest (fewest false-fires) then highest cmd-intent acc — a higher-accuracy engine that false-fires on dictation is NOT best (medico-legal).</div>`
    : '';
  byId('scorecard').innerHTML =
    `<table class="score"><thead><tr><th>engine</th><th>WER↓</th><th>cmd-intent acc↑</th><th>false-fire↓</th><th>speed</th></tr></thead><tbody>${body}</tbody></table>` +
    caveat +
    `<div class="hint">WER = word error rate vs your script. cmd-intent acc = % of command prompts that fired the right intent (STT → separator). false-fire = % of dictation prompts that wrongly fired a command. speed = transcribe time ÷ audio duration (lower = faster). “best” row = safest then most accurate.</div>`;
}

function renderTranscripts(items: Prompt[], transcripts: Map<string, Map<string, string>>): void {
  const engKeys = ENGINES.map((e) => e.key);
  const head = `<tr><th>id</th><th>ground truth</th>${engKeys.map((k) => `<th>${k}</th>`).join('')}</tr>`;
  const body = items.map((p) => {
    const m = transcripts.get(p.id);
    const cells = engKeys.map((k) => `<td>${(m?.get(k) ?? '').replace(/[&<>]/g, ' ') || '<span style="color:var(--warn)">∅ empty</span>'}</td>`).join('');
    return `<tr><td>${p.id}</td><td><b>${p.say}</b></td>${cells}</tr>`;
  }).join('');
  const el = document.getElementById('transcripts') ?? (() => { const d = document.createElement('div'); d.id = 'transcripts'; byId('scorecard').after(d); return d; })();
  el.innerHTML = `<h3 style="margin:20px 0 8px;font-size:15px">Transcripts (diagnostic)</h3><table class="score">${head}${body}</table>`;
}

byId('rec-all').addEventListener('click', () => void recordAll());
byId('load-synth').addEventListener('click', () => void loadSynthetic());
byId('run').addEventListener('click', () => void run());

void (async () => {
  for (const [id, pcm] of await getAllRecordings()) recordings.set(id, pcm);
  renderPrompts();
  status(recordings.size ? `${recordings.size} recordings loaded from last session` : 'record the session to begin');
})();
