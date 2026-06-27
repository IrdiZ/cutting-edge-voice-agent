// sherpa-onnx streaming recognizer in a Web Worker (Speed L7) — the STT decode loop
// runs OFF the main thread so it can never stall the UI.
//
// ⛔ BLOCKED (verified 2026-06-09): the vendored sherpa bundle is an Emscripten
// *pthreads* build. A pthreads module bootstraps its thread pool assuming it is THE
// main thread; loaded inside a custom Worker via importScripts the init DEADLOCKS
// (onRuntimeInitialized never fires) — it works only in the window. No single-thread
// pre-built WASM exists in the k2-fsa releases (all are wasm-simd = pthreads). To
// unblock: build a single-thread SIMD sherpa WASM from source (emscripten, no -pthread).
// This file is correct + ready for that bundle. Not imported by the app today.
//
// Classic worker (importScripts) because the vendored sherpa scripts are classic +
// use a global Emscripten `Module`. SharedArrayBuffer is available (COOP/COEP).
//
// Protocol (main ↔ worker):
//   → { type:'audio', sampleRate, pcm }   stream a frame; worker replies 'partial'
//   ← { type:'ready' }                     recognizer constructed
//   ← { type:'partial', text, tokens, timestamps, endpoint }
//   → { type:'transcribe', sampleRate, pcm }  offline one-shot (for the bench/self-test)
//   ← { type:'final', text }

let recognizer = null;
let stream = null;
let ready = false;

self.Module = {
  locateFile: (p) => '/sherpa/' + String(p).split('/').pop(),
  onRuntimeInitialized: () => {
    recognizer = self.createOnlineRecognizer(self.Module);
    stream = recognizer.createStream();
    ready = true;
    self.postMessage({ type: 'ready' });
  },
};

try {
  importScripts('/sherpa/sherpa-onnx-asr.js'); // defines createOnlineRecognizer
  importScripts('/sherpa/sherpa-onnx-wasm-main-asr.js'); // boots Module → onRuntimeInitialized
} catch (e) {
  self.postMessage({ type: 'error', message: String((e && e.message) || e) });
}

self.onmessage = (e) => {
  const msg = e.data;
  if (!ready) { self.postMessage({ type: 'error', message: 'not ready' }); return; }

  if (msg.type === 'audio') {
    stream.acceptWaveform(msg.sampleRate, msg.pcm);
    while (recognizer.isReady(stream)) recognizer.decode(stream);
    const r = recognizer.getResult(stream);
    const endpoint = recognizer.isEndpoint(stream);
    self.postMessage({ type: 'partial', text: r.text, tokens: r.tokens, timestamps: r.timestamps, endpoint });
    if (endpoint) recognizer.reset(stream);
  } else if (msg.type === 'transcribe') {
    // offline one-shot: feed the whole buffer + tail padding, return the final text
    const s = recognizer.createStream();
    s.acceptWaveform(msg.sampleRate, msg.pcm);
    s.acceptWaveform(msg.sampleRate, new Float32Array(8000));
    while (recognizer.isReady(s)) recognizer.decode(s);
    self.postMessage({ type: 'final', text: recognizer.getResult(s).text });
  } else if (msg.type === 'reset') {
    recognizer.reset(stream);
  }
};
