// VAD-gated recorder. The old fixed-3.5s-window recorder captured ~1s of speech in
// a sea of silence → small STT models hallucinated on the padding (WER > 100%).
// Silero VAD captures exactly the spoken segment (auto-timed, silence-trimmed), so
// every engine gets clean speech. Reuses the proven SileroVad wrapper.

import { SileroVad } from '../audio/vad.ts';

export class Recorder {
  // Generous capture config: big pre-roll so the first word is never clipped, lower
  // onset threshold so it triggers early, longer trailing so word-ends survive. (The
  // live cockpit uses tighter defaults; recording prioritizes completeness.)
  private vad = new SileroVad({
    preSpeechPadMs: 900,
    redemptionMs: 700,
    minSpeechMs: 120,
    positiveSpeechThreshold: 0.35,
  });
  private active = false;

  /** Listen until the user speaks one utterance; return the trimmed speech PCM
   * (16 kHz mono). Returns an empty array on timeout/error.
   *
   * WARMS UP the audio pipeline (~1s) BEFORE signalling 'listening', so the
   * pre-roll ring buffer is full and the first word is never clipped regardless of
   * when the user speaks — the system guarantees capture, not the user's timing. */
  async record(timeoutMs = 9000, onState?: (s: 'warming' | 'listening' | 'speaking') => void): Promise<Float32Array> {
    let resolveFn!: (a: Float32Array) => void;
    const result = new Promise<Float32Array>((r) => { resolveFn = r; });
    let done = false;
    const finish = (audio: Float32Array) => {
      if (done) return;
      done = true;
      this.active = false;
      this.vad.stop();
      resolveFn(audio);
    };
    this.active = true;
    await this.vad.start({
      onSpeechStart: () => onState?.('speaking'),
      onFrame: () => {},
      // Defensive COPY: vad-web may hand back a view into a buffer it reuses.
      onSpeechEnd: (audio) => finish(new Float32Array(audio)),
      onError: () => finish(new Float32Array(0)),
    });
    // Warm-up: let the mic pipeline + 900 ms pre-roll buffer fill before prompting.
    onState?.('warming');
    await new Promise((r) => setTimeout(r, 1100));
    if (!done) {
      onState?.('listening');
      setTimeout(() => finish(new Float32Array(0)), timeoutMs);
    }
    return result;
  }

  cancel(): void {
    if (this.active) { this.active = false; this.vad.stop(); }
  }
}

/** Peak amplitude of a PCM buffer in [0,1] — a quick "did we capture audio?" check. */
export function peakLevel(pcm: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]!); if (a > peak) peak = a; }
  return peak;
}

/** Play a 16 kHz PCM buffer so the user can hear what was captured. */
export function playPcm(pcm: Float32Array): void {
  const ctx = new AudioContext();
  const buf = ctx.createBuffer(1, pcm.length, 16000);
  buf.getChannelData(0).set(pcm);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.onended = () => void ctx.close();
  src.start();
}
