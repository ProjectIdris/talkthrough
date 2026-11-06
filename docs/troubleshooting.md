# Troubleshooting Talkthrough

Start with a harmless window and leave private material off screen. Asking a real question sends that screen's screenshot and your question to the configured model. The [setup guide](setup.md) describes each route and the settings.

## Find which part is failing

1. Open the tray menu. Talkthrough normally lives in the tray rather than a main application window; Windows may hide the icon in the tray's overflow menu.
2. Choose **Play a sample scene**. This draws a built-in scene without a model call or a microphone recording. If it works, the overlay can draw; it does not test hearing, the hotkey or the model connection.
3. Open **Settings…**, check the model route and hearing status, save changes and restart with the window's restart button. Most settings apply on restart; the list of windows to skip applies immediately.
4. Hold the configured key or chord for a short spoken question, then release it. Note the exact notice and whether the failure happens before listening, while hearing, while waiting for an answer, or while drawing it.

Press **Escape** to cancel a question. Use **Clear the overlay** in the tray to remove the current drawing.

## A source checkout will not start

Run commands from the repository folder containing `package.json`:

```sh
node --version
npm --version
npm ci
npm start
```

Node.js must be version 24 or newer. `npm start` builds before launching, so check the first build error rather than only the final exit message.

If the message says **Electron failed to install correctly**, the npm package may be present without Electron's executable. `npm start` normally detects missing Electron files and runs its installer once. This needs network access. If that download failed, check the network and run:

```sh
node node_modules/electron/install.js
npm start
```

If the installer says it left nothing to start, check whether `ELECTRON_SKIP_BINARY_DOWNLOAD` is set and remove it from the shell environment before retrying. Prefer `npm start` over launching Electron directly: the start script also clears `ELECTRON_RUN_AS_NODE`, which otherwise makes Electron act like Node instead of opening the app.

These are Windows desktop instructions. A Linux/headless launch is not a substitute for testing the Windows hotkey, screen capture, speech recogniser or installer. Do not disable Electron's sandbox or run the app as administrator just to hide a startup error; include the exact error in a report.

## Holding the keys does nothing

- The default is **Right Ctrl + Right Shift**, not the left-hand keys. Check the chosen chord in Settings and hold all its keys while speaking.
- If a notice says the window is skipped, switch to a harmless window. The capture blocklist is deliberate protection, not a connection failure. When that list is enabled and the foreground window cannot be identified, Talkthrough also refuses the question. Do not remove the protection just to test a private window.
- Save a changed chord and restart. For a source launch, check that you did not pass `--no-hotkey`.
- In a console log, look for `ready: hold ...`, `ready (hotkey off)` or `the key hook could not start`. Include the hook error in a report rather than repeatedly changing the model settings.

## It cannot hear a question

**“I couldn't use the microphone.”** Check that Windows permits microphone access for desktop apps, the microphone is connected and not muted, and Settings selects the intended input. Save and restart after a device change.

**“I didn't hear a question.”** Hold both keys throughout the question and speak before releasing them. Try a short, clear sentence. A working microphone and a working speech recogniser are separate requirements.

**No way to hear questions is set up / recogniser unavailable.** Look at **Hearing you with** in Settings. Windows hearing requires an installed English Windows speech recogniser. You can explicitly download **Clearer hearing (whisper.cpp)** or configure your own speech server; neither requires changing the model route. See [Speech](setup.md#speech) for downloads, server requests and fallback behavior.

For a configured speech server, confirm that it is actually running at `speechServerUrl`. Talkthrough does not start it. `/health` checks availability; `/transcribe` must accept the audio format described in the setup guide. Do not point it at an unrelated web service: recordings are sent there.

## Hearing works, but no answer arrives

Check **Settings…** for the selected route, not just which tools happen to be installed:

- **Codex or Claude Code:** install and sign in to the selected CLI separately. If it is not on the app's `PATH`, use a full executable path in `codexCommand` or `claudeCommand`. Confirm the selected model is available to that account. Talkthrough does not sign in for you.
- **API key:** save the key in Settings, check the model and API address, and check the provider's account/billing status. Never paste a key into a bug report. If encrypted key storage is unavailable, Talkthrough refuses to save it; do not work around this by putting the key in `settings.json`.
- **Local:** start your OpenAI-compatible server separately, load a vision model and use its exact model name and loopback API address. **Test connection** in Settings checks the model with a generated test picture, not your screen. A text-only model is not enough.

A malformed settings file falls back to defaults and logs a warning. If you edit JSON by hand, check the `settings file:` path and any `settings:` warnings at startup before trying a live question. Use Settings to save a valid configuration; do not delete the whole app-data folder as a troubleshooting shortcut.

## “3D is unavailable in this window”

Talkthrough could not initialize WebGL. Text, voice and flat 2D diagrams/marks remain available through their normal settings; a 3D model and its attached labels and controls are not drawn. A model-only answer uses the text answer box when text captions are enabled. This notice does not mean that the missing model was rendered successfully.

The notice appears only when the current answer includes a visible 3D model. Other application notices take priority. Click to dismiss it for the current answer. A new question can show it again.

Use a 2D sample such as **diagram-flow** to check that the overlay is still working. If 3D is needed, check the graphics driver and the restrictions of the desktop or remote environment, then restart Talkthrough after resolving the graphics problem. Do not disable browser security or bypass the GPU blocklist. This fallback handles graphics initialization failure, not recovery from a context lost after startup.

## The drawing appears, but there is no voice

Check the **captions** setting first: `text` intentionally makes no sound. Check the selected speaker, system output volume and whether the device is connected. A missing selected device falls back to the system default with a notice.

If you configured `voiceServerUrl`, Talkthrough tries that service and falls back to the system voice when it is unavailable or too slow. It does not start the service. See [Voice](setup.md#voice) for the required audio formats and timeouts. A stream that breaks halfway through ends that step; it is not spoken again. Normal logs identify the voice used and fallback reason without requiring `--log-steps`.

## Collecting a useful report

Start with a normal console log, not a recording of your whole desktop. For an installed Windows copy, see [A log from an installed copy](setup.md#a-log-from-an-installed-copy). From a checkout:

```sh
npm start > talkthrough-log.txt 2>&1
```

Reproduce once on harmless content, quit from the tray, then inspect the file. Normal logging avoids question and answer text, but paths, service errors and other diagnostics can still be private. Review before sharing.

If the normal log is not enough, **Keep a record of each question** in Settings saves screenshots, transcripts, raw model replies and diagnostic details locally. It is off by default. Enable it only for the reproduction, restart, reproduce on harmless content, then disable it and restart again. Read [A record of each question](setup.md#a-record-of-each-question) for the location and retention rules. Disabling it does not delete saved records; remove unwanted records yourself. The record is not a microphone-audio archive.

Development flags such as `--log-steps`, `--save-capture`, `--save-answer`, `--save-voice` and `--record` can expose question text, model replies, screenshots or audio. Use only what the investigation needs. Do not upload an entire app-data folder, an API key file, CLI sign-in files or unreviewed question records.

Use the [bug report template](../.github/ISSUE_TEMPLATE/bug_report.yml) and include:

- Talkthrough version or source commit, Windows version, and Node/npm versions if running from source.
- The model route and model name, hearing option, and whether a custom voice server is configured. Omit keys and private server addresses.
- Steps to reproduce, expected behavior, exact notice/error, and whether **Play a sample scene** works.
- A short, reviewed log excerpt. Attach a redacted screenshot or record only if needed to explain the failure.

For a possible security issue, follow [Contributing](../CONTRIBUTING.md#reporting-a-problem): request a private route without posting exploit details publicly.
