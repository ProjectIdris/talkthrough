# Coherent flow reflow

## Intent and evidence
The `diagram-flow.json` example is readable both as a wrapped chain and as a settled vertical loop. The transition is not: DiagramPainter interpolates old node rectangles while immediately applying the new routing direction and row assignment. The resulting arrows and labels cross nodes. A second reproduction adds a seventh node to a six-node chain: both layouts have three rows, but their row widths differ and nodes cross during interpolation.

## Approach
Use the routing arrangement (direction, row count, and places per wrapped row) in node easing identities. When that arrangement changes, all nodes take their new positions together, so routes and boxes describe the same layout. The surrounding card still eases. Same-arrangement movement keeps existing easing, and normal unused-key cleanup discards obsolete node positions.

This is an implementation choice within the ongoing visual-quality improvement work. A globally collision-free animated graph morph would be a larger router redesign. Hiding labels while nodes move would lose useful information and would not repair crossing arrows. Atomic reflow is the bounded repair selected here, trading a brief layout jump for legibility.

## Scope
No schema, layout algorithm, dependencies, settings, capture timing, WebGL or provider changes. This is not a general guarantee against every graph collision, extreme density, changing branch order or crossing edges in a settled layout.

## Acceptance
Observe paint geometry across the chain/loop transition in both directions at three viewport sizes, and the wrapped-row-width change. Nodes, labels and arrow paths must remain present and separate in these fixtures. Existing same-arrangement easing tests must pass. Inspect real Electron Canvas 2D captures before and after; preserve full-suite, typecheck and build results. Publish only a draft PR for review, without merge or deployment.
