# Smooth Profile Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Smooth rounded loft and sweep walls on request while retaining sharp caps and deliberate corners.

**Architecture:** One bounded topology-aware overlay helper blends adjacent wall normals and builds the corresponding outline. Existing geometry preparation returns its section dimensions. Scene admission accepts one optional boolean without changing geometric validity.

**Tech Stack:** TypeScript, Three.js, Node test runner.

**Spec:** docs/superpowers/specs/2026-11-08-profile-smoothing-design.md

## Global Constraints

No dependencies, new render passes, Blender, security overrides, backend changes or merge. Preserve default behavior, positions, indices, topology, cap normals and current quality budgets. Work only at construction.

## Review Focus

- Compact or translated coordinates never merge distinct surface features.
- Reversed and concave sweep profiles keep correctly paired neighbouring walls.
- Strongly bent/warped meshes keep finite outward normals even when a blend is unsafe.
- Mixed sharp and rounded corners keep partial sharp outline segments.
- Replacement, arrays, clipping and repeated sync retain normal resource ownership.

### Task 1: Add profile smoothing and its authoring contract

**Files:** new `src/overlay/profile-normals.ts` and `test/overlay-profile-smoothing.test.ts`; modify the two scene mesh preparers, overlay builders, scene types/spec/guide, generated schemas and authoring docs. Add `samples/scenes/smooth-profiles.json`.

**Interfaces:** mesh preparation returns `sectionSize` and `wallRings`; `shadeProfileWalls(geometry, sectionSize, wallRings, straight)` mutates only wall normals and returns outline positions. Builders call it only for `smooth === true`.

- [x] Add admission, analytical normal, unchanged geometry/default, crease/cap and lifecycle regressions; see the feature assertions fail on main.
- [x] Implement bounded adjacent-wall normal blending with incident-face safety and crease-aware outlines. Add optional boolean to both shape variants and regenerate schemas.
- [x] Run focused tests until green, including compact/reversed/bent/warped fixtures and mixed corners; check finite unit outward normals and ordinary ownership.
- [x] Add authoring guidance and a native comparison sample with smooth and default versions of the same forms.
- [x] Run `npm run typecheck`, `npm run build`, and the entire `npm test` suite with the existing synthetic-loopback proxy exemption. Expected: zero failures, known platform/display skips only.
- [ ] Independently review and obtain native visual comparison when available; disclose any unrun stage. Commit, publish an authorised draft through hearthworksai, and verify the exact remote head and CI. Do not merge.
