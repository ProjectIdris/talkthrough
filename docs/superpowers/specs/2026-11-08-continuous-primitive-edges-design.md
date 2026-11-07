# Continuous primitive edges

## Intent and scope

Improve the rendered pieces without adding modelling knobs: a smooth ellipsoid, rounded cylinder or full torus must not acquire dark tessellation lines because it is thin, compact or elongated. Keep mesh geometry, shading, material, silhouette, cut caps, quality budgets and authored transforms unchanged. Sharp boxes, cone bases, planes, authored profiles and part-kit details retain their current edge behavior. No Blender, dependency, backend, security or provider change.

## Evidence and approach

On main f2003e0, high-tier edge extraction produces 104 line segments on a [3, 0.1, 2] ellipsoid and 72 on a compact [0.01, 0.02, 0.03] rounded cylinder. These have no authored crease. Facet-angle thresholding and fixed-coordinate welding describe the triangulation, not the underlying smooth surface.

Raising the global angle threshold would also erase real creases. Replacing all edge extraction with a normal/topology algorithm would affect unrelated open and authored meshes. Instead, use the scene primitive's known semantics at its existing mesh/outline selection point: omit crease objects for sphere, cylinder and torus, as already done for blobs. This deliberately does not create silhouette outlines. The rounded-box exemption remains unchanged.

This is a bounded implementation choice under the standing request to continue general render-quality improvements. It does not extend to partial or deliberately faceted geometry produced by other builders.

## Acceptance

Real PanelScene regressions must show no line objects for these three smooth primitives at all quality tiers and sizes, with omitted/true/false edges. Ordinary meshes retain identical geometry buffers and materials. Existing sharp/boundary outlines remain byte-identical. Nested scale, clipping, repeated sync, replacement, sharing and disposal remain correct. A paired authored sample compares edges:false controls against default edges through oblique, reverse and cutaway states. Portable suite, typecheck, build, independent review and native visual QA are recorded separately.
