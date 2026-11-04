# Talkthrough

**An AI that talks you through anything on your screen, and draws as it talks.**

Hold a key and ask out loud. Talkthrough looks at your screen, points at what matters, builds live diagrams (rotatable 3D included), and walks you through it step by step.

<!-- demo GIF goes here -->
> *Demo GIF coming with the first release.*

- **Works in any app or website:** no tutorial in another window.
- **Open source (MIT), bring your own model.**
- **Private:** nothing is stored unless you pin it.
- **Safe:** it draws, it never runs generated code.

> **Status: pre-release, Windows first.** The scene language and its validator work and are tested. The overlay, hotkey, screen capture and model connections are being built. Step-by-step guiding that waits for your click is planned. See [Status](#status) for exactly what exists today.

## Contribute

Talkthrough is built from small, self-contained pieces, and each is a good first contribution:

- **Model adapters:** connect another vision model (hosted or local).
- **Voice adapters:** another text-to-speech voice.
- **Speech adapters:** another way to turn your spoken question into text.
- **Scene primitives:** new things the model can draw.
- **Mac and Linux:** the overlay, hotkey and capture layers.

Start with `src/adapters/` (the three interfaces are a few lines each) and `docs/scene-language.md`.

## Quick start

Requires Windows and Node.js 24 or newer.

```
npm install
npm test            # runs the tests
npm run typecheck   # tsc --noEmit
```

Running the app itself (`npm start`) arrives with the first release. Until then you can read and run the scene language, its validator and the adapters.

## How it works

```
 hold Right Ctrl + Right Shift
            |
   +--------v---------+     +------------------+
   | hotkey + mic     |---->| screen capture   |  (in memory only)
   +--------+---------+     +--------+---------+
            | your question          | screenshot
            v                        v
        speech-to-text  --->  vision model  --->  scene language (JSON steps)
                                                        |
                              validator: drops anything unknown, clamps numbers
                                                        |
                         +------------------------------+----------------+
                         v                                               v
              overlay (three.js): marks on             voice: speaks each step,
              your screen + a rotatable 3D panel       the drawing starts with the words
```

1. **Hotkey.** Hold Right Ctrl + Right Shift; holding records your question, letting go sends it.
2. **Capture.** The screen under the pointer is captured and kept in memory only.
3. **Model.** A vision model gets the screenshot, your question and the earlier turns of the thread, and answers in the **scene language**: timed steps, each with something to say and things to draw. The model can also say a question is beyond it.
4. **Scene language.** A small JSON format (boxes, ovals, arrows, labels, and 3D shapes with tweens and camera moves). It is data, validated before anything is drawn; no code is ever run. See [docs/scene-language.md](docs/scene-language.md).
5. **Renderer.** A transparent, click-through overlay draws marks over your screen and a rotatable 3D panel with [three.js](https://threejs.org).
6. **Voice.** Each step is spoken as it arrives; the default is your system voice.

Models, voices, speech recognition and backends are adapters in `src/adapters/`, so you can plug in your own.

## Status

| | |
| --- | --- |
| Scene language, validator, streaming parser, JSON Schema | working, tested |
| Model, voice, speech-to-text and backend interfaces; system voice; local speech-server client | working, tested |
| Overlay window, hotkey, screen capture, microphone | in progress |
| Model connections (subscription CLI and API key) | in progress |
| Guided mode that waits for your click before the next step | planned |
| Mac and Linux | planned |

Windows is the first platform.

## Privacy

Nothing is kept unless you pin it. Raw screenshots are never stored. A short in-memory history lasts only while a guided task runs.

## Layout

```
src/main/       Electron main process: windows, hotkey, capture, microphone
src/overlay/    the overlay renderer (three.js)
src/scene/      the scene language: types, validator, step stream, JSON Schema
src/adapters/   Model, Voice, SpeechToText and Backend interfaces and defaults
test/           node:test tests
scripts/        build and tooling
docs/           the scene language specification
samples/        hand-written example scenes
```

TypeScript is written in its erasable subset (no enums or namespaces) and imported with `.ts` extensions, so tests run directly on Node's built-in type stripping.

## Licence

MIT. See [LICENSE](LICENSE). Copyright (c) 2026 Talkthrough contributors.
