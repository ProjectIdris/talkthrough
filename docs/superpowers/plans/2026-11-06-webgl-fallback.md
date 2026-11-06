# WebGL fallback implementation plan

> For agentic workers: use the normal implementation and independent-review workflow.

**Goal:** Keep Canvas 2D and narration usable when the 3D renderer cannot initialize.
**Architecture:** Guard graphics initialization and derive a truthful displayed frame without unavailable model content. Reuse the existing notice surface without overriding application warnings.
**Tech stack:** TypeScript, Three.js, Electron, Node test runner, esbuild.
**Spec:** ../specs/2026-11-06-webgl-fallback-design.md

## Constraints and review focus
No dependency or security-setting changes. Preserve the scene timeline, voice preferences, IPC and schema. Review mixed 2D/3D scenes, pure text, streaming actions, unsupported model hits, capture metadata, notice dismissal/precedence and successive turns.

## Task: Isolate optional graphics from overlay startup
- [x] Add a portable regression that runs the actual overlay bundle with failed WebGL context creation, and observe startup fail before ready.
- [x] Add real-bundle frame/action fallback tests. Visible frames retain marks except model pins, and retain diagrams; unavailable objects/panels never report visible hits.
- [x] Guard renderer creation and setup; continue registration and ready without graphics. Preserve high-tier plain-render fallback.
- [x] Filter displayed frames and words-only classification; show the fallback warning without masking ordinary notices, clear/dismiss it normally, and keep camera receipts null without a drawn model.
- [x] Run new tests, the full portable suite, typecheck, build and diff checks.
- [x] Independently review the complete patch and run a real desktop smoke test without GPU/security overrides.
- [ ] Prepare a draft PR only after verification, with explicit environment limitations.

## Verification evidence

- Original regression: WebGLRenderer construction throws before `ready()` for null and throwing contexts.
- Nine portable real-bundle tests pass, covering startup, 2D marks and diagrams, captions, voice IPC, model-only text answers, notice lifecycle, missing 3D hit/camera metadata, and screenshot-backed placement in whole-scene and streamed paths.
- Both placement tests fail when the two panel-placement guards are removed from a temporary bundled copy, and pass with them retained.
- Full portable suite: 1,223 passed, 12 desktop/platform skips, zero failures. The test process excludes the synthetic speech fixture address 127.0.0.2 from proxy routing; no system setting changed.
- Typecheck, build and whitespace checks passed. Independent review's invisible-panel placement finding was corrected and re-reviewed without remaining blocking findings.
- Real cloud Electron smoke tests reached ready and captured 2D diagrams and mixed 2D/3D scenes with WebGL blocked. The mixed scene showed the unavailable-3D notice, omitted the model and emitted null camera metadata. This proves fallback survival, not full visual layout acceptance, real audio output or hardware 3D behavior.
