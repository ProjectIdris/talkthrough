# Useful 3D Candidate Timing Implementation Plan

> **For agentic workers:** Use the approved native implementation workflow and independent review.

**Goal:** Measure an offline first substantial 3D candidate without confusing it with live useful output.
**Architecture:** Extend first-visual CLI and Electron harness; isolate fixture and bitmap inspection in first-useful-3d.ts.
**Tech Stack:** Existing Node, TypeScript, Electron and Three.js only.
**Spec:** ../specs/2026-11-08-useful-3d-timing-design.md

## Global Constraints
- No production changes, copied Vork code, model/network calls, security bypass or merge.
- Preserve 2D output contract and null live-target verdict.

## Review Focus
- Unsupported WebGL must remain unavailable, not a fast pass.
- One part, a few pixels, or narration cannot satisfy the candidate gate.
- Controls must be observed and empty before request timing.
- An incomplete step must produce the candidate before closing.
- Native diagnostics are not semantic quality acceptance or physical display timing.

## Task 1: Fixture and pixel oracle
- [x] Add failing tests for real streamed validation, paired coloured area/extent, tiny/transparent/chrome pixels and malformed buffers.
- [x] Implement USEFUL_3D_ACTIONS and inspectUseful3dPixels in scripts/prototypes/first-useful-3d.ts.
- [x] Run unit tests and typecheck.

## Task 2: Native timing mode
- [x] Add integration test invoking --fixture 3d and checking measured or explicitly unavailable evidence.
- [x] Extend benchmark-first-visual.ts/first-visual-electron.ts without changing default 2D behavior.
- [x] Run native tests, full suite, build, typecheck and independent review. Record actual native limits and exact tested source.
