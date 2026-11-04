# Pinning an answer

A pin keeps one answer to come back to. It is the only thing Talkthrough ever writes to disk about a question: everything else (the screenshot, your recording, the conversation) lives in memory and goes when you quit.

## How

- The tray menu: **Pin this answer**.
- By voice: say **"pin this"** (also "pin that", "pin it", "pin this answer"). It has to be the whole request, so a question like "how do I pin this tab?" is still a question. Pinning is not sent to the model.

Both pin what the current conversation has put on screen: the last question, the conversation so far and the scene. With nothing to pin the app says so.

## Where

A folder named `pins` in the app's data folder (`%APPDATA%\talkthrough\pins`). The tray menu has **Open the pins folder**. For checks, `--pins-dir <folder>` puts them somewhere else.

## What is kept

One JSON file per pin, named from the time and the question (`2026-11-04-220509-why-does-this-build-fail.json`):

```json
{
  "talkthrough": "pin",
  "v": 1,
  "pinnedAt": "2026-11-04T22:05:09.000Z",
  "question": "why does this build fail?",
  "thread": [{ "question": "what is this?", "said": ["This is a build log."] }],
  "scene": { "v": 1, "steps": [ ... ] }
}
```

`scene` is a [scene-language](scene-language.md) document as it was drawn, so the same marks can be played again by anything that plays scene files. `thread` holds each question and the lines spoken for it, not the drawing.

**The screenshot is not kept** unless you tick **Include the screenshot in pins** in the tray menu (the choice is remembered, and starts off). Then a clean PNG of the screen (without any pen stroke) is saved beside the pin with the same name, and the pin names it in a `screenshot` field.

Pins are plain files: delete them whenever you like. The app never reads them back and never sends them anywhere.
