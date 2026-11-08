# Profiled Elastic Connectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add general two-anchor connectors that can taper and visually bulge as their endpoints approach.
**Architecture:** Extend the existing connector schema and post-motion geometry update. Reuse tube profiles and deterministic endpoint resolution; reference length is authored, not captured from a first render.
**Tech Stack:** TypeScript, Three.js, Node tests, Electron.
**Spec:** docs/superpowers/specs/2026-11-08-elastic-connectors-design.md

## Global Constraints
- No new dependencies, model code execution, network behavior, Blender, merge or deployment.
- All deformation is illustrative, not physical simulation.
- Publish only a draft PR for review.

## Review Focus
- Non-uniform/transformed parents: attachment stays local to its object.
- Collapsed and huge spans: finite, bounded coordinates and normals.
- Reverse or first-frame seeks: identical geometry for identical frames.
- Wrapped belt conflict: reject unsupported new fields, retain legacy behavior.
- End visibility and draw fractions: retain existing lifecycle and stream behavior.

### Task 1: Extend and verify general connectors
**Files:** src/scene/types.ts, src/scene/spec.ts, src/scene/validate.ts, src/scene/schema.ts, test/support/json-schema.ts, src/overlay/scene3d-flow.ts, src/overlay/connector.ts; new test/overlay-elastic-connector.test.ts and test/scene-elastic-connector.test.ts; docs/scene-language.md, src/scene/guide.ts, generated docs/*.schema.json, samples/scenes/elastic-connectors.json.
**Interfaces:** AddConnector gains fromPoint?: Vec3, toPoint?: Vec3, swell?: Vec2[], restLength?: number. Endpoint resolution consumes the local points; connector update computes local path length before the bounded radius adjustment.
- [ ] Write behavioral tests for accepted and bounded fields, wrapped conflicts, transformed point attachment, smooth profile and 4→1 length bulge (radius doubles), slack path length, parent scaling, collapsed/long spans and repeated/reverse seeks.
- [ ] Run new tests, confirming failures reflect missing behavior.
- [ ] Implement schema/types, validation and renderer behavior; keep old paths unchanged when fields are absent.
- [ ] Run targeted tests, typecheck, full npm test and build. Expected: no failures; disclose platform skips.
- [ ] Document exact semantics and a sample contrasting muscle and generic soft cord. Regenerate schemas and rerun verification.
- [ ] Measure bounded CPU update cost; native Electron QA at extended, flexed and returned states, on an isolated desktop source copy.
- [ ] Obtain a fresh whole-branch review; address important findings with regression tests. Commit and open a draft PR through the authorized fork, with test and QA evidence.

## Verification findings
The Windows strict-schema transport was already close to its limit. Sharing action contracts that differ only by operation enum restores headroom without omitting fields. Expanded-schema tests compare the exact accepted structures after splitting operation enums. Stream beads clear the widest current connector profile to remain visible during contraction.
