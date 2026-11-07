# Filtered section hatching

## Intent
Improve the readability of cut surfaces when a model is small on screen or viewed obliquely. The existing world-space hatch is sampled at one point per fragment and can alias into dark bands. This is a general rendering correction, under the standing request to continue improving rendered pieces.

## Scope and approach
Keep the existing 0.16 world-unit period, orientation, smooth stripe shape and colour strength. Average that periodic stripe over its screen-space footprint using derivatives. Preserve the stripe mean when it becomes smaller than a pixel. Apply the same shader to stencil cut caps and authored section surfaces.

A larger fixed stripe size would still alias at another zoom and change every model. Simply fading the stripes would lose their average tone. Analytical integration is the selected implementation choice: bounded fragment arithmetic, no textures, geometry, rendering passes or per-frame JavaScript work.

## Constraints
No new dependencies, scene fields, model calls, Blender workflow, security overrides or merges. Existing stencil ownership, clipping, opacity and material recipes stay unchanged. Native GPU review must distinguish verified numerical filtering from actual whole-scene appearance. This is not a frame-rate improvement claim.

## Acceptance
The emitted shader preserves magnified stripes and averages dense stripes without non-finite values, including negative phase. Existing material and cutaway lifecycle tests pass. A native GPU probe executes the actual shader patch against a numerical reference, and native before/after captures cover close, dense and grazing views where available. Costs and limits are recorded explicitly.
