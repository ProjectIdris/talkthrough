# Setting up Talkthrough

Windows is the desktop setup described here. Running from source also requires Node.js 24 or newer; the Windows installer does not require a separate Node.js installation.

For a source checkout, run these commands in the folder containing `package.json`:

```
npm install
npm start        # builds, then starts the app in the tray
```

On first launch, choose a model route and check that hearing is available. Codex and Claude Code must already be installed and signed in; the API-key route needs your key, and the local route needs a running vision-model server. See [model routes](#choose-how-it-runs-your-model) and [Speech](#speech). A paid model route can use your allowance or incur API charges when you ask a question.

**Try it before setup:** choose **Explore examples** on the welcome screen, or **Explore visual examples…** from the tray at any time. The offline explorer has four built-in explanations: a web request, a recipe, supply and demand, and a timeline. Choose an example, then use **Next step**, **Back** or **Restart example** to read and inspect it at your own pace. It uses the real diagram renderer in its own window and makes no model request, recording, screen capture or download. Closing it leaves setup unchanged. These are hand-written examples, not a test of your model or speech setup.

To check the overlay before connecting a model or microphone, choose **Play a sample scene** from the tray. It draws a built-in scene without asking a model or recording a question. If anything fails, start with [Troubleshooting](troubleshooting.md).

Hold **Right Ctrl + Right Shift** (or the single key or chord you chose in *Settings*), ask out loud, let go. The overlay answers on the screen you were looking at. The tray icon has *Settings…*, *Explore visual examples…*, *Play a sample scene*, *Clear the overlay* and *Quit*.

### Building the installer

To build the Windows installer (per-user, no administrator rights, unsigned for now):

```
npm ci
# PowerShell: mark this disposable copy before changing its native binaries
Set-Content -LiteralPath node_modules/.talkthrough-disposable-packaging -Value 'disposable packaging copy' -Encoding ascii
node scripts/native-packaging.mjs --owned-copy node_modules
npm run dist       # builds, then writes release/Talkthrough-Setup-<version>.exe
```

Use a disposable checkout with its own `node_modules`, not a linked or shared directory: sanitizing updates the Windows native binaries in that copy before packaging. It refuses hard-linked inputs, removes directory paths from their CodeView debug records and updates their PE checksums; it does not rebuild the modules. Run it without concurrent writers: a failed write can leave a partially sanitized copy, which should be discarded. The packaging check refuses unsafe debug paths, malformed inputs and signed binaries. The icon is drawn by `scripts/make-icon.mjs` into `build/`; the packaging settings are in `electron-builder.yml`. It also writes `release/SHA256SUMS.txt` (one `<sha256>  <file>` line); publish it on the release with the installer, because the app's self-update refuses an installer it cannot check against that file. Because the installer is unsigned, Windows SmartScreen may say "Windows protected your PC" when it is downloaded; *More info*, then *Run anyway*, starts it.

### Uninstalling, and what it leaves

The installer puts the program under `%LOCALAPPDATA%\Programs\Talkthrough` and adds a Start menu entry; *Apps > Installed apps* (or the uninstaller in that folder) removes both. It leaves **your own files** on purpose, in `%APPDATA%\Talkthrough`: your settings file, the encrypted API key file (`api-key.bin`), your pins (the `pins` folder), the app's preferences (`prefs.json`), downloaded hearing files (`speech`), question records (`questions`, if enabled) and the browser engine's caches. After uninstalling, delete that folder if you no longer want those files. A custom `recordFolder`, exported pins and files saved with development flags are elsewhere and are not removed with it.

### Updates

The installed app asks GitHub, at start and once a day, for the latest release of this project (one small request that carries only the version number and the usual network address). If a newer version is out, the tray menu and **Settings…** say so; nothing else happens. When you say yes (the tray item, or **Install and restart** in Settings) it downloads that release's installer from the project's release page, checks it against the release's `SHA256SUMS.txt`, runs it silently and starts the new version. A download that does not match its checksum is deleted and never run. Nothing is checked, downloaded or run while a question is being asked or answered. If there is no network or GitHub is limiting requests, it says nothing and tries again later. Turn the checks off with **Look for a newer version** in Settings, or `"checkForUpdates": false`. A copy started from source never checks.

### A record of each question

To see exactly what went wrong with an answer, turn on **Keep a record of each question** in **Settings…** (or `"keepRecord": true`). Each question then gets its own dated folder, named like `2026-11-05_14-32-07`, with what was sent (the screenshot, any closer crops), what was heard, what the model was called with and answered (its name, how long it took, the raw text it wrote), what was drawn, what the checker repaired, which voice spoke each step and why, and what broke. The newest 50 dated record folders are kept; older matching folders are deleted when a new record begins. Use a dedicated folder for records, not one containing other dated folders you want to keep. It is off by default because the folders hold your screenshots and your words: Talkthrough writes them locally, but they remain until you delete them or enough newer records replace them. Turning the setting off does not erase existing records. A folder in a cloud-synced location may also be copied by your sync service. The folder is `questions` in the app's data folder unless `recordFolder` names another (a full path).

### A log from an installed copy

The app writes its log to the console it was started from, and an installed copy has none. To get one, quit Talkthrough (tray menu, *Quit*), then in a Command Prompt run:

```
"%LOCALAPPDATA%\Programs\Talkthrough\Talkthrough.exe" > talkthrough-log.txt 2>&1
```

Do the thing that went wrong, quit from the tray, and read `talkthrough-log.txt`. It lists what the app did, with no screenshot, no question text and no model answer unless you start it with `--log-steps` (which also writes each answer's raw text, one `answer-raw` line per answer, so a garbled one can be read). Remove anything private before you share it.

For a source checkout, capture a normal log with `npm start > talkthrough-log.txt 2>&1`. See [collecting a useful report](troubleshooting.md#collecting-a-useful-report) for what to include and what to remove.

## Graphics

The overlay uses the graphics card by default, with antialiasing, soft shadows and ambient occlusion. A machine with no usable card falls back to Chromium's software rasteriser at a lighter quality tier. To force software rendering, start with `--software` or set `TALKTHROUGH_SOFTWARE=1`. The old `--gpu` and `TALKTHROUGH_GPU=1` switches are accepted but no longer change anything.

## Settings

Open **Settings…** from the tray icon. One window has the route and model, the detail route, the voice (the system voice, or a voice server's address), hearing options and an optional speech server address, the key or chord held to ask, the windows to skip, the two switches (*let a guide act for me*, *place marks on real controls*; both off until you turn them on, each with a line saying what it does) and the API key. Saving writes the file below, through the same checks as the file: a value that does not pass (an http voice address that is not on this computer, two keys that are the same) is not saved, and the window says why. Changes take effect when Talkthrough restarts (the window has a button for that), except the list of windows to skip, which protects as soon as it is saved.

The window writes a JSON file, `%APPDATA%\talkthrough\settings.json` (the app logs the exact path when it starts), which you can also edit by hand. Every key is optional; a key left at its default is not written.

| Key | Meaning | Default |
| --- | --- | --- |
| `speechServerUrl` | Optional base URL of a speech recogniser you run (https, or a loopback address; see below). The app can use installed Windows hearing without it. | none |
| `speechLimitMs` | Sent to the speech server as `limit_ms`: how long its main recogniser may take before a quicker one answers. About 1000 suits a CPU-only server. | server's own |
| `model` | The connector that writes the first step: `"claude"` (Claude Code), `"codex"`, `"openai"` (an API key) or `"local"` (a model on this computer) | `"codex"` |
| `codexModel` | Model name in your Codex catalog | `"gpt-6-luna"` |
| `voiceServerUrl` | A local text-to-speech server that makes the voice (https, or a loopback address): the full address a request is POSTed to. Without it the system voice speaks. The words of each spoken step are sent there, and nothing else. See [Voice](#voice). | none |
| `voiceServerVoice` | Which voice to ask the server for (sent as `voice`), if it has several | none |
| `voiceFirstAudioMs` | How long the server has to make its first sound before the system voice speaks that step instead, 300 to 30,000 ms | `10000` (10 seconds) |
| `voiceCooldownMs` | How long the server is then left alone before it is tried again, 2,000 to 600,000 | `20000` |
| `voiceTimeoutMs` | How long one spoken step may take in all, 5,000 to 120,000 | `30000` |
| `backendUrl` | Where the optional deeper backend listens (https, or a loopback address). Without it there is no backend and nothing is sent anywhere else. See [backend.md](backend.md). | none |
| `backendTimeoutMs` | How long to wait for the backend's answer, 5,000 to 900,000 | `180000` |
| `codexFast` | Fast mode for the Codex process this app starts (uses more of your usage allowance; your own Codex settings are not touched) | `false` |
| `claudeModel` | Claude model name | `"claude-haiku-5-5"` |
| `laterRoute`, `laterModel` | The connector and model that write the steps after step 1, when they are not the first step's: `laterRoute` names the connector (left out: the first step's), `laterModel` the model (left out: that connector's own). Naming a different one makes the answer be written one step to a call, on any connector. The older `claudeLaterModel` (Claude route) is read as `laterModel` | the same as step 1 |
| `localModel`, `localBaseUrl` | The local connector: the model's name on an OpenAI-compatible server on this computer (Ollama, LM Studio, llama.cpp's server), and its API address (loopback only), for example `http://127.0.0.1:11434/v1` (Ollama) or `http://127.0.0.1:1234/v1` (LM Studio). The model must take pictures (a vision model): every question carries a screenshot. No key is used and nothing leaves the computer. *Test connection* in Settings checks that the server is there, lists the model and takes a picture | none, `http://127.0.0.1:11434/v1` |
| `microphone`, `microphoneName`, `speaker`, `speakerName` | The microphone and the speaker, by the system's device id and name (chosen in Settings); left out: the system's default. A device that has gone is replaced by the default, with one short notice. Every voice plays through the speaker, the system voice too | system default |
| `openaiModel` | Model name for the API-key route | `"gpt-6-luna"` |
| `openaiServiceTier` | Optional service tier for the API-key route (`"fast"` costs more) | none |
| `openaiBaseUrl` | Optional API address, https only (or a loopback address) | OpenAI's |
| `codexCommand`, `claudeCommand` | Full path of the tool, if it is not on `PATH` | found on `PATH` |
| `hotkey` | The keys held to ask: one key, or up to four held together, joined by `+` (for example `right-ctrl+right-shift`, `f13`, `left-ctrl+left-alt+f9`). Names are in `src/shared/chord-keys.ts`; Settings has a *Change* button that records the keys as you press them. Escape is never offered (it cancels a question). A single key fires whenever you press it, so one you use for typing or shortcuts is a poor choice (Settings says so; keys such as F13 to F24 are safe). Holding the first key of a chord that starts with Ctrl, Shift or Alt alone opens the microphone early; a single key or a typing key never does. Read at start | `"right-ctrl+right-shift"` |
| `captureBlocklist` | Words naming windows never to look at: if the window in front has one in its app name, program file or title (any case), holding the keys does nothing: nothing is recorded, captured or sent, and the overlay says so. Only the window in front is checked. If the window in front cannot be read (the read fails, comes back empty, or takes more than 0.3 seconds), the press is refused the same way, with a notice saying so, rather than looked at: with a list, no answer means no. An empty list `[]` turns it off, and then nothing is read at all | `["1Password", "Bitwarden", "KeePass", "LastPass", "Dashlane", "Proton Pass"]` |
| `micWindowMs` | How long Right Ctrl may be held alone before the early microphone and screen grab are dropped | `1000` |
| `screenshotEdge` | Longer side of the screenshot sent to the model, in pixels | `1280` |
| `effort` | Reasoning effort asked of the model | `"low"` |
| `guideNavigation` | On Windows, guide mode may open a tab, open a menu that has a submenu, or scroll for you, when the answer asks for it. The first time in a session it asks, and does nothing until you say yes (hold the keys and say "yes") or click Yes on the card it shows or in the tray; after one yes it carries on for the session. Before every move it says what it is about to do, and a key, a click, Escape or moving the pointer stops it. The tray has "Pause everything it does for me", which stops all of it at once. A guard reads the real control (read-only) and refuses everything but a tab, a menu that opens a submenu and a scrollable area: never a button, link, check box, toggle, field, or anything that saves, sends, deletes or buys. **Off until you turn it on.** Native windows only: it never touches a browser (Chrome, Edge, Firefox) or an Electron app, because driving one through accessibility has the same cost as reading one. Nothing is sent anywhere | `false` |
| `controlSnap` | On Windows, put marks exactly on the buttons, tabs and menu items of the window in front. The app reads their rectangles (and kind) from the accessibility tree, read-only: it never clicks, never reads names or text, and nothing is sent anywhere. **Off until you turn it on.** It never reads a browser window (Chrome, Edge, Firefox, Electron apps such as Slack or VS Code): asking a browser for its accessibility tree switches accessibility on in the whole browser until it is restarted, and that costs the browser CPU. There, and wherever the setting is off, marks snap to the picture alone | `false` |
| `captions` | What an answer's words are given as: `"both"` speaks each step and shows its words on screen as they are said, `"text"` speaks nothing and keeps each step up for its reading time (no voice is asked, no sound is made), `"voice"` speaks only. See [Captions](overlay.md#captions). | `"both"` |
| `splitAnswer` | Claude route only, so the first words come sooner: `"steps"` writes one step to a call, each asked for when the one before has ended (the first words come in about three to four seconds); `"two"` writes step 1 alone, then the rest in a second call while step 1 is spoken; `"off"` writes the whole answer in one call (the first words come later, in six to ten seconds on a rich page). Each question under `steps` or `two` uses two or more calls of your Claude allowance. If a later call fails, the answer ends where it was. Choosing "In one call" in the settings window writes `"off"` to the file. (The older `twoStepAnswer: true` means `"two"`, `false` means `"off"`.) | `"steps"` |
| `checkForUpdates` | Look for a newer release at start and once a day, and say so in the tray and Settings (see *Updates* above). Nothing is downloaded without your yes. Also in **Settings…** | `true` |
| `keepRecord` | Keep a record of each question (see *A record of each question* above). Off until you turn it on, also in **Settings…** | `false` |
| `recordFolder` | Optional full folder path for that record | the app's data folder, `questions` inside it |
| `detailRoute` | Turns on the **detail pass**: `"codex"`, `"claude"`, `"openai"` or `"local"`, the route that writes a much richer version of the scene on screen when you ask for more detail (see below) | none (off) |
| `detailModel` | Model the detail route uses | `"gpt-6.1-sol"` for `codex` and `openai`, `"claude-sonnet-5-5"` for `claude` |
| `detailEffort` | Reasoning effort for the detail pass | `"medium"` |

## Choose how it runs your model

Talkthrough sends your screenshot and question to a model you choose. Set `model` in the settings file (or choose it in Settings, or in the first-run window, which looks on this computer for Claude Code and Codex and says what it found):

1. **`"codex"`: your own locally installed Codex CLI**, signed in by you. The app runs `codex app-server` itself with a read-only sandbox, no approvals, its tool features off and an empty working folder, and ends the question if anything tries to use a tool.
2. **`"claude"`: your own Claude Code**, signed in by you. The app runs it in print mode with no tools, no MCP servers, no slash commands and no settings files, and refuses to go on if its first message lists anything else.
3. **`"openai"`: an API key.** The app calls the OpenAI Responses API directly, streamed, with strict structured outputs and `store: false`. This opts out of storing the response for later API retrieval; it is not a promise about all provider-side retention. Check your provider's data policies. Choose *Settings…* from the tray menu and paste your key: it is stored encrypted for your Windows account (Electron's `safeStorage`; nothing is saved if that is unavailable; this protects it from other users and from copies of the disk, not from other programs running as you, which can decrypt it the same way), is only ever sent to the API address as a header, and is never logged. Costs are billed to your account by the provider.
4. **`"local"`: a model on this computer**, through an OpenAI-compatible server you run (Ollama, LM Studio). The app calls its Chat Completions API, streamed, with the screenshot as an image part and the scene schema as the answer format (a server that refuses a schema is asked again in plain JSON mode with the schema in the prompt). The address must be on this computer. The model must take pictures. Press *Test connection* in Settings or *Test* during first run to send a small generated picture and a fixed setup question to that local address. The check uses the same streamed scene request and schema fallback as a real question, and passes only after a complete, usable scene comes back. It sends no screenshot, recording, conversation, or saved API key. It does not prove picture understanding or visual quality, and does not test screen capture, hearing, voice, or the hotkey. Talkthrough calls only the configured local server for this check.

For the first two, Talkthrough only starts the tool you already have; it never reads or stores your sign-in. If your Codex setup lists tool servers (MCP), the app switches each one off for the process it starts; the list is read when that process starts, so a server added later is switched off at the next start. **Check your provider's terms for automated use before you pick one.** To use something else, write a `Model` adapter (`src/adapters/model.ts`).

### Trying one live question from a checkout

`node scripts/live-check.mjs --claude-command <path to the claude executable> --page <screenshot.png> --question "Explain this"` asks one question on a saved screenshot, on the Claude (Haiku) route, in a hidden window with a silent voice. It writes the settings itself and refuses to start unless they read back as the claude route, a Haiku model and an executable that exists (a settings file that does not parse falls back to the default route without a word, and the call would go to the wrong model). Frames, the app's log (with each answer's raw text) and a short summary of what the answer drew are left in `--out`. `--route-only` runs the check and stops.

`node scripts/live-proof.mjs --before <built checkout> --after <built checkout> --settings <settings file> --out <folder>` is the same question asked of two builds of the app, side by side: the seventeen questions of the baseline (`--only arm,pulley` for some), each on a plain stand-in screenshot made by the script (the real screen is never captured), the side that goes first alternating by question, on the software rasteriser unless `--gpu yes`. Without `--live yes` it only prints the plan, the route check and the guide length of each side. `--live yes` asks the models (two paid calls a question, after the same route check as `live-check`); `--replay <folder of <question>.json tapes>` plays tapes through both builds instead, with no model and no cost. Per run it keeps the frames, `run.log` and `tape.json`; it writes `sheets/<question>.png` (the middle and last frame, before left, after right) and `report.md` (steps, actions, timing, tokens and log notes per run). Build both checkouts first (`node scripts/build.mjs`).

`node scripts/measure-first-word.ts --command <claude executable> --mode call --max-calls 1 --image <page.png>` times one question on the Claude route from the moment it is sent: when the command is ready, the first byte from the API, how long the model thinks, and when the first `say` is complete. `--mode idle` only starts the process and makes no call.

## The detail pass

A quick answer is drawn with a small, fast model. If you set `detailRoute`, a **More detail** button appears beside a finished 3D model (next to *Explode*), and saying "show me in detail" does the same. The app then sends the screenshot, your question and the scene on screen to the detail model, which is asked for a much richer version of the same scene (the same ids, ready-made parts, linkages, smaller parts). The picture upgrades in place as the pieces arrive, with a quiet "Adding detail…" in the corner and nothing spoken. A new question cancels it. It never runs by itself, and without `detailRoute` nothing offers it and no second model is ever started. The detail route is run exactly like the quick one (the same locked-down Codex or Claude process, or the API key) with its own model and effort; it uses more of your allowance than a quick answer.

## Speech

On Windows, Talkthrough can use the installed English Windows speech recogniser with no extra download. It requires an English recogniser to be available on that computer and works best with short, clear English. If it is unavailable or cannot recognise the question, the app reports that it could not hear it.

For another local option, choose **Clearer hearing** in the first-run window or Settings and explicitly download whisper.cpp and a model. Neither is bundled: the app shows the download before you agree, checks the files, and lets you remove them in Settings. The recogniser runs on your computer. It writes a temporary WAV while processing each question and removes it when the run ends.

You can instead configure your own speech recogniser server using `speechServerUrl`. Your recording is sent to that address, so run it on your own computer. Only HTTPS or a loopback HTTP address is accepted, and redirects are refused so the recording cannot be forwarded to an unconfigured destination. The app does not start the server. The client sends `POST /transcribe` with raw 16 kHz mono float32 samples and expects `{"text": "..."}`; `GET /health` checks availability. An optional `POST /warm` lets a sleeping server prepare in the background. A server without that route is not asked again for a while.

When configured, the server is initially tried before a downloaded whisper.cpp recogniser and Windows hearing. If a recogniser is unavailable or fails, the app tries the next one; it remembers the last one that worked and tries it first for later questions. An empty recognition result or a cancelled question ends that attempt rather than falling through. On platforms without Windows hearing, an available configured server or downloaded recogniser is needed.

## Voice

By default each step is spoken by your system voice. If you run a text-to-speech server of your own, set `voiceServerUrl` and the app speaks with that instead, falling back to the system voice whenever the server is down or slow. Nothing is built in: no address is ever tried unless you set one, and the app never starts or stops the server.

What the server must do: accept `POST <voiceServerUrl>` with the JSON body `{"text": "...", "voice": "..."}` (`voice` only if you set `voiceServerVoice`) and answer `200` with audio, sent as it is made, in either of two forms:

- a WAV stream (`Content-Type: audio/wav`): 8, 16, 24 or 32-bit integer PCM or 32-bit float, one or two channels. The length in the header may be real, zero or unknown (the audio then runs to the end of the response);
- raw PCM (`Content-Type: audio/pcm; rate=24000; channels=1`): signed 16-bit little-endian.

A busy server may answer `503` with `Retry-After` (seconds, or a date; a wait over a minute counts as a minute). That step is spoken by the system voice at once, the server is left alone for that long, and then the next step asks it again; any other error uses the ordinary cooldown (`voiceCooldownMs`).

Any other answer is an error (a text body is shown in the log), and that includes a redirect: the app never follows one, so the words go only to the address you set. The app asks for each step as soon as it arrives, so the next sentence is usually ready when the last one ends, and it starts playing after about a tenth of a second of sound has arrived.

When the keys first go down the app wakes the server: `POST` with no body to the speak address with its last segment replaced by `warm` (`.../voice-shared/speak` is woken at `.../voice-shared/warm`), at most once in 30 seconds, and any answer, or none, is fine; it is skipped when that is the same address as the recogniser's `/warm`, which was just sent. A server that makes a sentence whole before sending it (its first byte comes with the first sentence) takes one to six seconds for the first sound of a step, so the picture waits for up to 10 seconds by default (`voiceFirstAudioMs`), then uses the system voice for that step if no sound has arrived.

If the server does not make a sound within `voiceFirstAudioMs`, or answers an error, that step is spoken by the system voice, and the server is left alone for `voiceCooldownMs` so a down server costs one short wait, not one per step; then it is tried again. A stream that breaks half-way ends that step (it is not spoken again). The overlay gives the selected voice another 1,500 ms to start before it advances the step; its wait is the greater of 2,500 ms and `voiceFirstAudioMs` + 1,500 ms (11.5 seconds by default).

The log says, in numbers only, how long the first sound took after the words (`voice streamed: first sound 173 ms after the words`, and the same for `speech-synthesis`), and for each step which voice spoke it and why (`voice: this step is spoken with streamed`, or with `speech-synthesis` and the reason the server is being left alone). Each call to a model is told too, with the model's name (`model call 2: claude-sonnet-5-5 (a step, next 2) first output 1220 ms, ended 3910 ms`), so one step written by Haiku and the next by Sonnet can be told apart. The words are never logged.
