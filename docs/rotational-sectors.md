# Closed rotational sectors

A lathe with `sweep` revolves a closed cross-section through part of a circle. One ordinary scene object can describe a thick open vessel, a curved bracket, an annular segment or a tapered housing, including the inner wall and the two closed radial ends.

```json
{"op":"add","shape":"lathe","id":"ring","profile":[[1,-0.4],[2,-0.4],[2,0.4],[1,0.4]],"sweep":240,"rot":[0,60,0],"color":"teal","material":"metal"}
```

The profile is an implicitly closed polygon in `[radius,y]`, rather than the open curve used by an ordinary full lathe. It may contain 3–40 authored points including one optional exact closing repeat. Radius is 0–100 and y is −100–100. Either winding works. Exact redundant collinear points are removed. Do not draw crossing, touching or overlapping boundaries. Axis contact is supported. Negative radii, unsafe thin corners, collapsed Float32 geometry and invalid profiles are rejected rather than repaired.

`sweep` is 1–359 degrees, starting at +z and moving towards +x about +y. Use the ordinary object `rot` to move the opening. Omit `sweep` for the unchanged full-lathe behavior. There is no new start-angle field or animated sweep. Replacing the object can change its profile or angle.

`sides` stays the full-circle resolution, 3–64, defaulting to the current quality tier (20/36/64). A sector uses a proportional number of segments with at most 90 degrees per segment. At 8 sides or fewer the walls are faceted. Otherwise smooth walls use analytic rotational normals and retain sharp profile corners. Radial caps stay flat. Crease outlines use exact surface adjacency so compact shapes do not lose their edges to fixed coordinate bins.

The primitive uses the ordinary parent, transform, material, tint, array, cut, replacement and disposal paths. Construction happens once per object, not per animation frame. At the maximum 40-point profile and 64 segments it has fewer than 5,200 triangles, plus optional outlines. It makes no model or network call, starts no extra render pass and adds no dependency.

## Native review

`samples/scenes/rotational-sectors.json` is an original hand-written three-form scene, not model-output quality evidence.

```sh
npm start -- --grab samples/scenes/rotational-sectors.json --out frames/rotational-sectors --steps 0:3,1:3,2:3 --size 1200x800 --software --layout-seeks 15 --grab-metadata
```

Inspect actual 3D pixels and metadata for all three views. Check that the vessel's inner floor and wall are visible through its missing angular sector, the bracket's concave channel and radial end faces are closed, and the tapered housing has an open angular gap. The final step adds an ordinary horizontal cut with a cap. Look for flicker, false diagonal lines, flipped shading and holes at the radial seams. Confirm that the model can still be turned and fitted by the normal overlay controls.

A WebGL fallback notice or empty frame does not establish visual acceptance. CPU manifold/normal/ray tests establish geometry properties, not GPU, material, post-processing, Windows desktop or live generated-answer appearance. Large parent translations and extreme transforms remain subject to floating-point limits. The numerical input checks are conservative and may reject thin profiles that a more sophisticated CAD kernel could represent. This is a bounded explanatory primitive, not a CAD Boolean engine.
