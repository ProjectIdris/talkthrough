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

Do the thing that went wrong, quit from the tray, and read `talkthrough-log.txt`. It lists what the app did, with no screenshot and no question text unless you start it with `--log-steps`. Remove anything private before you share it.

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

## Choose how it runs your model

Talkthrough sends your screenshot and question to a model you choose. Set `model` in the settings file:

1. **`"codex"`: your own locally installed Codex CLI**, signed in by you. The app runs `codex app-server` itself with a read-only sandbox, no approvals, its tool features off and an empty working folder, and ends the question if anything tries to use a tool.
2. **`"claude"`: your own Claude Code**, signed in by you. The app runs it in print mode with no tools, no MCP servers, no slash commands and no settings files, and refuses to go on if its first message lists anything else.
3. **`"openai"`: an API key.** The app calls the OpenAI Responses API directly, streamed, with strict structured outputs and nothing stored on the provider's side. Choose *API key…* from the tray menu and paste your key: it is stored encrypted for your Windows account (Electron's `safeStorage`; nothing is saved if that is unavailable; this protects it from other users and from copies of the disk, not from other programs running as you, which can decrypt it the same way), is only ever sent to the API address as a header, and is never logged. Costs are billed to your account by the provider.

For the first two, Talkthrough only starts the tool you already have; it never reads or stores your sign-in. If your Codex setup lists tool servers (MCP), the app switches each one off for the process it starts; the list is read when that process starts, so a server added later is switched off at the next start. **Check your provider's terms for automated use before you pick one.** To use something else, write a `Model` adapter (`src/adapters/model.ts`).

## Speech

Your question is recorded in memory, turned into text by a local recogniser, and thrown away. Talkthrough ships a client for a recogniser that runs as a small local HTTP server (`createLocalSpeechServerRecogniser`): `POST /transcribe` with raw 16 kHz mono float32 samples, answer `{"text": "..."}`, and `GET /health` to check it is up. The app never starts it; if the address does not answer, the overlay says so. A recogniser that ships with the app is planned.
