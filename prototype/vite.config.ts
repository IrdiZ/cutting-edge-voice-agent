import { defineConfig } from 'vite';

// The sherpa-onnx streaming WASM (M3b) uses pthreads → needs SharedArrayBuffer →
// needs cross-origin isolation. COEP `credentialless` enables SAB while still
// allowing no-cors cross-origin fetches (so the transformers.js Whisper model
// download from the HF CDN keeps working). Applied to dev + preview.
const crossOriginIsolation = {
  name: 'cross-origin-isolation',
  configureServer(server: { middlewares: { use: (fn: (req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => void) => void } }) {
    server.middlewares.use((_req, res, next) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
      next();
    });
  },
};

export default defineConfig({
  plugins: [crossOriginIsolation],
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
});
