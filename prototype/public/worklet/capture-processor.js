// AudioWorklet capture processor (Speed L6) — runs on the dedicated audio render
// thread, NOT the main thread. Accumulates the 128-sample render quanta into
// `frameSize`-sample frames, computes RMS, and posts {pcm, rms} to the main thread
// (transferring the buffer, zero-copy). Replaces the deprecated ScriptProcessorNode,
// which ran on the main thread and could stall on GC.

class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.frameSize = opts.frameSize || 2048;
    this.buf = new Float32Array(this.frameSize);
    this.off = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const ch = input && input[0];
    if (!ch) return true; // no input connected yet — keep the node alive
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.off++] = ch[i];
      if (this.off === this.frameSize) {
        const pcm = this.buf.slice(0); // copy the full frame out
        let sum = 0;
        for (let j = 0; j < pcm.length; j++) sum += pcm[j] * pcm[j];
        this.port.postMessage({ pcm, rms: Math.sqrt(sum / pcm.length) }, [pcm.buffer]);
        this.off = 0;
      }
    }
    return true; // stay alive across the session
  }
}

registerProcessor('capture-processor', CaptureProcessor);
