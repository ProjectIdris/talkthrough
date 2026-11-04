# Setting up Talkthrough

Windows, Node.js 24 or newer.

```
npm install
npm start        # builds, then starts the app in the tray
```

Hold **Right Ctrl + Right Shift**, ask out loud, let go. The overlay answers on the screen you were looking at. The tray icon has *Play a sample scene*, *Clear the overlay* and *Quit*.

Talkthrough needs two things outside itself: a way to hear you and a model.

## Settings

A JSON file, `%APPDATA%\talkthrough\settings.json` (the app logs the exact path when it starts). Every key is optional.

| Key | Meaning | Default |
| --- | --- | --- |
| `speechServerUrl` | Base URL of a local speech recogniser (see below). Without it the app cannot hear you and says so. | none |
| `speechLimitMs` | Sent to the speech server as `limit_ms`: how long its main recogniser may take before a quicker one answers. About 1000 suits a CPU-only server. | server's own |
| `model` | `"codex"` or `"claude"` | `"codex"` |
| `codexModel` | Model name in your Codex catalog | `"gpt-6-luna"` |
| `codexFast` | Fast mode for the Codex process this app starts (uses more of your usage allowance; your own Codex settings are not touched) | `false` |
| `claudeModel` | Claude model name | `"claude-haiku-5-5"` |
| `codexCommand`, `claudeCommand` | Full path of the tool, if it is not on `PATH` | found on `PATH` |
| `micWindowMs` | How long Right Ctrl may be held alone before the early microphone and screen grab are dropped | `1000` |
| `screenshotEdge` | Longer side of the screenshot sent to the model, in pixels | `1280` |
| `effort` | Reasoning effort asked of the model | `"low"` |

## Choose how it runs your model

Talkthrough sends your screenshot and question to a model you choose. Set `model` in the settings file:

1. **`"codex"`: your own locally installed Codex CLI**, signed in by you. The app runs `codex app-server` itself with a read-only sandbox, no approvals, its tool features off and an empty working folder, and ends the question if anything tries to use a tool.
2. **`"claude"`: your own Claude Code**, signed in by you. The app runs it in print mode with no tools, no MCP servers, no slash commands and no settings files, and refuses to go on if its first message lists anything else.
3. **An API key** (planned): a model that calls a provider's API directly with a key you enter in settings.

For the first two, Talkthrough only starts the tool you already have; it never sees or stores your sign-in. **Check your provider's terms for automated use before you pick one.** To use something else, write a `Model` adapter (`src/adapters/model.ts`).

## Speech

Your question is recorded in memory, turned into text by a local recogniser, and thrown away. Talkthrough ships a client for a recogniser that runs as a small local HTTP server (`createLocalSpeechServerRecogniser`): `POST /transcribe` with raw 16 kHz mono float32 samples, answer `{"text": "..."}`, and `GET /health` to check it is up. The app never starts it; if the address does not answer, the overlay says so. A recogniser that ships with the app is planned.
