# Contributing to Talkthrough

Thank you for looking. Talkthrough is a desktop screen assistant: you hold a key and ask out loud, it looks at your screen, and it points at things and draws over the page while a voice talks you through. It is MIT-licensed and built from small pieces, so most contributions touch one of them.

This page is how to run it, test it, where the seams are, how we write commits, and the one rule that is not negotiable.

## The rule: the model draws, it never runs code

A model's answer is **data**: a scene written in the [scene language](docs/scene-language.md). Everything it says is checked by the validator (`src/scene/validate.ts`) before anything is drawn: unknown actions are dropped, numbers are clamped, counts are capped, text stays plain text. Nothing a model (or a backend) sends is ever evaluated, imported, run as a command or put into a page as HTML.

A change that would break this will not be merged: no `eval`, `new Function`, `import()` of a model's text, `innerHTML` from it, shell commands built from it, or "let the model write a small script". If the language cannot say what you want, **add a primitive** (see below), do not add a way to run code.

Two related promises you should keep:

- **Do not retain the user's screen or questions without their choice.** Pins save an answer and its picture. The optional **Keep a record of each question** setting also saves screenshots, transcripts and model output locally; it is off by default. Explicit development flags can save captures, answers, audio or logs too. See [records and diagnostic privacy](docs/troubleshooting.md#collecting-a-useful-report) before collecting or sharing them.
- **Keep network requests within the configured routes and explicit downloads:** the model route, speech server, voice server and backend address, plus hearing downloads the user chooses. Do not add silent uploads or new destinations.

## Running it

Windows, Node.js 24 or newer.

```
npm install
npm start          # builds, then starts the app in the tray
```

Electron downloads its own program the first time it is installed. npm 11 can skip that step on `npm ci`; `npm start` and `npm run dist` notice and run it for you, once (it needs the network). If you ever see "Electron failed to install correctly", run `node node_modules/electron/install.js`.

Setup (a speech recogniser, a model) is in [docs/setup.md](docs/setup.md); common failures and safe diagnostic steps are in [docs/troubleshooting.md](docs/troubleshooting.md). You do not need either to work on the overlay: from the tray, *Play a sample scene* draws a hand-written scene with no model and no microphone. Useful options for `npm start -- <options>` are listed in `src/main/args.ts`; for example `--hidden`, `--no-hotkey` and `--max-seconds 10` run the app without taking over your screen, and `--grab <scene.json> --out <folder>` renders a scene to a picture.

The app works on your real screen: be careful with `--visible-to-capture` and with anything that takes screenshots while a private window is open.

## Real models

The 3D models of real things (a heart, a brain) are described by manifests in `assets/models` and fetched once into an ignored cache, never committed; see [docs/real-models.md](docs/real-models.md). Without them the app still runs and those models are drawn from shapes, and the two tests that read the built files skip.

## Testing

```
npm run typecheck
npm test                                     # the whole suite
node --test --experimental-strip-types test/scene-validate.test.ts   # one file, while you work
```

Run the one file you are changing while you work and the whole suite once before you open a pull request. Tests use Node's built-in runner, with fakes for the speech server, the model tools and the overlay (`test/support/`). They need no provider key or real microphone. Tests do not download Electron: install it first with `node node_modules/electron/install.js` if you want desktop checks. Frame-grab tests report a skip when the executable or a Linux display server is missing. The native window-reader and Windows UI tests run only on Windows; their portable safety tests still run everywhere.

On Linux, for a portable check without downloading desktop binaries, use `npm ci --ignore-scripts`, then run the commands above and `npm run build`. CI runs these checks on Linux and also installs the desktop dependencies for a Windows run. A green portable run does not establish desktop behavior; read its skip count and test Windows input, capture and voice on a real desktop before claiming those work.

Add a test where a failure would be likely, costly, silent or hard to undo (a validator rule, a safety check, something that was broken once) and see it fail before you rely on it. You do not need a test for every line.

## Where things are

```
src/scene/       the scene language: spec, validator, JSON Schema, the guide a model reads
src/overlay/     the renderer (a transparent window; three.js for 3D) and the labels, pen and status pill
src/adapters/    the three seams below, and the model, speech and voice implementations
src/main/        the Electron main process: hotkey, capture, microphone, the question loop (session.ts), tray
src/shared/      the messages between main and overlay
docs/            the scene language, setup, the backend contract, pins
samples/         hand-written scenes
```

### The seams

Each is a short interface with a fake in the tests. Adding another implementation is the best first contribution.

| To add | Implement | Look at |
|---|---|---|
| Another vision model (hosted or local) | `Model` in `src/adapters/model.ts`: `ask(request)` yields scene steps as they are complete, raw. When the request has `pieces: true` it may also yield each step's words (`say`) and each of its actions (`action`) as they are written, before the step, so parts can be drawn as they arrive (`createStepStream` in `src/scene/stream.ts` does the splitting); a model that ignores `pieces` works unchanged. The validator checks all of it. | `claude-model.ts`, `openai-model.ts`, `codex-model.ts`, `scripted-model.ts` |
| Another way to hear the user | `SpeechToText` in `src/adapters/speech-to-text.ts` | `local-speech-server.ts` |
| Another voice | `Voice` in `src/adapters/voice.ts` | `speech-synthesis-voice.ts` |
| A deeper helper for hard questions | an HTTP service speaking [docs/backend.md](docs/backend.md); no code change needed | `src/adapters/backend.ts` |

A model adapter must not give the model tools or file access, and must not keep or log the screenshot. The existing three show how each is locked down; `docs/setup.md` says what each one promises.

### A new scene primitive

A new thing the model can draw touches five places, and the tests tell you which you missed:

1. `src/scene/spec.ts`: the action and its fields (and limits).
2. `src/scene/validate.ts` if it needs a rule beyond the spec.
3. `node scripts/build-schema.ts`: regenerates the JSON Schemas in `docs/` (a test fails if they are stale).
4. `src/overlay/`: draw it.
5. `docs/scene-language.md`: describe it, and teach the model about it in `src/scene/guide.ts` only if it should use it (the guide is part of every prompt, so keep it small).

## Commits and pull requests

- One change per commit, with a subject in plain sentence case that says what changed and why it matters: "Pinning keeps each answer's own picture", not "fix bug" and not "WIP".
- Use the body to explain anything a reader of the diff cannot see (what you measured, what you ruled out).
- Keep commits and code free of anything private: no personal paths, keys, usernames or tokens, in the code, the tests or the messages. Never open or paste an API key anywhere.
- Open the pull request against `main`. Say what you ran (the one test file, the whole suite, and what you looked at on screen). A picture or a short clip of an overlay change helps more than a description.
- New code is TypeScript with explicit `.ts` import paths, strict types, and only syntax that can be erased (no enums or namespaces; `npm run typecheck` tells you). Keep dependencies to what is needed: say why in the pull request before adding a package.
- Comments say why, in plain words.

## Reporting a problem

Use the issue templates: a bug report, a feature idea or an adapter proposal. For anything about security (a way to make the app run something it should not, or to leak a screenshot), please describe it in an issue **without** the exploit details and ask for a private route to share them.

By contributing you agree your work is released under the [MIT licence](LICENSE).
