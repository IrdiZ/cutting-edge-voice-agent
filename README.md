# Voice Cockpit

Hands-free voice control for web apps. Speech recognition runs on the device, in the browser. Commands fire on partial transcripts.

**Status:** research prototype. It runs in the browser against a mock screen. It is not connected to a real application, and it is not production software.

<!-- demo gif: screen recording of the prototype in Chrome. Speak "open the next case", then dictate a sentence that contains the word "sign", and show that only the first one fires a command. Keep the latency display visible. -->

## What it does

Most voice interfaces wait for silence, then act on the final text. That wait costs more time than a faster model can win back. This prototype acts on the streaming partial text as soon as it matches a command with enough confidence.

The hard part is doing this while the user also dictates free text. The microphone is always on, and there is no wake word. The prototype must tell the command "sign this" apart from the word "sign" inside a sentence.

What works today:

- Live microphone input, voice activity detection and streaming speech-to-text in the browser. The engine is sherpa-onnx Zipformer on WebAssembly. Whisper on WebGPU and the Chrome Web Speech API are also available.
- A command decoder that matches partial transcripts.
- A separator that keeps commands and dictation apart. It uses the app state as context. A command can only fire in the states where it makes sense.
- A mock screen that reacts to the commands, and a latency display for each stage.
- A rule for destructive commands. They never fire from the stream. They wait for a separate spoken or clicked "confirm".

## Quick start

You need Node.js 22 or newer, `sh`, `curl` and Chrome.

```sh
cd prototype
npm install
npm run setup    # one time: downloads about 175 MB of model files
npm run dev      # open http://localhost:5173 in Chrome
```

Click "Start mic" and allow microphone access. If you have no microphone, use the Simulate buttons. They drive the same pipeline with synthetic timing.

To run the checks (type check, evaluation, unit tests):

```sh
npm run check
```

On Windows, run `npm run setup` from Git Bash or WSL.

## How it works

```
mic -> VAD -> streaming STT -> partial transcript
                                     |
                              command decoder (match on every partial)
                                     |
                        separator (is this a command or dictation?)
                                     |
              +----------------------+----------------------+
        navigation / control                        destructive command
        fires at once                          waits for "confirm"
                                     |
                         mock screen + latency display
```

The speech engine sits behind one adapter interface. You can swap the engine without changing the decoder or the screen. The separator uses a state machine. Each command is reachable only in some app states, so dictation text cannot fire a destructive command.

Results on the included test set (`npm run check` in `prototype/`):

| Measure | Result |
|---|---|
| False triggers on dictation (53 dictation items in a set of 128 written utterances) | 0% |
| Destructive commands fired by mistake | 0 |
| Command recall | 82.4% |
| Unit tests | 37 passing |

The test set is written text, not recorded audio. The latency figures in [`docs/research/`](docs/research/) are estimates from published sources. They are not measurements of this prototype.

## Limitations

- It is a prototype. It controls a mock screen only.
- The decoder has a fixed list of commands and a small test vocabulary. Recall is 82.4%, so it misses some phrasings.
- The streaming engine is English only. It needs a model download of about 190 MB.
- The Web Speech option sends microphone audio to a cloud service. Use the on-device engines if audio must stay on the machine.
- These parts are designed but not built: stability checks across partials, semantic end-of-turn detection, embedding and LLM fallback layers, and WebRTC transport for a cloud dictation lane. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), which states what is built and what is only designed.
- The prototype targets Chrome. Other browsers are not tested.

## Repository layout

| Path | Content |
|---|---|
| [`prototype/`](prototype/) | The runnable app, its tests and its evaluation set |
| [`bench/`](bench/) | A small harness for comparing speech-to-text engines |
| [`docs/`](docs/) | Architecture, command registry, risks and build plan |
| [`docs/research/`](docs/research/) | Research notes with sources, and an index |

## Background

The first use case was a reporting screen for clinicians who dictate all day and want their hands free. Some test phrases and research notes still reflect that. The engine does not depend on it. Commands, vocabulary and the screen model are configuration.

## License

MIT. See [LICENSE](LICENSE).
