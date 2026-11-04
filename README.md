# Talkthrough

**An AI that talks you through anything on your screen, and draws as it talks.**

Hold a key and ask out loud. Talkthrough looks at your screen, points at what matters, draws 3D models and diagrams right over the page, and walks you through it step by step.

<!-- demo GIF goes here -->
> *Demo GIF coming with the first release.*

- **Works in any app or website:** no tutorial in another window.
- **Open source (MIT).** You choose how it runs your model (see [Choose how it runs your model](#choose-how-it-runs-your-model)).
- **Private:** in normal use Talkthrough itself writes nothing about your screen or questions to disk (saving an answer to come back to is planned).
- **Safe:** it draws, it never runs generated code.

> **Status: pre-release, Windows first.** The whole loop runs: hotkey, microphone, screen capture, a model through your own Codex or Claude Code install, the scene language and the three.js overlay. It needs a local speech recogniser you point it at (see [setup](docs/setup.md)). Step-by-step guiding that waits for your click is planned. See [Status](#status) for exactly what exists today.

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

`npm start` runs the app; see [docs/setup.md](docs/setup.md) for the settings, the model and speech.

## Choose how it runs your model

Talkthrough sends your screenshot and question to a model you choose. Pick one in [settings](docs/setup.md):

1. **Your own locally installed Codex CLI**, signed in by you.
2. **Your own Claude Code**, signed in by you.
3. **An API key** (planned).

Talkthrough starts the tool you already have and gives it no tools of its own: it can only answer. It never reads or stores your sign-in. Check your provider's terms for automated use before you pick one.

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
              your screen + 3D models over the page    the drawing starts with the words
```

1. **Hotkey.** Hold Right Ctrl + Right Shift; holding records your question, letting go sends it.
2. **Capture.** The screen under the pointer is captured and kept in memory only.
3. **Model.** A vision model gets the screenshot, your question and the earlier turns of the thread, and answers in the **scene language**: timed steps, each with something to say and things to draw. The model can also say a question is beyond it.
4. **Scene language.** A small JSON format (boxes, ovals, arrows, labels, and 3D shapes with tweens and camera moves). It is data, validated before anything is drawn; no code is ever run. See [docs/scene-language.md](docs/scene-language.md).
5. **Renderer.** A transparent, click-through overlay draws marks over your screen and 3D models over the page with [three.js](https://threejs.org). A framed 3D panel is optional.
6. **Voice.** Each step is spoken as it arrives; the default is your system voice.

Models, voices, speech recognition and backends are adapters in `src/adapters/`, so you can plug in your own.

## Status

| | |
| --- | --- |
| Scene language, validator, streaming parser, JSON Schema | working, tested |
| Model, voice, speech-to-text and backend interfaces; system voice; local speech-server client | working, tested |
| Overlay window, hotkey, screen capture, microphone, tray | working |
| Models through your own Codex or Claude install, locked down to no tools | working, tested against stand-ins |
| A speech recogniser that ships with the app | planned (today: a local server you point it at) |
| Model through an API key | planned (an adapter) |
| Saving an answer to come back to, and a guided-task history | planned |
| Guided mode that waits for your click before the next step | planned |
| Mac and Linux | planned |

Windows is the first platform.

## Privacy

- **What leaves the app:** your screenshot and the text of your question go to the model you chose (see above), and your recording goes to the speech server whose address you set (meant to be on your own machine; none is built in). Nothing else.
- **What Talkthrough keeps:** the screenshot and your recording live in memory only and are not written to disk in normal use (the development options `--save-capture` and `--frames-dir` save images). Your latest questions and answers stay in memory so a follow-up question works; they are gone when you quit. The model tool you choose has its own policies.
- **Planned:** saving an answer to come back to, and a short history that lasts while a guided task runs. Neither is built yet.

## Layout

```
src/main/       Electron main process: windows, hotkey, capture, microphone, the question loop
src/overlay/    the overlay renderer (three.js)
src/scene/      the scene language: types, validator, step stream, JSON Schema
src/adapters/   Model, Voice, SpeechToText and Backend interfaces and defaults
test/           node:test tests
scripts/        build and tooling
docs/           setup, the scene language specification, the overlay
samples/        hand-written example scenes
```

TypeScript is written in its erasable subset (no enums or namespaces) and imported with `.ts` extensions, so tests run directly on Node's built-in type stripping.

## Licence

MIT. See [LICENSE](LICENSE). Copyright (c) 2026 Talkthrough contributors.
