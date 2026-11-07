# Tapered extrusion review

This is an opt-in extension of the existing declarative `extrude` shape, not an importer or executable modelling surface. It builds from one bounded simple outline with scalar taper and an offset at the positive-z end. It needs no extra dependency or external modeller.

## Native acceptance recipe

Run the final reviewed source in a supported desktop environment:

```sh
npm run typecheck
npm test
npm run build
node scripts/start.mjs --grab samples/scenes/tapered-extrusions.json --out frames/tapered-extrusions --steps 0:5,1:5 --size 1200x900 --software --grab-metadata
```

Inspect both frames and the same scene in interactive playback:

- The teal transition narrows toward its positive-z end, orange support shifts sideways, and blue concave fin keeps its notch open.
- Caps are opaque and closed. Sharp wall boundaries are coherent, with no internal diagonal outline or missing small end edges.
- Cut caps agree with the solid silhouette. Rotate the view to inspect rear and underside faces; the scene contains no overlapping fake cap meshes.
- Test parent transforms, tint/opacity, replacement and clearing. Dragging and ongoing narration must stay responsive.
- Compare an unchanged beveled extrusion from existing scenes: omission/null of both new fields must keep the old appearance.

CPU geometry tests check closure, oriented edges, finite unit normals, caps, exact volume for supported affine forms and lifecycle. They do not establish GPU/PBR appearance, real-time responsiveness or native visual acceptance. The Linux cloud executor has no X display, so successful build/tests there must not be described as a native screenshot pass.

## Cost and scope

At most 40 authored points produce 156 triangles and 468 unindexed vertices. Polygon validation and ear clipping are bounded; buffers and outlines are created once per object definition and reused by normal frame sync. No new model call, runtime execution, process, network request, animation wait or per-frame geometry work is added. Lean structured output adds two nullable fields only to extrude actions.

The sharp mode intentionally does not support bevels, through-holes, zero-scale tips, negative/mirrored taper, twist, or independent end outlines. Near numerical degeneracy is rejected conservatively. The largest endpoint rounding error, adjusted for taper, must be less than one eighth of the smallest authored vertex-to-nonincident-edge clearance. Emitted wall triangles must agree with each other and the intended wall normal to within about 0.081 degrees. These checks avoid accepting a folded or self-crossing wall merely because its two endpoint caps look valid. Existing transform precision limits still apply to very large scene transforms.
