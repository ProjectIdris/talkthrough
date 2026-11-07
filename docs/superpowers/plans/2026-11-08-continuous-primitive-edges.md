# Continuous primitive edges implementation plan

> **For agentic workers:** Use superpowers:executing-plans for this bounded repair.

**Goal:** Prevent false dark creases on smooth sphere, cylinder and torus primitives.
**Architecture:** At PanelScene's existing primitive mesh creation point, do not request crease extraction for these known continuous surfaces. All other paths remain unchanged.
**Tech stack:** TypeScript, Three.js, Node test runner, Electron.
**Spec:** ../specs/2026-11-08-continuous-primitive-edges-design.md

## Constraints and review focus

Preserve sharp and open boundaries, all mesh buffers, material/cut semantics, resource ownership, and other builders including low-sided lathes. No new schema fields or dependencies. No merge or deployment. Native review uses unchanged capture thresholds and explicit prerequisites, with no security or focus overrides.

## Task: Suppress false primitive creases

- [x] Run the untouched main portable suite and retain its baseline.
- [x] Add real PanelScene tests for the three smooth primitive families, dimensions/scales, edges options, legacy outline controls, cuts, cache reuse and disposal. Observe the three smooth-family failures before implementation.
- [x] Change only primitive edge selection in src/overlay/scene3d.ts. Re-run regressions.
- [x] Add samples/scenes/continuous-surfaces.json with reference/default pairs and forward/reverse/cutaway views. Update the edge description in docs/scene-language.md.
- [x] Run focused and full portable suites, typecheck, build and whitespace check. Independently review and quantify unchanged mesh buffers.
- [ ] Arrange native baseline/candidate image review and prepare exact draft-PR handoff through hearthworksai. Native results remain separate from portable evidence.

## Verification record

Main baseline: 1,812 passed / 16 skipped. Five new regressions failed before the correction. Final portable suite: 1,819 passed / 16 skipped; 37 focused tests, typecheck, build and whitespace checks pass. The first candidate full run exposed six legacy sharing fixtures that depended on empty sphere/cylinder outlines. Those fixtures now use sharp boxes/cones with every sharing assertion retained and an additional nonempty-outline assertion. The product implementation did not change.

Independent review passes 56 relevant tests and a differential against main: 270 smooth primitive cases (135 oblique-cut cases with rotated/nonuniform ancestors), 21 sharp/boundary/profile controls and 63 part-kit cases. Mesh buffers, materials, transforms, shadows and cut helpers remain identical. No blocking findings. Minor deferred: assert absence of the LineSegments object, not just zero segments, in every size/tier case; the separate lifecycle and transform regressions already assert no object on their exercised cases.

Native baseline/candidate visual verification is pending separately. No GPU, Windows visual or performance acceptance is claimed by the portable results.
