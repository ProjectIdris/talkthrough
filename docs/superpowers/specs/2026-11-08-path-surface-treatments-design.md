# Path surface treatments

## Intent and scope
Add optional longitudinal fibre detail to existing tubes and connectors, without asking the scene-authoring model to describe each strand. A treatment supplements the named material and finish; it is not a new solid, tissue simulation, or arbitrary shader interface.

## Chosen approach
Under the user's instruction to choose the best approach and continue improvements, use one optional enum field, `treatment: "fibres"`, on tube and connector adds. Omit/null preserves today's rendering. Other shapes and animated style actions do not accept it. The initial implementation fixes density/strength rather than adding more model controls.

Alternatives considered: explicit strand geometry adds topology and draw overhead; remote textures add assets/latency and UV authoring; world-space stripes slide across bending shapes. Renderer-owned path coordinates on existing vertices avoid these costs. This is an implementation choice, not a user-specified API spelling.

## Rendering
Generate a small surface coordinate attribute only for treated geometry from its existing ring topology: circumferential fraction, normalized path station, and cap fade. Each ring carries the same circumferential coordinate through bends and radius changes. Rounded tips fade the detail to avoid a pinched stripe singularity. Near an ambiguous initial sweep direction, fade the treatment smoothly rather than exposing rapid frame rotation; leave positions and normals unchanged. Closed tubes retain matching periodic seams. Rebuild paths regenerate the attribute; surface materials remain reusable.

A bounded deterministic shader applies subtle longitudinal color and roughness variation. Derivative filtering removes unresolved frequencies at small projected sizes, on all tiers. Keep existing geometry, normals, silhouette, alpha/depth state, clipping, named material recipes, highlights and separate section hatching unchanged. No extra meshes, textures, network calls, shader inputs from the model, or new dependencies.

## Constraints and evidence
Base this draft on merged main c89033f2, not the unmerged elastic connector branch. Test compatibility separately with that branch's rest-length/profile behavior and do not duplicate its commits. Preserve schema command-line budgets and the three-second response goal; report measured local overhead separately from unmeasured live-model/native performance.

Automated checks cover validation/schema, topology/coordinate seams and cap fade, rebuilds/reverse seeks, glass and clipping, arrays, no-treatment compatibility, and resource ownership. Native QA must compile and inspect low/mid/high tier fixtures, small-size filtering, bends and contraction. A demonstration is not physical or visual validation; mark anything not actually checked as pending. No merge; publish only a reviewed draft through the authorized identity.
