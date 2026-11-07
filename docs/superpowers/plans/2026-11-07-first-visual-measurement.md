# Measure a streamed piece without inventing model latency

Continue the offline catalogue experiment at public PR27 head 35e5cf41. This is a removable development harness, not app instrumentation or a model-route change.

The existing question report's first piece can be narration, and the renderer's first-mark event observes scene state rather than proving new pixels. A fake-clock player benchmark alone cannot answer the rendered-piece question. The chosen bounded alternative is a real, sandboxed Electron overlay with a hand-written 2D marker and a pixel oracle. No live-model run, new model tools, credentials, screen capture or private source is involved.

1. Add failing portable tests for the real streaming parser/validator bridge and the marker-pixel oracle. Distinguish narration, raw actions, validated actions, complete steps and actual marker pixels. Reject incomplete input and malformed image buffers.
2. Add a fresh-process offline harness. Start the monotonic request clock before reading/deserializing/indexing the generated catalogue file; then time lookup/encoding, fixture parsing, validated action delivery and the first offscreen paint containing the marker. The app and model adapters stay untouched.
3. Use the real overlay/preload, an isolated temporary profile and in-memory session, sandbox/context isolation, blocked network/permissions/navigation and no speech. Confirm an empty baseline and a narration/invalid-action control before the measured fixture. Hold the step's closing bytes until after the marker paint, proving piece streaming rather than whole-answer playback.
4. Report runtime, fixture provenance, cold-process versus OS-cache limits, all unavailable live-model fields as null, and the distinction between offscreen paint delivery and physical display. Never calculate a three-second target verdict from this offline run.
5. Run the focused tests, portable suite, typecheck/build, native harness if supported and independent review. Preserve existing branches and report the exact public source revision. Recommend an update to PR27 rather than a duplicate catalogue PR.

Review focus: narration/chrome must not qualify as a drawing; invalid actions must not qualify as validated output; stale pixels must not qualify; missing paints must fail explicitly; no network or real profile may be used. Renderer startup is reported separately, not silently included in request latency. File-read results are not disk-cold guarantees.
