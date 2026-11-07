# Fixed-frame camera implementation plan

> **For agentic workers:** Use superpowers:executing-plans for this bounded repair.

**Goal:** Make fixed captures independent of previous camera-fit state while preserving live and clip easing.

**Architecture:** Optional `cameraFit: 'instant'` on internal seek IPC selects the existing unclocked PanelScene fit. Still callers opt in; the default remains clocked.

**Tech stack:** TypeScript, Three.js, Electron, Node test runner.

**Spec:** ../specs/2026-11-08-fixed-frame-camera-design.md

## Constraints and review focus

Keep the label/pen clock, authored view, thresholds, security settings and default clip semantics unchanged. Exercise the first draw and later RAF draw, scale growth and return, absent metadata, and unflagged seeks. Preserve PR47 compatibility.

## Task: Fixed-camera still capture

- [x] Add a native regression to test/main-grab.test.ts for 1× → 30× → angled → 1× with unchanged seek counts. Observe camera-drift failure before production changes.
- [x] Add optional cameraFit field in src/shared/ipc.ts and honor it only in the corresponding draw in src/overlay/overlay.ts.
- [x] Opt fixed captures into that field in src/main/grab.ts and the still helper in scripts/overlay-frames.cjs. Leave clip paths unchanged. Record mode in grab metadata and document semantics.
- [x] Run focused, full suite, typecheck and build. Keep native skips explicit.
- [x] Validate the unchanged native regression, all four sequential section states across tiers, and a no-flag control. Inspect pixels and preserve baseline evidence.
- [x] Independently review the whole change, verify compatibility, and prepare a draft-only publication package.

## Verification record

The final native regression failed before the repair and passed after it. Eight focused Windows tests passed with zero skips. All 12 sequential instant-fit sample captures passed unchanged diagnostics; camera metadata exactly matched their cold-state references. The unflagged control retained all four original cameras and its expected two transient-fit diagnostics. Portable source suite: 1,815 passed, 17 skips. PR47/PR49 compatibility tree: 1,822 passed, 19 skips. Typechecks/builds and independent review passed. No branch integration, publication or merge performed by the implementation worker.
