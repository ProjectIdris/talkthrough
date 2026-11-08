# Talkthrough 1.0.0

The first stable release. **Windows 11, 64-bit only** (Mac and Linux come after 1.0). It installs for your own Windows account and needs no administrator rights.

**Windows will probably warn you.** The installer is not code-signed: a signing certificate costs money and the project does not have one yet. SmartScreen may say "Windows protected your PC". Choose **More info**, then **Run anyway**, only if you got the installer from this project's releases page. `SHA256SUMS.txt` on the release lists the installer's SHA-256 if you want to check it yourself (`Get-FileHash Talkthrough-Setup-1.0.0.exe`).

You also need a model of your own and a way for it to hear you: your own Claude Code or Codex (signed in by you), an OpenAI API key, or a vision model running on your own computer, and the Windows speech recogniser, a clearer local one you can download, or a speech server you run. See [setup](setup.md).

## What Talkthrough does

Hold **Right Ctrl + Right Shift** (or keys you choose), ask about what is on your screen, let go. A fast vision model answers, a voice speaks, and marks, diagrams or a 3D model are drawn over the page you were on, in step with the voice. Generated output is data the app validates; no generated code runs.

- **Marks that land.** Boxes, circles, underlines, arrows, labels and outlines that follow the shape of what they point at, including tilted figures and curves. Circle an area with the mouse before you ask.
- **Diagrams that lay themselves out.** Flows, timelines, steps and charts, placed where the page has room and drawn on as the voice reaches them. The panels are frosted glass that follows the page, light over a light page and dark over a dark one.
- **Moving 3D, from real objects.** Seven real, freely licensed models (an alarm clock, bolt cutters, a camera, a drill, an electric motor, a measuring tape and a mousetrap) ship with the installer, drawn with their own textures and, where a model has parts, with names the answer can label, cut open and pull apart. Their makers and licences are in the `CREDITS.md` that ships with the app and in [assets/CREDITS.md](../assets/CREDITS.md); they are separate works, not under the MIT licence.
- **Mechanisms that work.** Thirteen ready-made assemblies: gear trains, rack and pinion, crank and slider, cam and follower, lever, differential, planetary gears, four-bar linkage, bicycle drivetrain, block and tackle, Geneva drive, escapement, and ratchet and pawl. Their parts are coupled, so what turns one thing turns the next. Ropes, belts, wires and pipes can carry moving markers.
- **Materials.** Metal, steel, brass, copper, wood, rubber, glass, water, bone, muscle, skin and more, lit as physical surfaces.
- **Guide mode.** Marks where to click, waits for you, checks that the screen changed, ticks a checklist. **Guide navigation** (opening a tab or a submenu, scrolling, in desktop apps only) is **off by default**: turn it on in Settings, and it asks before its first move (by voice or a click), says each move aloud, and stops at any key, click, wheel or pointer move. It never touches a browser, never presses a button, link, toggle or field, and does not act in a window running as administrator.
- **Ask more**, **More detail**, and voice, text or both for the words.
- **Explore examples**: four built-in explanations that run offline with no account, microphone or capture.

## New for 1.0

- **Updates.** The app checks GitHub for a newer release at start and once a day and says so quietly in the tray. Only when you say yes does it download the installer, check it against the release's `SHA256SUMS.txt`, run it silently and restart. Turn the checks off in Settings. **The trust limit:** the checksum file comes from the same release as the installer, so this guards against a damaged or partial download, not against someone who controls the project's GitHub account. There is no separate signature.
- **Clear first-run help.** If Claude Code or Codex is missing or not signed in, the microphone is blocked or absent, or a voice server you set up is not answering, the app says which, and what to do next, in the notice, in the first-run window and in Settings.
- **A tested long day.** Hundreds of questions in a row, cancelled and failing ones included, leave no listeners, timers or memory behind (a test holds this). Display scaling puts marks in the same place at 100% and 200%.
- **Guide navigation gaps closed:** an explicit elevated-window limit, and the mouse wheel stops a move like any other input.

## Not in 1.0

Following links in a browser, a whole-task agent mode, a wake word, Mac and Linux, and code signing come after 1.0. Mouse circling and model dragging have had reported failures and are checked by hand on a real desktop; if one misbehaves, [troubleshooting](troubleshooting.md) says what to collect for a report.

## Privacy, briefly

The model you choose receives each screenshot and question; a speech server you configure receives the recording, and a voice server the text it speaks. With local speech and the local model route nothing leaves your computer. No record of questions is kept unless you turn that on. Nothing in the app is sent to a server run by this project; the update check carries only the version number and your network address, like any web request. See the [README](../README.md#privacy-and-records).

## Uninstalling

*Apps > Installed apps*, or the uninstaller in `%LOCALAPPDATA%\Programs\Talkthrough`. Your settings, pins and records stay in `%APPDATA%\Talkthrough` until you delete that folder.
