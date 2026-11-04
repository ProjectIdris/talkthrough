# Setting up Talkthrough

Windows, Node.js 24 or newer.

```
npm install
npm start        # builds, then starts the app in the tray
```

Hold **Right Ctrl + Right Shift** (or the two keys you chose in *Settings*), ask out loud, let go. The overlay answers on the screen you were looking at. The tray icon has *Settings…*, *Play a sample scene*, *Clear the overlay* and *Quit*.

### Building the installer

To build the Windows installer (per-user, no administrator rights, unsigned for now):

```
npm ci
npm run dist       # builds, then writes release/Talkthrough-Setup-<version>.exe
```

Use `npm ci` in a folder of its own, not a `node_modules` linked from elsewhere: the packager only includes the modules it finds there. The icon is drawn by `scripts/make-icon.mjs` into `build/`; the packaging settings are in `electron-builder.yml`. Because the installer is unsigned, Windows SmartScreen may say "Windows protected your PC" when it is downloaded; *More info*, then *Run anyway*, starts it.

### Uninstalling, and what it leaves

The installer puts the program under `%LOCALAPPDATA%\Programs\Talkthrough` and adds a Start menu entry; *Apps > Installed apps* (or the uninstaller in that folder) removes both. It leaves **your own files** on purpose, in `%APPDATA%\Talkthrough`: your settings file, the encrypted API key file (`api-key.bin`), your pins (the `pins` folder), the app's preferences (`prefs.json`) and the browser engine's caches. After uninstalling, delete that folder to remove all of it.

### A log from an installed copy

The app writes its log to the console it was started from, and an installed copy has none. To get one, quit Talkthrough (tray menu, *Quit*), then in a Command Prompt run:

```
"%LOCALAPPDATA%\Programs\Talkthrough\Talkthrough.exe" > talkthrough-log.txt 2>&1
```

Do the thing that went wrong, quit from the tray, and read `talkthrough-log.txt`. It lists what the app did, with no screenshot, no question text and no model answer unless you start it with `--log-steps` (which also writes each answer's raw text, one `answer-raw` line per answer, so a garbled one can be read). Remove anything private before you share it.

Talkthrough needs two things outside itself: a way to hear you and a model.

## Settings

Open **Settings…** from the tray icon. One window has the route and model, the detail route, the voice (the system voice, or a voice server's address), the speech recogniser's address, the two keys held to ask, the windows to skip, the two switches (*let a guide act for me*, *place marks on real controls*; both off until you turn them on, each with a line saying what it does) and the API key. Saving writes the file below, through the same checks as the file: a value that does not pass (an http voice address that is not on this computer, two keys that are the same) is not saved, and the window says why. Changes take effect when Talkthrough restarts (the window has a button for that), except the list of windows to skip, which protects as soon as it is saved.

The window writes a JSON file, `%APPDATA%\talkthrough\settings.json` (the app logs the exact path when it starts), which you can also edit by hand. Every key is optional; a key left at its default is not written.

| Key | Meaning | Default |
| --- | --- | --- |
| `speechServerUrl` | Base URL of a local speech recogniser (see below). Without it the app cannot hear you and says so. | none |
| `speechLimitMs` | Sent to the speech server as `limit_ms`: how long its main recogniser may take before a quicker one answers. About 1000 suits a CPU-only server. | server's own |
| `model` | `"codex"`, `"claude"` or `"openai"` | `"codex"` |
| `codexModel` | Model name in your Codex catalog | `"gpt-6-luna"` |
| `voiceServerUrl` | A local text-to-speech server that makes the voice (https, or a loopback address): the full address a request is POSTed to. Without it the system voice speaks. The words of each spoken step are sent there, and nothing else. See [Voice](#voice). | none |
| `voiceServerVoice` | Which voice to ask the server for (sent as `voice`), if it has several | none |
| `voiceFirstAudioMs` | How long the server has to make its first sound before the system voice speaks that step instead, 300 to 2,400 | `2000` |
| `voiceCooldownMs` | How long the server is then left alone before it is tried again, 2,000 to 600,000 | `20000` |
| `voiceTimeoutMs` | How long one spoken step may take in all, 5,000 to 120,000 | `30000` |
| `backendUrl` | Where the optional deeper backend listens (https, or a loopback address). Without it there is no backend and nothing is sent anywhere else. See [backend.md](backend.md). | none |
| `backendTimeoutMs` | How long to wait for the backend's answer, 5,000 to 900,000 | `180000` |
| `codexFast` | Fast mode for the Codex process this app starts (uses more of your usage allowance; your own Codex settings are not touched) | `false` |
| `claudeModel` | Claude model name | `"claude-haiku-5-5"` |
| `openaiModel` | Model name for the API-key route | `"gpt-6-luna"` |
| `openaiServiceTier` | Optional service tier for the API-key route (`"fast"` costs more) | none |
| `openaiBaseUrl` | Optional API address, https only (or a loopback address) | OpenAI's |
| `codexCommand`, `claudeCommand` | Full path of the tool, if it is not on `PATH` | found on `PATH` |
| `hotkey` | The two keys held to ask, as `first+second`, from `right-ctrl`, `right-shift`, `right-alt`, `left-ctrl`, `left-shift`, `left-alt`. Holding the first alone opens the microphone early. The left-hand keys are used by many shortcuts. Read at start | `"right-ctrl+right-shift"` |
| `captureBlocklist` | Words naming windows never to look at: if the window in front has one in its app name, program file or title (any case), holding the keys does nothing: nothing is recorded, captured or sent, and the overlay says so. Only the window in front is checked. If the window in front cannot be read (the read fails, comes back empty, or takes more than 0.3 seconds), the press is refused the same way, with a notice saying so, rather than looked at: with a list, no answer means no. An empty list `[]` turns it off, and then nothing is read at all | `["1Password", "Bitwarden", "KeePass", "LastPass", "Dashlane", "Proton Pass"]` |
| `micWindowMs` | How long Right Ctrl may be held alone before the early microphone and screen grab are dropped | `1000` |
| `screenshotEdge` | Longer side of the screenshot sent to the model, in pixels | `1280` |
| `effort` | Reasoning effort asked of the model | `"low"` |
| `guideNavigation` | On Windows, guide mode may open a tab, open a menu that has a submenu, or scroll for you, when the answer asks for it. The first time in a session it asks, and does nothing until you say yes (hold the keys and say "yes") or click Yes on the card it shows or in the tray; after one yes it carries on for the session. Before every move it says what it is about to do, and a key, a click, Escape or moving the pointer stops it. The tray has "Pause everything it does for me", which stops all of it at once. A guard reads the real control (read-only) and refuses everything but a tab, a menu that opens a submenu and a scrollable area: never a button, link, check box, toggle, field, or anything that saves, sends, deletes or buys. **Off until you turn it on.** Native windows only: it never touches a browser (Chrome, Edge, Firefox) or an Electron app, because driving one through accessibility has the same cost as reading one. Nothing is sent anywhere | `false` |
| `controlSnap` | On Windows, put marks exactly on the buttons, tabs and menu items of the window in front. The app reads their rectangles (and kind) from the accessibility tree, read-only: it never clicks, never reads names or text, and nothing is sent anywhere. **Off until you turn it on.** It never reads a browser window (Chrome, Edge, Firefox, Electron apps such as Slack or VS Code): asking a browser for its accessibility tree switches accessibility on in the whole browser until it is restarted, and that costs the browser CPU. There, and wherever the setting is off, marks snap to the picture alone | `false` |
| `splitAnswer` | Claude route only, so the first words come sooner: `"steps"` writes one step to a call, each asked for when the one before has ended (the first words come in about three to four seconds); `"two"` writes step 1 alone, then the rest in a second call while step 1 is spoken; `"off"` writes the whole answer in one call (the first words come later, in six to ten seconds on a rich page). Each question under `steps` or `two` uses two or more calls of your Claude allowance. If a later call fails, the answer ends where it was. Choosing "In one call" in the settings window writes `"off"` to the file. (The older `twoStepAnswer: true` means `"two"`, `false` means `"off"`.) | `"steps"` |
| `detailRoute` | Turns on the **detail pass**: `"codex"`, `"claude"` or `"openai"`, the route that writes a much richer version of the scene on screen when you ask for more detail (see below) | none (off) |
| `detailModel` | Model the detail route uses | `"gpt-6.1-sol"` for `codex` and `openai`, `"claude-sonnet-5-5"` for `claude` |
| `detailEffort` | Reasoning effort for the detail pass | `"medium"` |

## Choose how it runs your model

Talkthrough sends your screenshot and question to a model you choose. Set `model` in the settings file:

1. **`"codex"`: your own locally installed Codex CLI**, signed in by you. The app runs `codex app-server` itself with a read-only sandbox, no approvals, its tool features off and an empty working folder, and ends the question if anything tries to use a tool.
2. **`"claude"`: your own Claude Code**, signed in by you. The app runs it in print mode with no tools, no MCP servers, no slash commands and no settings files, and refuses to go on if its first message lists anything else.
3. **`"openai"`: an API key.** The app calls the OpenAI Responses API directly, streamed, with strict structured outputs and nothing stored on the provider's side. Choose *Settings…* from the tray menu and paste your key: it is stored encrypted for your Windows account (Electron's `safeStorage`; nothing is saved if that is unavailable; this protects it from other users and from copies of the disk, not from other programs running as you, which can decrypt it the same way), is only ever sent to the API address as a header, and is never logged. Costs are billed to your account by the provider.

For the first two, Talkthrough only starts the tool you already have; it never reads or stores your sign-in. If your Codex setup lists tool servers (MCP), the app switches each one off for the process it starts; the list is read when that process starts, so a server added later is switched off at the next start. **Check your provider's terms for automated use before you pick one.** To use something else, write a `Model` adapter (`src/adapters/model.ts`).

### Trying one live question from a checkout

`node scripts/live-check.mjs --claude-command <path to the claude executable> --page <screenshot.png> --question "Explain this"` asks one question on a saved screenshot, on the Claude (Haiku) route, in a hidden window with a silent voice. It writes the settings itself and refuses to start unless they read back as the claude route, a Haiku model and an executable that exists (a settings file that does not parse falls back to the default route without a word, and the call would go to the wrong model). Frames, the app's log (with each answer's raw text) and a short summary of what the answer drew are left in `--out`. `--route-only` runs the check and stops.

`node scripts/measure-first-word.ts --command <claude executable> --mode call --max-calls 1 --image <page.png>` times one question on the Claude route from the moment it is sent: when the command is ready, the first byte from the API, how long the model thinks, and when the first `say` is complete. `--mode idle` only starts the process and makes no call.

## The detail pass

A quick answer is drawn with a small, fast model. If you set `detailRoute`, a **More detail** button appears beside a finished 3D model (next to *Explode*), and saying "show me in detail" does the same. The app then sends the screenshot, your question and the scene on screen to the detail model, which is asked for a much richer version of the same scene (the same ids, ready-made parts, linkages, smaller parts). The picture upgrades in place as the pieces arrive, with a quiet "Adding detail…" in the corner and nothing spoken. A new question cancels it. It never runs by itself, and without `detailRoute` nothing offers it and no second model is ever started. The detail route is run exactly like the quick one (the same locked-down Codex or Claude process, or the API key) with its own model and effort; it uses more of your allowance than a quick answer.

## Speech

Your question is recorded in memory, turned into text by a local recogniser, and thrown away. Talkthrough ships a client for a recogniser that runs as a small local HTTP server (`createLocalSpeechServerRecogniser`): `POST /transcribe` with raw 16 kHz mono float32 samples, answer `{"text": "..."}`, and `GET /health` to check it is up. A server that sleeps when idle can also take `POST /warm` (no body; answer `202` at once and get ready in the background): the app sends it, at most once every 30 seconds, as soon as the keys first go down, so the server is ready by the time you finish speaking. A server without that route (a `404`) is simply not asked again for a while. The app never starts the server itself; if the address does not answer, the overlay says so. A recogniser that ships with the app is planned.

## Voice

By default each step is spoken by your system voice. If you run a text-to-speech server of your own, set `voiceServerUrl` and the app speaks with that instead, falling back to the system voice whenever the server is down or slow. Nothing is built in: no address is ever tried unless you set one, and the app never starts or stops the server.

What the server must do: accept `POST <voiceServerUrl>` with the JSON body `{"text": "...", "voice": "..."}` (`voice` only if you set `voiceServerVoice`) and answer `200` with audio, sent as it is made, in either of two forms:

- a WAV stream (`Content-Type: audio/wav`): 8, 16, 24 or 32-bit integer PCM or 32-bit float, one or two channels. The length in the header may be real, zero or unknown (the audio then runs to the end of the response);
- raw PCM (`Content-Type: audio/pcm; rate=24000; channels=1`): signed 16-bit little-endian.

A busy server may answer `503` with `Retry-After` (seconds, or a date; a wait over a minute counts as a minute). That step is spoken by the system voice at once, the server is left alone for that long, and then the next step asks it again; any other error uses the ordinary cooldown (`voiceCooldownMs`).

Any other answer is an error (a text body is shown in the log), and that includes a redirect: the app never follows one, so the words go only to the address you set. The app asks for each step as soon as it arrives, so the next sentence is usually ready when the last one ends, and it starts playing after about a tenth of a second of sound has arrived.

If the server does not make a sound within `voiceFirstAudioMs`, or answers an error, that step is spoken by the system voice, and the server is left alone for `voiceCooldownMs` so a down server costs one short wait, not one per step; then it is tried again. A stream that breaks half-way ends that step (it is not spoken again). Pick a first-sound limit well under the 2.5 seconds after which a step is drawn anyway.

The log says, in numbers only, how long the first sound took after the words (`voice streamed: first sound 173 ms after the words`, and the same for `speech-synthesis`). The words are never logged.
