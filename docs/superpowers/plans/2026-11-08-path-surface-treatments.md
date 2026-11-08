# Path Surface Treatments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this cohesive task. Steps use checkbox syntax for tracking.

**Goal:** Add one optional fibre treatment to path surfaces with bounded renderer work.
**Architecture:** Add a tube/connector-only enum to the scene spec; attach renderer-owned coordinates to existing ring geometry and a fixed antialiased shader to its physical surface. Rebuilt paths carry the same treatment without material churn.
**Tech Stack:** TypeScript, Three.js, Node test runner; no new dependencies.
**Spec:** docs/superpowers/specs/2026-11-08-path-surface-treatments-design.md

## Global Constraints
- No extra geometry, model shader/remote asset inputs, physics claims, or merge.
- Keep main c89033f2 as the base; test elastic compatibility separately.
- Preserve transparency, cuts, materials, low tier behavior and schema budget.

## Review Focus
- Small surfaces and grazing views must fade unresolved stripes rather than flicker.
- Caps and closed seams must not show discontinuities or stripe pinching.
- Rebuilt/attached connectors and reverse seeks must keep coordinates and material ownership.
- Glass and section surfaces must preserve alpha, depth and clipping semantics.
- Absent/null and unsupported inputs must not silently mutate an ID or existing output.

## Task 1: Add and verify path treatment
**Files:** src/scene/{types,spec,guide}.ts; src/overlay/{surface-treatment,scene3d,scene3d-flow}.ts; test/overlay-surface-treatment.test.ts; schemas, scene-language and paired sample.
**Interfaces:** `PathTreatment = 'fibres'`; `setPathSurfaceCoordinates(geometry, treatment)` adds an attribute only when requested; `applyPathTreatment(material, treatment)` installs a fixed shader without changing material state.
- [ ] Write schema/validation, real PanelScene, coordinate/rebuild, cap/seam, shader, filtering, glass/clipping and array regressions first.
- [ ] Run `node --test test/overlay-surface-treatment.test.ts` and verify feature-missing failures.
- [ ] Implement minimal bounded behavior, sample and docs; rebuild schemas.
- [ ] Run focused regression, full `npm test`, `npm run typecheck`, `npm run build`, `git diff --check`; report baseline failures without hiding them.
- [ ] Measure prompt/schema overhead and CPU sync cost; separately test integration with elastic connector work and send exact fixture/source for native QA.
- [ ] Commit; request independent whole-branch review; resolve important findings with failing regressions.
- [ ] Prepare reviewed draft publication with exact source hashes and explicit native/live-model limits; no merge.
