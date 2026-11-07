# Solid surfaces beneath glass

The renderer puts every named surface in the transparent queue, even at full opacity. That queue sorts by render order and bounding-sphere center depth rather than per-fragment depth. In production, sphere order depends on authored size: a small sphere enlarged to the same world size as another can therefore lose its glass cover. With equal explicit order, a large opaque piece crossing a glass cover can also erase the cover over its rear portion when its center sorts toward the camera.

## Chosen approach

Use the renderer's ordinary opaque pass for fully opaque surfaces, then blend glass and actual fades over their depth. Update the shader variant when transparency changes because Three's opaque shader forces alpha to one. Apply the same effective-opacity policy to connector and attached-path endpoint fades.

This is a rendering correction under the standing request to continue general-purpose piece-quality improvements. Keep the existing Three.js renderer and named materials. No new scene fields, dependencies, geometry, render passes, model calls, or Blender workflow.

## Alternatives and boundaries

- Manually setting object render order would depend on each arrangement and fail when parts intersect or the camera moves.
- Order-independent transparency would address broader overlapping-translucent-object limitations, but needs additional buffers/passes and is outside this small correction.
- Classifying effective opacity uses the existing depth buffer and solves opaque-versus-glass occlusion. Partly transparent objects still use the existing object-level sort. Multiple overlapping glass shells are not made order-independent.

Preserve recipe colours, roughness, lighting, glass opacity, geometry, clipping and shadow settings. Sub-full opacity must blend and not write depth. Stable fully opaque frames should not invalidate their shaders. New variants can compile at actual fade transitions; no performance improvement is claimed.

## Evidence

Portable regressions cover all named solid recipes, fades near full opacity, glass and endpoint-held paths. A native GPU probe compares identical world geometry with different explicit render priorities and checks glass coverage behind the crossing and no coverage in front. The native probe also renders actual PanelScene spheres with equivalent authored size/scale decompositions and compares warmed fade/return shaders against fresh materials. An authored sample includes these spheres plus paired extrude bars for view changes, cut faces and fade/return smoke coverage. The bars already sort before glass in the baseline; they are not a RED reproduction. Full portable tests, typecheck/build and independent review are required. Native checks are reported separately and do not imply a full Windows pass.
