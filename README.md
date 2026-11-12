# Talkthrough

**Ask about what is on your screen. Get a spoken or written explanation with marks, diagrams, or a 3D model over the page.**

[Download the latest stable Windows installer](https://github.com/ProjectIdris/talkthrough/releases/latest) | [Setup and first run](docs/setup.md) | [Experimental branch](https://github.com/ProjectIdris/talkthrough/tree/experimental)

Hold **Right Ctrl + Right Shift**, ask your question, then release. The picture and explanation appear over the app you were using. You can choose another hotkey in Settings.

![A real answer to "How does a car's differential work?": a 3D differential is drawn over the Wikipedia article, its ring gear, carrier, spider gears and driveshaft labelled and turning, step by step.](docs/media/differential-demo.gif)

*A real answer from a model (Claude Sonnet), replayed over the page it was asked on. Answers vary in detail and quality, and the replay says nothing about speed. A hand-written demonstration of the renderer, a pin tumbler lock, is [here](docs/media/lock-demo.gif).*

## What it can do

- **Explain what you point to.** Draw boxes, circles, underlines, arrows, labels, and outlines on text, pictures, and diagrams. Drag to circle an area before sending a question. Press **Escape** to cancel a question or stop an answer.
- **Draw diagrams as it explains.** Flows, timelines, steps, and charts are placed and revealed with the answer, in time with the voice.
- **Show moving 3D parts.** Models appear directly over the page by default; a frame is optional. You can turn a model with the mouse; **E** opens it up.
  - *Real models:* seven real, freely licensed objects (an alarm clock, bolt cutters, a camera, a drill, an electric motor, a measuring tape and a mousetrap) come with the installer and are drawn with their own textures; where a model has parts, it can label, cut open and pull them apart. Their makers and licences are in [CREDITS.md](assets/CREDITS.md); the MIT licence does not cover them.
  - *Mechanisms:* ready-made assemblies (gear trains, rack and pinion, crank and slider, cam and follower, lever, differential, planetary gears, four-bar linkage, bicycle drivetrain, block and tackle, Geneva drive, escapement, ratchet and pawl) whose parts turn together because they are coupled, not animated by hand. Joints, loops, and couplings connect moving parts; ropes, belts, wires, and pipes can carry moving markers or diagram arrows.
  - *Materials:* surfaces look like what they are: metal, steel, brass, copper, wood, rubber, glass, water, bone, muscle, skin and more.
- **Guide you through an app.** Guide mode marks where to click, waits for you, checks that the screen changed, and keeps a checklist. It never clicks for you unless you turn on guide navigation: that is **off by default**, works only in desktop apps (never a browser), and even then only opens a tab or a menu with a submenu, or scrolls, after it asks first (by voice or a click), says each move aloud, and stops at any key, click, wheel or mouse move. It never presses a button that changes anything.
- **Ask a follow-up.** Choose **Ask more** while an explanation is visible. The next question can continue from the same picture. **More detail** is a separate optional pass that rebuilds the scene in greater detail when configured.
- **Choose voice, text, or both.** Captions can speak each step and show its words, show text only, or speak without captions.
- **Try it first.** **Explore examples** on the welcome screen runs four built-in explanations offline, with no account, microphone or screen capture.

## Examples

These are frames from answers a model gave live to questions about made-up fixture pages (an encyclopedia-style article and a settings window), replayed frame by frame; the models and the mechanisms beside them are drawn by the renderer from the answer. The first animation above is a separate hand-written scene. Generated answers vary in detail and quality.

<table>
  <tr>
    <td><img src="docs/media/gallery-clock.jpg" alt="The real alarm clock model on an article about alarm clocks, with its gear train and escapement beside it, labelled." width="100%"><br><strong>A real model and its mechanism</strong> - the alarm clock, with its gear train and escapement beside it.</td>
    <td><img src="docs/media/gallery-drill.jpg" alt="The real cordless drill model beside a planetary gear set with labelled sun gear, shaft and carrier." width="100%"><br><strong>An assembly moving</strong> - the drill, and the planetary gears that slow its motor.</td>
  </tr>
  <tr>
    <td><img src="docs/media/gallery-mousetrap.jpg" alt="The real mousetrap model beside its spring, catch, bait pedal and hammer bar, labelled, with a box on the article text." width="100%"><br><strong>Parts that work together</strong> - the spring, catch and bait pedal that snap a mousetrap.</td>
    <td><img src="docs/media/gallery-materials.jpg" alt="Four spheres lit as steel, brass, copper and wood, each labelled, with the article text boxed." width="100%"><br><strong>Materials</strong> - steel, brass, copper and wood lit as real surfaces.</td>
  </tr>
  <tr>
    <td><img src="docs/media/gallery-proof.jpg" alt="A tilted-square diagram and three equation labels explaining a proof of the Pythagorean theorem on a web page." width="100%"><br><strong>A page explained on the page</strong> - a proof drawn beside the text it explains.</td>
    <td><img src="docs/media/gallery-guide.jpg" alt="A settings window with a red box on the Spell check toggle." width="100%"><br><strong>Guide mode</strong> - it marks the next click.</td>
  </tr>
</table>

## Get started

Talkthrough 1.0 is for **Windows 11 only**; Mac and Linux come later.

1. [Download the latest stable Windows installer](https://github.com/ProjectIdris/talkthrough/releases/latest) and run it. It installs for your Windows account and adds Talkthrough to the Start menu. No administrator rights are needed.
2. Open Talkthrough and choose a model connector. It tells you which of Claude Code and Codex it found, and what to do if one is missing or not signed in. See [Setup](docs/setup.md) for model, speech, caption, privacy, and question-record settings.
3. Hold the hotkey, ask about the screen, and release. Use **Ask more** to continue while the explanation remains visible.

**Windows will probably warn you.** The installer is not code-signed (a signing certificate costs money and we do not have one yet), so Windows SmartScreen may show "Windows protected your PC". Choose **More info**, then **Run anyway**, only if you downloaded it from this project's [releases page](https://github.com/ProjectIdris/talkthrough/releases/latest). The [Setup guide](docs/setup.md) explains first run and how to build from source, and [Troubleshooting](docs/troubleshooting.md) helps when a first question does not work.

**Updates.** The installed app looks for a newer release at start and once a day, and tells you quietly in the tray. It downloads and installs one only when you say yes, after checking the installer against the release's published SHA-256 checksum. Turn the checks off in Settings. The trust limit: the checksum file comes from the same release as the installer, so this protects against a damaged or partial download, not against someone who controls the project's GitHub account; there is no separate signature. See [Updates](docs/setup.md#updates).

## Choose how it runs your model

Talkthrough supports four model routes: your **Codex CLI**, **Claude Code**, an **OpenAI API key**, or a **local OpenAI-compatible vision model** such as Ollama or LM Studio. The local route connects only to an address on your own computer and needs a model that can read screenshots. Configure the route in Settings; the details and data each route receives are in [Setup](docs/setup.md).

The Codex and Claude adapters use the installations you have signed into; Talkthrough does not read or store those sign-in details, and it disables those adapters' tool features. Scene output is validated data: Talkthrough does not execute generated code. Check your model provider's terms before use.

## Privacy and records

The selected model receives the screenshot and question. If you hand a question to a configured deeper backend, it also receives that question, its screenshot, earlier questions, and what was on screen. A configured speech-recognition server receives the recording; a configured voice server receives the text it speaks. With local speech recognition and the local model route, those requests stay on your computer. The screenshot, recording, and conversation are normally kept in memory until you quit.

**Keep a record of each question** is off by default. When enabled in Settings, local diagnostic folders can include screenshots, recognized words, model responses, and timing details. See [Setup: question records](docs/setup.md#a-record-of-each-question) and [pinned answers](docs/pins.md) for what is saved.

## Current status

Talkthrough 1.0 is Windows only, and unsigned (see above). Mouse circling, model dragging and guide navigation are checked by hand on a real desktop, not by the automated tests, and mouse circling and model dragging have had reported failures; if one misbehaves, [Troubleshooting](docs/troubleshooting.md) says what to collect for a report. Following links in a browser, a whole-task agent mode, a wake word, Mac and Linux support and code signing are planned after 1.0. The [experimental branch](https://github.com/ProjectIdris/talkthrough/tree/experimental) explores articulated models and other unfinished work; use the stable release.

## Contribute

Talkthrough is open source under the [MIT license](LICENSE), which covers its code only: the real 3D models it can show are separate works under their own licences, named in [assets/CREDITS.md](assets/CREDITS.md), and are not part of the MIT grant. The scene language, overlay, and adapters are documented in [CONTRIBUTING.md](CONTRIBUTING.md), [the scene language guide](docs/scene-language.md), and [the overlay notes](docs/overlay.md). Mac and Linux support are planned.

For a development checkout, install Node.js 24 or newer, then run:

```sh
npm install
npm test
npm run typecheck
```
