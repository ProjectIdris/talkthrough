# Curved sheets from control points

`add` with `shape: "patch"` creates an open bicubic Bézier sheet from exactly 16 three-dimensional controls. This is a general modelling tool for shaped panels, domed covers, saddle membranes and canopies. It uses the existing native Three.js renderer, ordinary named materials, tint, opacity, parent transforms, motion, arrays, replacement and replay.

## Authoring

Write `pts` as four rows of four points, flattened into one list. Within each row, u runs from left to right. The rows advance v. The surface is the tensor product of the cubic Bézier curves in those directions. Four corner controls lie on the sheet; all the other controls pull its shape and are **not** interpolated points. A regular x/y grid with varying z is a useful starting point, then use `rot` or a parent group to orient it.

For a 3 by 3 domed cover with a flat boundary:

```json
{
  "op": "add", "shape": "patch", "id": "cover",
  "pts": [
    [-1.5,-1.5,0], [-0.5,-1.5,0], [0.5,-1.5,0], [1.5,-1.5,0],
    [-1.5,-0.5,0], [-0.5,-0.5,2], [0.5,-0.5,2], [1.5,-0.5,0],
    [-1.5,0.5,0], [-0.5,0.5,2], [0.5,0.5,2], [1.5,0.5,0],
    [-1.5,1.5,0], [-0.5,1.5,0], [0.5,1.5,0], [1.5,1.5,0]
  ],
  "material": "metal", "color": "#4b79b0"
}
```

The centre rises to 1.125 units, not 2: the interior controls pull the curve toward themselves. A patch also accepts `pos`, `rot`, `parent`, `explode`, `color`, `material`, `edges`, `opacity` and `at`. It has no `size`, `sides`, `draw` or animated control-point fields. Scale it with the normal `scale` action. Every material is shown on both sides. Boundaries are outlined at mid/high quality unless edges are disabled or the named material normally suppresses outlines (glass/glow). Interior triangulation is never outlined.

## Bounds and geometry

All 16 controls must be finite own-data coordinate triples within local -100..100. Wrong counts, holes in arrays, malformed values and out-of-range coordinates are rejected, not trimmed or clamped. The entire generated grid is checked at low, mid and high resolution before the action can replace a visible object or consume its ID. Sampled singular derivatives, collapsed Float32 triangles or faces opposed to their analytic normals are rejected with a validation issue. Use a regular grid without crossed rows, folds or collapsed boundaries.

Low/mid/high use 8/12/20 segments in each direction: 128/288/800 triangles and 81/169/441 shared vertices. Normals come from analytic surface derivatives, independently of triangle diagonals. The renderer uses the same Float32 grid as validation. Preflight and tessellation occur at construction, not ordinary frame sync. No external asset, new dependency, texture fetch, model call or expression evaluation is involved. Double-sided sheets use one material pass (`forceSinglePass`), avoiding the usual second transparent back-face pass. Transparent self-overlapping sheets can still show ordinary transparency-sorting artifacts.

This is an **open zero-thickness surface**, not a closed solid, loft, NURBS or CAD Boolean engine. A cut clips the sheet and its outlines but does not display a filled volume cap. It does not stitch neighbouring patches or guarantee watertight seams. Numeric sampling does not prove absence of global self-intersections or singularities between grid vertices. Very curved or thin nets may be rejected even if mathematically meaningful; simplify or split them. No arbitrary automatic repair is attempted. Extreme downstream scales/translations retain the renderer's usual floating-point limits.

The new variant expands the model's schema and guide, but adds no nullable fields to existing actions. A patch requires 48 coordinate numbers; prefer an existing primitive when it expresses the shape more simply. There is no claim that a live model will choose or author good nets without evaluation.

## Native review

`samples/scenes/curved-patches.json` is an authored three-form comparison, not model-generated evidence. Run all portable checks, then on a supported desktop with an isolated test profile:

```sh
npm run typecheck
npm test
npm run build
node scripts/start.mjs --grab samples/scenes/curved-patches.json --out frames/curved-patches --steps 0:8,1:3 --size 1400x1000 --software --grab-metadata
```

Capture both views and interact with the scene at all three quality tiers. The capture command uses the profile's selected tier; it is not by itself a three-tier comparison. Check smooth highlights without diagonal seams, clean curved boundaries, readable shapes from front and back, unfilled clipping, material/tint/opacity behavior, transforms, repeated sync and responsiveness. With transparent material, check both views for sorting artifacts. Ordinary box/lathe/tube/extrude examples should look unchanged.

Portable tests inspect actual Three.js geometry, materials and scene lifecycle without a GPU. They do not establish native pixels, shader/driver behavior, Windows acceptance, live model output or live-answer latency. A failed native launch or a CPU geometry picture is not visual acceptance.
