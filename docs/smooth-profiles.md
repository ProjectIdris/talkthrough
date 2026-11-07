# Smooth loft and sweep surfaces

Use `smooth: true` on a `loft` or `sweep` whose polygon points describe a rounded section. It gives the wall continuous lighting rather than a highlight on every polygon face. This helps asymmetric rounded housings, section-changing solid transitions, shaped handles and curved rails.

Omitted, null and false retain the original shading and outlines. Existing scenes do not change. Both shapes keep their existing geometric restrictions, transforms, materials, arrays and cutaways.

## What changes

- Adjacent wall normals within 0.6 radians (about 34 degrees) blend across their shared section corner. A many-sided rounded outline reads smoothly; a rectangle or deliberate octagon stays angular.
- Flat cap normals and end perimeter lines stay separate. A shaped section can have both rounded stretches and sharp corners.
- Longitudinal lines disappear only where both ends of their segment are smoothed. If a loft changes from a circle to a thin ellipse, a corner that sharpens later in the transition keeps only that later outline.
- The builder uses known neighbouring vertices rather than approximate coordinate matches. Nearby walls and concave recesses cannot borrow one another's normals.
- A proposed blend that would point against an incident triangle keeps its original crease. This protects strongly warped or near-tangent accepted meshes.

Smoothing does not change positions, indices, triangle counts, bounds, cap shape or polygon silhouettes. It is not a bevel, extra tessellation, hollowing, or an exact curved CAD surface. Use enough authored points to describe the outline you need, within the existing 24-point limit. Higher quality still changes longitudinal sampling, not the section's point count. Low quality retains its normal no-outline policy.

The additional work happens at geometry creation. There are no new shader variants, render passes, dependencies or per-frame geometry rebuilds. Each loft's uninterrupted sharp corner run remains one outline line; partial runs can split it. At high quality, the maximum 24-corner loft therefore has at most 336 outline segments with smoothing, compared with 72 default segments; its solid vertex and triangle budgets do not change. Sweep smoothing only removes existing sampled outline segments.

## Native comparison

Play `samples/scenes/smooth-profiles.json`, or use the ordinary `--grab` workflow on a compatible desktop. Left and right use identical geometry and material parameters; only `smooth` and placement differ. The upper pair is an asymmetric loft, the lower pair a curved D-section sweep. Inspect the front, reverse and cutaway steps at the existing quality tiers.

Check the round highlights, flat caps, D-section's sharp back corners, unchanged silhouettes and section caps. Also inspect a nonuniformly parent-scaled version. A successful portable test is not proof of GPU appearance or live-model authoring quality. Record native evidence separately and do not use GPU, sandbox or security bypasses.
