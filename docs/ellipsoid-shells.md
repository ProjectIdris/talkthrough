# Hollow ellipsoid sections

`shell` adds one reusable closed material volume between concentric ellipsoids. It can describe domes, bowls, covers, curved enclosures and opened layers without assembling overlapping spheres or hand-sampling a rotational profile. It does not change the existing sphere or lathe paths.

```json
{"op":"add","shape":"shell","id":"cover","size":[4,3,4],"inner":0.85,"latitude":[0,90],"sweep":270,"material":"metal"}
```

## Coordinates and limits

- `size`: full outer ellipsoid diameters `[x,y,z]`, each 0.01–100. These are **not** the bounding dimensions of the cropped section. A `[4,3,4]` upper hemisphere reaches y=1.5 from its equatorial rim at y=0.
- `inner`: 0.01–0.99, default 0.85. Every inner position is the corresponding outer position times this factor, about the local origin. It describes radial proportion, **not uniform normal-offset wall thickness**. Zero/one are not permitted.
- `latitude`: `[south,north]`, default `[-90,90]`. Degrees between −90 and 90, with north at least 1 degree above south. Zero is the x/z equator. `[0,90]` is an upper dome; `[-90,0]` a lower bowl. Latitude is measured on the sphere before scaling its axes, not the physical elevation angle of an unequal-axis ellipsoid.
- `sweep`: 1–360 degrees, default 360. Begins on +x and proceeds toward +z around y. Use ordinary `rot` to aim the opening. A full sweep has no artificial seam.
- The origin remains the centre of the complete ellipsoid, not the centre of the cropped bounds. `pos`, `rot`, parenting, copies, style, motion, highlight, cut and replay retain their normal meaning. It can parent other objects; it is not itself a new automatic tube-attachment target.

The two smooth skins and every exposed radial rim bound the shell's material. Latitude rims are generally conical, not horizontal: their inner latitude follows the scaled ellipsoid, too. Only an equatorial rim is flat. Angular walls are flat. Poles are exact single positions, not tiny rings. A complete shell encloses a real cavity rather than filling it with a dark object.

Normals follow the analytic ellipsoid gradient on both skins, pointing into the cavity on the inner surface. On very unequal axes, a smooth vertex normal can be obtuse to a coarse face normal; this is not a reversed face, and does not cause rejection. Rim normals remain separate. Optional dark lines trace only the exposed inner/outer boundaries and corner joins, with no grid diagonals or artificial periodic seam. Existing low-tier, glass and glow outline suppression still applies.

## Safety and cost

Dimensions, spans and ratio are checked without silently clamping them, truncating vectors, evaluating strings or reading array getters. Sparse/accessor/nonfinite vectors reject. Shared pure preparation verifies nonzero emitted Float32 triangles and their orientation against the prequantized triangles at all quality tiers before an ID or replacement permission is consumed. An invalid direct renderer call yields an empty node, not an invented fallback box. No new dependency, external modeller, imported asset, shader, network access or executable model input is introduced.

Low/mid/high use 16/24/40 full-longitude divisions and 8/12/20 full-latitude divisions. Restricted spans reduce each count proportionally, with a minimum of two. The maximum is **1,970 vertices, 3,440 triangles and 244 optional outline segments**. Full spheres use fewer vertices/triangles because pole rows and the periodic seam are welded. Preparation happens at admission and object creation, not repeated animation sync. Valid large batches still cost CPU time. This is a faceted mesh with smooth analytic normals, not an exact CAD boundary.

No arbitrary openings, offset surfaces, animated profile changes, nonconcentric walls, bevels, UV textures or physical shell simulation are provided. Transparency retains the existing renderer's sorting limitations. This branch is independent of pending geometry and per-object finish work: adding those branches requires explicit schema and integration review.

## Supported-desktop visual review

Use `samples/scenes/ellipsoid-shells.json` with the app's existing supported `--grab` workflow described in [`docs/overlay.md`](overlay.md#looking-at-it-without-the-app). Keep production Electron sandbox and normal graphics settings. Inspect the actual native frames at each step and low/mid/high quality:

1. The dome's underside is hollow, with a continuous equatorial rim and smooth crown.
2. The bowl has a real inner wall and closed curved bottom. Its raised rim slopes inward radially, rather than being a flat horizontal ring.
3. The open enclosure exposes its cavity and two closed angular walls. The back does not contain a false longitude seam.
4. Reverse and oblique views have no missing faces, dark triangle diagonals, pole spikes, cracks or flickering overlapping fills.
5. Exercise ordinary cuts, parent transforms, copies, style, replacement and backward replay. Check cap pixels preserve the cavity and ordinary materials behave sensibly.

The established sandboxed cloud Electron runtime cannot initialize WebGL2. This feature does not repeat a graphics/security bypass or replace the renderer. **No native appearance, PBR/GPU quality, live-model authoring, Windows behavior or visual acceptance is claimed.** Portable topology and material checks cannot prove pixels or aesthetics. Native visual acceptance remains pending a supported desktop run.
