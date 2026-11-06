# Coherent flow reflow implementation plan

> For agentic workers: implement with test-first checks and independent whole-change review.

**Goal:** Avoid mixing old node positions with a new flow routing arrangement.
**Architecture:** Extend the existing node easing identity with direction and wrapped-grid dimensions; retain ordinary easing and cleanup.
**Tech Stack:** TypeScript, Canvas 2D, Electron, Node test runner.
**Spec:** ../specs/2026-11-06-flow-routing-transition-design.md

## Constraints and review focus
Preserve same-arrangement easing and all edge/label visibility. Cover reverse transitions, viewport sizes, a changed wrapped-row width with unchanged row count, obsolete-cache cleanup, and the unchanged static rendering behavior. No routing redesign or unrelated renderer changes.

## Task: Keep node positions coherent with routing
- [x] Reproduce the captured transition using actual rounded rectangles emitted by DiagramPainter. Observe adding/removing return-edge tests fail at frame 1 before implementation.
- [x] Add direction and row count to the node easing key. Retain the existing movement test.
- [x] Reproduce same-row-count, changed-width wrapping with six to seven nodes. Observe failure, then add places per wrapped row to the key.
- [x] Cover three viewport sizes and test actual painted node/label bounds and sampled arrow paths across 45 frames.
- [x] Run full portable suite, typecheck, build and diff checks; independently review the patch and inspect real Electron captures.
- [ ] Prepare the draft PR under hearthworksai. Do not merge or deploy.
