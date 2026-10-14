#!/usr/bin/env sh
# Fetch the large runtime files that are not stored in git.
# Run once after `npm install`:  npm run setup
set -eu
cd "$(dirname "$0")/.."

SHERPA_VERSION=1.13.2
ARCHIVE="sherpa-onnx-wasm-simd-v${SHERPA_VERSION}-en-asr-zipformer.tar.bz2"
URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/v${SHERPA_VERSION}/${ARCHIVE}"

echo "Copying the Silero VAD model from node_modules"
cp node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx public/vad/

echo "Downloading the sherpa-onnx WebAssembly model (about 175 MB)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fL -o "$TMP/$ARCHIVE" "$URL"
tar -xjf "$TMP/$ARCHIVE" -C "$TMP"
cp "$TMP"/*/sherpa-onnx-wasm-main-asr.wasm "$TMP"/*/sherpa-onnx-wasm-main-asr.data public/sherpa/

echo "Done. Run: npm run dev"
