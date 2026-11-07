# Solid surface occlusion implementation plan

> **For agentic workers:** Use the native implementation workflow with an independent whole-change review. Checkboxes track the test-first work.

**Goal:** Keep glass visibly in front of opaque surfaces behind it regardless of object render priority.

**Architecture:** Classify named surfaces from effective opacity, including endpoint-held path opacity. Reuse the existing opaque and transparent queues and depth buffer.

**Tech Stack:** TypeScript, Three.js r187, Electron, Node test runner.

**Spec:** ../specs/2026-11-08-surface-occlusion-design.md

## Constraints and review focus

- No dependency, scene-language or render-pass additions; no merge/deployment.
- Check glass, near-opaque fades, repeated sync, endpoint-held paths, instanced parts and cut caps.
- Inspect shader invalidation cost and real native pixels; distinguish raw material checks from high-tier finishing and full overlay acceptance.

## One independently reviewable correction

- [x] Add failing material queue/depth regressions in test/overlay-surface-occlusion.test.ts; preserve the RED output.
- [x] Add a native pixel regression and isolated synthetic renderer support. It compares unchanged world geometry with different explicit render priorities, plus rear/front glass coverage.
- [x] Implement effective-opacity handling in src/overlay/materials.ts and the two endpoint-fade paths in src/overlay/scene3d-flow.ts, with deferred endpoint classification in src/overlay/scene3d.ts.
- [x] Run focused checks and the full portable suite, typecheck and build.
- [x] Validate the authored comparison scene, review shader lifecycle, and fix material findings with regressions.
- [ ] Run the unchanged native RED/GREEN probe and real overlay checks when the existing desktop route is available.
- [ ] Rerun final required checks; commit exact source; provide a draft publication package and explicit limits.
