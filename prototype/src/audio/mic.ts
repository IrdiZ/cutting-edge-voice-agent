// Mic capture for the on-device lane: getUserMedia -> AudioContext @16kHz ->
// AudioWorklet frames (Float32 PCM + RMS energy). We REQUEST 16 kHz because that's
// what Whisper/Moonshine/sherpa expect, but the browser MAY ignore the sampleRate
// hint — so we publish the context's actual rate via `sampleRate` and callers
// (sherpa.acceptWaveform) must pass that, not assume 16 kHz. Resampling is the
// recognizer's job when the rates differ.
//
// Speed L6: capture runs in an AudioWorklet (public/worklet/capture-processor.js)
// on the audio render thread, NOT the main thread — no GC/layout jank stalling the
// frame callback (the old ScriptProcessorNode ran on the main thread).

export interface MicFrame {
  pcm: Float32Array; // mono, ctx sample rate (≈16 kHz)
  rms: number; // frame energy, for the simple VAD
}

const TARGET_SR = 16000;
const BUFFER = 2048; // ~128 ms per frame at 16 kHz
const WORKLET_URL = '/worklet/capture-processor.js';

export class Mic {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private sink: GainNode | null = null;
  sampleRate = TARGET_SR;

  async start(onFrame: (f: MicFrame) => void): Promise<void> {
    // Idempotent guard: a double-start would strand the first stream + AudioContext.
    if (this.ctx || this.stream) this.stop();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.ctx = new AudioContext({ sampleRate: TARGET_SR });
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.sampleRate = this.ctx.sampleRate; // may differ if the browser ignored the hint

      await this.ctx.audioWorklet.addModule(WORKLET_URL);
      this.src = this.ctx.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.ctx, 'capture-processor', {
        numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1,
        processorOptions: { frameSize: BUFFER },
      });
      this.node.port.onmessage = (e: MessageEvent<MicFrame>) => onFrame(e.data);

      // Keep the node in the graph via a muted gain → destination (no feedback).
      this.sink = this.ctx.createGain();
      this.sink.gain.value = 0;
      this.src.connect(this.node);
      this.node.connect(this.sink);
      this.sink.connect(this.ctx.destination);
    } catch (e) {
      // Partial failure: release whatever was created so we don't strand a live
      // track or open AudioContext.
      this.stop();
      throw e;
    }
  }

  stop(): void {
    // Idempotent: every step is null-guarded and we null all refs.
    if (this.node) this.node.port.onmessage = null; // drop the callback so no frame fires after stop
    this.node?.disconnect();
    this.src?.disconnect();
    this.sink?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close();
    this.ctx = this.stream = this.node = this.src = this.sink = null;
  }
}

export function concatFloat32(chunks: readonly Float32Array[]): Float32Array {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Float32Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
