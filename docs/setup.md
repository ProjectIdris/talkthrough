# Setting up Talkthrough

Windows, Node.js 24 or newer.

```
npm install
npm start        # builds, then starts the app in the tray
```

Hold **Right Ctrl + Right Shift**, ask out loud, let go. The overlay answers on the screen you were looking at. The tray icon has *Play a sample scene*, *Clear the overlay* and *Quit*.

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

A JSON file, `%APPDATA%\talkthrough\settings.json` (the app logs the exact path when it starts). Every key is optional.

| Key | Meaning | Default |
| --- | --- | --- |
| `speechServerUrl` | Base URL of a local speech recogniser (see below). Without it the app cannot hear you and says so. | none |
| `speechLimitMs` | Sent to the speech server as `limit_ms`: how long its main recogniser may take before a quicker one answers. About 1000 suits a CPU-only server. | server's own |
| `model` | `"codex"`, `"claude"` or `"openai"` | `"codex"` |
| `codexModel` | Model name in your Codex catalog | `"gpt-6-luna"` |
| `backendUrl` | Where the optional deeper backend listens (https, or a loopback address). Without it there is no backend and nothing is sent anywhere else. See [backend.md](backend.md). | none |
| `backendTimeoutMs` | How long to wait for the backend's answer, 5,000 to 900,000 | `180000` |
| `codexFast` | Fast mode for the Codex process this app starts (uses more of your usage allowance; your own Codex settings are not touched) | `false` |
| `claudeModel` | Claude model name | `"claude-haiku-5-5"` |
| `openaiModel` | Model name for the API-key route | `"gpt-6-luna"` |
| `openaiServiceTier` | Optional service tier for the API-key route (`"fast"` costs more) | none |
| `openaiBaseUrl` | Optional API address, https only (or a loopback address) | OpenAI's |
| `codexCommand`, `claudeCommand` | Full path of the tool, if it is not on `PATH` | found on `PATH` |
| `micWindowMs` | How long Right Ctrl may be held alone before the early microphone and screen grab are dropped | `1000` |
| `screenshotEdge` | Longer side of the screenshot sent to the model, in pixels | `1280` |
| `effort` | Reasoning effort asked of the model | `"low"` |
| `controlSnap` | On Windows, put marks exactly on the buttons, tabs and menu items of the window in front: the app reads their rectangles (and their kind) from the accessibility tree, read-only, never clicking or reading names or text, and nothing is sent anywhere. `false` turns it off, and marks then snap to the picture alone | `true` |
| `detailRoute` | Turns on the **detail pass**: `"codex"`, `"claude"` or `"openai"`, the route that writes a much richer version of the scene on screen when you ask for more detail (see below) | none (off) |
| `detailModel` | Model the detail route uses | `"gpt-6.1-sol"` for `codex` and `openai`, `"claude-sonnet-5-5"` for `claude` |
| `detailEffort` | Reasoning effort for the detail pass | `"medium"` |

## Choose how it runs your model

Talkthrough sends your screenshot and question to a model you choose. Set `model` in the settings file:

1. **`"codex"`: your own locally installed Codex CLI**, signed in by you. The app runs `codex app-server` itself with a read-only sandbox, no approvals, its tool features off and an empty working folder, and ends the question if anything tries to use a tool.
2. **`"claude"`: your own Claude Code**, signed in by you. The app runs it in print mode with no tools, no MCP servers, no slash commands and no settings files, and refuses to go on if its first message lists anything else.
3. **`"openai"`: an API key.** The app calls the OpenAI Responses API directly, streamed, with strict structured outputs and nothing stored on the provider's side. Choose *API key…* from the tray menu and paste your key: it is stored encrypted for your Windows account (Electron's `safeStorage`; nothing is saved if that is unavailable; this protects it from other users and from copies of the disk, not from other programs running as you, which can decrypt it the same way), is only ever sent to the API address as a header, and is never logged. Costs are billed to your account by the provider.

For the first two, Talkthrough only starts the tool you already have; it never reads or stores your sign-in. If your Codex setup lists tool servers (MCP), the app switches each one off for the process it starts; the list is read when that process starts, so a server added later is switched off at the next start. **Check your provider's terms for automated use before you pick one.** To use something else, write a `Model` adapter (`src/adapters/model.ts`).

### Trying one live question from a checkout

`node scripts/live-check.mjs --claude-command <path to the claude executable> --page <screenshot.png> --question "Explain this"` asks one question on a saved screenshot, on the Claude (Haiku) route, in a hidden window with a silent voice. It writes the settings itself and refuses to start unless they read back as the claude route, a Haiku model and an executable that exists (a settings file that does not parse falls back to the default route without a word, and the call would go to the wrong model). Frames, the app's log (with each answer's raw text) and a short summary of what the answer drew are left in `--out`. `--route-only` runs the check and stops.

## The detail pass

A quick answer is drawn with a small, fast model. If you set `detailRoute`, a **More detail** button appears beside a finished 3D model (next to *Explode*), and saying "show me in detail" does the same. The app then sends the screenshot, your question and the scene on screen to the detail model, which is asked for a much richer version of the same scene (the same ids, ready-made parts, linkages, smaller parts). The picture upgrades in place as the pieces arrive, with a quiet "Adding detail…" in the corner and nothing spoken. A new question cancels it. It never runs by itself, and without `detailRoute` nothing offers it and no second model is ever started. The detail route is run exactly like the quick one (the same locked-down Codex or Claude process, or the API key) with its own model and effort; it uses more of your allowance than a quick answer.

## Speech

Your question is recorded in memory, turned into text by a local recogniser, and thrown away. Talkthrough ships a client for a recogniser that runs as a small local HTTP server (`createLocalSpeechServerRecogniser`): `POST /transcribe` with raw 16 kHz mono float32 samples, answer `{"text": "..."}`, and `GET /health` to check it is up. The app never starts it; if the address does not answer, the overlay says so. A recogniser that ships with the app is planned.
