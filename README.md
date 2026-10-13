# Voice Cockpit

Hands-free voice control for a web app. Speech recognition runs on the device, in the browser, so the audio never leaves the machine. Commands fire on partial transcripts, before the speaker has finished the sentence.

This repository holds a working browser prototype and the research behind it.

## The idea

A command is not a transcript. Most voice interfaces wait for the speaker to go silent, then act on the final text. That silence costs more time than any faster model can win back. This prototype acts on the streaming partial text as soon as it confidently matches a command.

The hard part is doing that while the user is also dictating free text. The system listens all the time, with no wake word, so it has to tell "sign this" the command apart from "sign" as a word in a sentence.

## What works today

The prototype in [`prototype/`](prototype/) runs in Chrome:

- live microphone, voice activity detection, and streaming speech-to-text in the browser (sherpa-onnx Zipformer on WebAssembly, or Whisper on WebGPU)
- a command decoder that matches partial transcripts
- a separator that keeps commands and dictation apart, using what is on screen as context
- a mock screen that reacts to the commands, and a latency display for each stage
- a rule for destructive commands: they only become pending from the stream, and need a separate spoken "confirm"

## What is measured

`npm run check` in `prototype/` runs the type check, the evaluation and the unit tests.

| Measure | Result |
|---|---|
| False triggers on dictation (53 dictation items of a 128-utterance test set) | 0% |
| Destructive commands fired by mistake | 0 |
| Command recall | 82.4% |
| Unit tests | 37 |

The latency figures in the research files are estimates from published sources. They are not measurements of this prototype.

## What is designed but not built

Cross-partial commit stability, semantic end-of-turn detection, the embedding and LLM fallback layers, and WebRTC transport for a cloud dictation lane. See [ARCHITECTURE.md](ARCHITECTURE.md), which marks each part as built or planned.

## Run it

```sh
cd prototype
npm install
npm run dev      # http://localhost:5173, open in Chrome
npm run check    # typecheck + evaluation + tests
```

No microphone? The Simulate buttons drive the same pipeline with synthetic timing.

## Where the files are

| Path | What |
|---|---|
| [`prototype/`](prototype/) | the runnable app, its tests and its evaluation set |
| [`bench/`](bench/) | a small harness for comparing speech-to-text engines |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | the target design and the latency budget per stage |
| [`COMMAND-REGISTRY.md`](COMMAND-REGISTRY.md) | how commands, synonyms and confirmations are declared |
| [`RISKS.md`](RISKS.md) | latency, privacy and mis-fire risks, with mitigations |
| [`00-INDEX.md`](00-INDEX.md), [`research/`](research/) | the research dossier, with sources |

## Background

The first use case was a reporting screen for specialists who dictate all day and want their hands free. The test vocabulary and some research notes still reflect that. The engine does not depend on it: commands, vocabulary and the screen model are configuration.

## License

No license has been chosen yet. Please ask before reusing the code.
