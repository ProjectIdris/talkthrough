# Filtered Section Hatching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep cut-face hatching readable as its projected stripe spacing changes.
**Architecture:** Integrate the existing smooth periodic stripe over its derivative footprint in the shared material shader. Keep all cutaway ownership and geometry untouched.
**Tech Stack:** Existing TypeScript, Three.js and Electron; no added packages.
**Spec:** docs/superpowers/specs/2026-11-08-filtered-sections-design.md

## Global Constraints
No new dependencies, scene fields, model calls, Blender workflow, security overrides or merges.

## Review Focus
- Negative phases must retain the same periodic stripe.
- Tiny footprints must preserve the current stripe appearance without cancellation noise.
- Multiple periods in one pixel must average to the 0.24 dark coverage.
- Both stencil caps and authored section materials must receive the shader.
- Ordinary surfaces and clipping/stencil lifetime must remain unchanged.

## Task 1: Filter and verify the shared section shader
- [ ] Add portable material-injection tests that fail on the unfiltered baseline and a native probe that executes the emitted shader.
- [ ] Record failing regressions before implementation.
- [ ] Implement a bounded analytical filter in src/overlay/materials.ts, with the current period, shape and strength.
- [ ] Add a scale/grazing sample and its validation test. Document costs and limits in overlay notes.
- [ ] Run focused tests, complete tests, typecheck, build and whitespace checks.
- [ ] Request independent code review and native before/after review, recording unavailable stages honestly.
- [ ] Commit the change and prepare the exact tested package for draft publication through hearthworksai.
