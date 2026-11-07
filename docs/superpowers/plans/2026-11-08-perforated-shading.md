# Perforated extrusion shading implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Smooth the inner and outer curved walls of existing through-hole extrusions without softening their cap boundaries or deliberate corners.

**Architecture:** Reuse `shadeExtrusion` after the existing hole triangulation, cap-edge splitting and centering. Its exact-coordinate joins and angle weighting already handle compact solid profiles. No new fields, geometry, dependencies or rendering passes are needed.

**Tech Stack:** TypeScript, Three.js, Node's test runner.

**Spec:** The scope and invariants below are the complete design for this small continuation of the existing extrusion-shading work.

## Scope and choices

The merged renderer corrects solid extrusion normals but leaves the through-hole branch flat. Reusing the shared normal helper keeps both paths consistent. A separate hole-only normal implementation would duplicate that logic; smoothing all normals without a crease test would round cap and polygon boundaries. Neither is needed.

- Preserve positions, UVs, triangles, groups, winding, reveal order and cut behavior.
- Keep the existing 0.6-radian crease rule and flat caps.
- Preserve distinct compact inner/outer walls and independent material/geometry ownership.
- Do not add bevels around holes, alter authored silhouettes, or repair collapsed geometry.
- Use the existing general extrusion vocabulary and offline authored samples, never model execution or Blender.

## Review focus

- Inward-facing hole normals must point into the opening, including reversed and explicitly closed rings.
- Narrow annuli must not merge nearby inner and outer walls.
- Multiple openings and cap-edge splits must retain flat caps and manifold geometry.
- Nonuniform parent transforms and repeated scene sync must preserve corrected normals and ownership.
- Rectangular and low-sided openings must retain intentional hard corners.

## Task: Correct curved through-hole walls

- [x] Add independent analytic radial-normal tests for inner/outer rings, winding, scale and maximum-point profiles, and watch them fail on merged main.
- [x] Apply `shadeExtrusion` to the hole branch after centering; rerun the new and existing extrusion tests.
- [x] Add a real PanelScene transform/cut/replacement test and an authored hollow-form sample; update extrusion shading documentation.
- [x] Run typecheck, the complete portable suite, build and whitespace checks, and obtain independent review.
- [ ] Complete native before/after review through the existing desktop QA workflow.
- [x] Commit the tested change and prepare the exact patch, bundle and verification package.
- [ ] Publish a draft PR through the authorized fork after native review. Do not merge.
