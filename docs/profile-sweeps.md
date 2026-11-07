# Shaped profiles along curved paths

`add` with `shape: "sweep"` carries a simple polygon cross-section along a smooth open 3D path. It is useful for curved rails, angular cables, open-channel sections and solid shaped bands. Use `tube` for a circular or elliptical section, `extrude` for a straight plate, and `sweep` when the cross-section needs its own corners.

```json
{"op":"add","shape":"sweep","id":"rail","outline":[[-0.2,-0.1],[0.2,-0.1],[0.2,0.1],[-0.2,0.1]],"pts":[[-2,0,0],[0,0.4,0],[2,0.7,0.5]],"up":[0,1,0],"material":"metal","color":"blue"}
```

## Coordinates and orientation

- `outline` has 3–24 `[x,y]` points. Either winding is accepted. It must be a single simple polygon, with no holes, touching edges or repeated corners. An exact closing repeat and exact redundant straight boundary points are normalized for construction; they still count toward the input limit.
- `pts` has 2–16 distinct `[x,y,z]` controls. The open centripetal Catmull–Rom curve passes through them in order. Two controls form a straight sweep. Do not repeat its start to make a loop or reverse back over a neighbouring span.
- `up`, when supplied, is a nonzero initial section +y direction. Its component along the initial tangent is removed. It must not be parallel to that tangent. The default is +y, using +x only for a parallel vertical start. Give `up` explicitly when orientation matters, especially near a vertical start.
- The section's +x is `up × forward`; +y is `forward × +x`. Along a +z path, default up gives the familiar x/y section. Along the rest of the path, minimum-rotation transport carries the section rather than continually resetting it to world up.
- Outline coordinates are offsets from the path, not an automatically centered shape. Path and section coordinates are all finite in −100..100. `pos`, `rot`, `parent` and `explode` are ordinary local solid transforms.

The result has sharp section corners, smooth lengthwise lighting and flat end caps. Outlines trace profile corners and end perimeters, not internal triangulation diagonals. Named materials, colour, opacity, arrays, transforms and ordinary cutaways work as for other solids. `edges: false` removes outlines; low quality omits them normally.

## Bounds and limits

Low/mid/high quality use 4/8/12 subdivisions per path span. At the input limits, high quality has 181 rings, 8,736 vertices and 8,684 triangles. Construction and preflight are bounded and run only when accepting/building an object, not every animation frame.

Admission checks the actual Float32 mesh at all three quality tiers before consuming the object ID or replacement permission. Unsafe profile triangulation, collapsed triangles and local sampled folds are refused. Keep the section narrow relative to its bend radius; tight or numerically tiny geometry can reject conservatively.

This is not a global proof that distant portions never overlap, or that the continuous surface is regular between samples. It is not CAD, CSG, a hollow duct or a stitched sheet. A concave C/U-shaped polygon gives an open channel, but a hole enclosed within its cross-section is not supported. There is no bevel, variable section, twist control, closed path, animated path, reveal, flow stream or automatic endpoint attachment. Existing tube/extrude behavior is unchanged.

## Native appearance review

The portable tests inspect production Three.js meshes, not rendered pixels. Native 3D appearance remains unverified on the current environment because normal Electron cannot initialize WebGL2. No GPU/blocklist/sandbox bypass or alternate renderer is used.

On a compatible desktop, build the branch and use the app's normal sample/capture support with `samples/scenes/profile-sweeps.json`:

```sh
npm run build
npm start -- --grab samples/scenes/profile-sweeps.json --out /path/to/new-sweep-review
```

Use an isolated development profile as described in the capture documentation, and repeat at all supported quality tiers. Inspect front, reverse and oblique views for intact caps, open channel recesses, sharp corners without diagonal seams, smooth bands, correct cutaway, useful framing and material appearance. Portable tests and successful capture alone do not establish aesthetic acceptance or live-model authoring quality.
