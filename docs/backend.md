# The deeper backend

Talkthrough's fast model answers most questions. For the ones that are beyond it (long research, deep reasoning, something it cannot see) the app can hand the question to a **backend**: any program that listens on an HTTP address, takes the question with the screenshot and what is on screen, and answers in the [scene language](scene-language.md). The reply is drawn and spoken exactly like the fast model's, and it carries on the same scene, so a backend can add to what is already there.

Nothing is built in: no address, no account. The backend is only used if you name its address in the settings, and then **the screenshot and the question are sent to it**, so point it at something you trust.

- Code: `src/adapters/backend.ts` (the interface and the generic HTTP client), the question loop in `src/main/session.ts`.
- Settings: `backendUrl` (https, or a loopback address such as `http://127.0.0.1:4900/ask`) and, optionally, `backendTimeoutMs` (5,000 to 900,000; default 180,000). See [setup.md](setup.md).

## When the app calls it

1. **The offer.** When the fast model sets `escalate`, the overlay offers to ask a deeper helper. Clicking the offer sends the question that was just asked, with its screenshot.
2. **By voice.** Saying "ask the backend" (also "send this to the backend", "hand it to the backend") at the start of a question hands that question over instead of asking the fast model. "Ask the backend, why is this slow?" sends "why is this slow?". Saying only "ask the backend" sends the last question again, with the screen as it is now. A question that merely mentions the backend ("what does the backend of this page do?") is an ordinary question.

While the backend works the overlay shows **With the backend**. It goes when the first step arrives or when the request ends. If the request fails, the app says so in a notice; it never stays silent.

## The request

`POST` to `backendUrl`, `Content-Type: application/json`, `Accept: application/json`, no redirects followed, no credentials sent. One JSON object:

| Field | Type | |
|---|---|---|
| `v` | `1` | Version of this contract. |
| `trigger` | `"offer"` or `"spoken"` | How the request came about. |
| `reason` | text, optional | Why the fast model gave up (its `escalate`), for an accepted offer. |
| `question` | text | What was asked, transcribed from speech (it may contain recognition errors). |
| `screenshot` | `{ mime, width, height, base64 }` | The picture the fast model saw, PNG, base64 without a prefix. If the user circled something with the pen, it has the stroke drawn on it in red. |
| `thread` | `[{ question, said: [text, ...] }]` | The conversation so far, oldest first: each earlier question and the lines that were spoken for it. |
| `scene` | `{ steps: [...], ids: { id: kind } }` | What is on screen: every step drawn in this thread so far (scene-language steps, oldest first), and the ids now in use with their kinds (`mark`, `pin`, or a 3D object kind), so an answer can change them or avoid reusing them. |

Example (the picture shortened):

```json
{
  "v": 1,
  "trigger": "offer",
  "reason": "Finding the cause of this failure needs a deeper read of the log",
  "question": "why does this build fail?",
  "screenshot": { "mime": "image/png", "width": 1280, "height": 536, "base64": "iVBORw0KGgo..." },
  "thread": [{ "question": "what is this?", "said": ["This is a build log.", "The last lines show an error."] }],
  "scene": {
    "steps": [{ "say": "The last lines show an error.", "actions": [{ "op": "box", "id": "err", "x": 80, "y": 700, "w": 700, "h": 90, "color": "red" }] }],
    "ids": { "err": "mark" }
  }
}
```

Marks in an answer use the same 0 to 1000 scale across the whole screenshot as everywhere else in the app.

## The reply

`200` with one JSON object (at most 4 MB), holding **at least one of**:

- `scene`: a scene, `{ "steps": [ { "say": "...", "actions": [...] }, ... ] }`. It is validated by the app exactly like a model's answer ([what the validator does](scene-language.md#what-the-validator-does)): unknown actions are dropped, numbers clamped, counts capped, ids must not collide with ids in use. It continues the scene on screen. An `escalate` field in it is ignored: the backend is where an escalation ends.
- `message`: a line of text to show as a notice (control characters are removed, at most 300 characters). If there is a `scene` as well, the scene is drawn and the message is not.

Or an error: `{ "error": "text" }` with any status.

| Status | The app tells the user |
|---|---|
| `200` with `scene` and/or `message` | draws it / shows it |
| `200` with `error`, or any other status with an `error` | "The backend could not answer." (the text is logged, not shown) |
| `401`, `403` | "The backend did not accept the request." |
| `429` | "The backend is busy. Try again in a moment." |
| `5xx`, a connection failure, a redirect | "I couldn't reach the backend." |
| Not JSON, neither field present, over 4 MB | "The backend's answer was garbled." |
| No answer within `backendTimeoutMs` | "The backend could not answer." |

The reply is one document, not a stream, in this version. A backend that wants to say "working on it" can send a `message` and let the user ask again.

## A minimal backend

Node, no packages, answers every question with one step that boxes the middle of the screen:

```js
import { createServer } from 'node:http';

createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const ask = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const scene = { steps: [{ say: `You asked: ${ask.question}`, actions: [{ op: 'box', id: 'mid', x: 300, y: 300, w: 400, h: 400, color: 'purple' }] }] };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ scene }));
  });
}).listen(4900, '127.0.0.1');
```

Set `"backendUrl": "http://127.0.0.1:4900/"` in the settings and ask a question with the escalation offer, or say "ask the backend".

## Notes for a backend's author

- The request carries a full screenshot. Do not log or keep it unless the user knows.
- There is no authentication in this version: keep the backend on the same machine, or put an authenticating tunnel or proxy in front of an https address. A header option is planned.
- Use ids that do not collide with `scene.ids` (a letter, then up to 31 letters, digits, `_` or `-`).
- Use only what the [scene language](scene-language.md) lists; anything else is dropped.
