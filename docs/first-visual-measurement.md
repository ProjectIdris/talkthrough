# First rendered piece: offline measurement

This development harness extends the [catalogue experiment](component-catalogue-prototype.md) without changing the app, model adapters, prompt, schema or renderer. It measures real local work and actual offscreen 2D pixels. **It does not measure a model, predict model latency, or establish the roughly three-second live target.**

## Run

Use Node 24+ and an already installed Electron executable:

```sh
node scripts/prototypes/benchmark-first-visual.ts --entries 21
node scripts/prototypes/benchmark-first-visual.ts --entries 10000 --out ./first-visual-result
node --test test/first-visual-probe.test.ts test/first-visual-native.test.ts
```

`--entries` accepts 21, 1000 or 10000. Larger catalogues repeat the same 21 public cards under different IDs; they are not new useful components. Each invocation starts a fresh Electron process and index. No cache flush is attempted: the generated file was just written, so this is **not a disk-cold benchmark**. Repeated invocations measure run-to-run variation, not independent real-world workloads.

The runner builds the checkout's real overlay and preload into a private temporary directory. It uses a temporary, guarded Electron profile, an in-memory browser session, the normal renderer sandbox and context isolation, blocked network/permissions/navigation, and silent speech. Linux can use headless Ozone with a 640×480 virtual screen; no sandbox or GPU-security bypass is used. It opens no model, microphone, real-screen capture or credentials. No installation/download is attempted. Missing Electron or unavailable rendering fails explicitly.

By default, only the report is printed. `--out` also saves `result.json` and `first-paint.png` containing only the hand-written fixture. Temporary files are removed after the child exits.

## What the clock means

All reported request offsets use one monotonic clock in the Electron main process. Renderer startup and a negative control run **before** that clock, and have their own `startupAndControlMs` field. The request clock starts immediately before:

1. Reading the generated catalogue JSON file.
2. UTF-8 decoding and parsing it.
3. Building the catalogue index.
4. Looking up `mechanical` and encoding the bounded response.
5. Feeding a fixed, hand-written scene prefix in 11-character chunks into the real streaming parser and live validator.
6. Sending the accepted box action through the real preload to the real overlay.
7. Receiving the first offscreen compositor paint with at least 12 sufficiently opaque, bright magenta pixels in the fixture's expected region.

The fixture's closing step bytes are deliberately withheld until that paint arrives. This proves an action renders while its step is still incomplete. The delay is a test control, **not a simulated model generation delay**. Catalogue results are measured and encoded but do not determine the fixed marker or alter a prompt.

`firstPieceMs` can be narration; `firstActionMs` is still raw data. `firstValidatedActionMs` and `firstSentActionMs` describe validation and IPC submission. Only `firstQualifyingPaintReceiptMs` requires pixel evidence. It includes compositor/readback/IPC delivery overhead, a 60 Hz frame-rate cap and normal stroke build-in animation. The timestamp is taken at paint-event receipt, before scanning that image. It is not the exact first nonzero pixel, a hardware presentation timestamp, or the first useful/recognisable mechanism.

The oracle is intentionally narrow: a new magenta box on a fresh 640×480 scene. It checks that narration and an invalid action produce no matching pixels, then checks the cleared baseline. UI paint activity, a scene object count or the app's first-mark event alone cannot pass it. The saved evidence may be only a short initial stroke, since this measures the beginning of drawing, not a completed box. It does not test retained-scene changes, general visibility, offscreen geometry or 3D/WebGL.

The report keeps model first-token/first-output fields and the three-second target verdict `null`. Never add this fixture duration to an assumed model duration or subtract it from three seconds to claim a proven budget. No first-word/audio timing, transcription, screenshot preparation, schema processing, prompt caching, provider queueing or model authoring is measured.

## Next live measurement

On an authorised working model route, measure the real request before any request-specific catalogue work, tag the request/turn, and correlate raw model output, first accepted drawable action and actual new render evidence. Keep provider/model/cache state and 2D versus 3D cases separate. Measure repeat cold/warm runs and useful-scene quality with the same prompts and settings. Respect the existing data-only adapter contract and diagnostic privacy defaults. This harness is not that integration and does not enable a blocked model route.

The app's existing release-based `firstPieceMs` and `firstMarkMs` remain unchanged. The former can precede any drawing; the latter currently tests frame state and can include retained content or objects that fail to draw. They should not be silently re-labelled as this pixel-confirmed endpoint.
