# Convex profile lofts

A `loft` joins two independently shaped convex outlines into one closed solid. It is useful for asymmetric housings, shaped fins and solid transitions whose far end is not just a scaled copy of the near end.

```json
{"op":"add","shape":"loft","id":"transition","outline":[[-1,-1],[1,-1],[1,1],[-1,1]],"endOutline":[[-0.5,-0.8],[1.5,-0.4],[0.8,1.4],[-0.8,0.6]],"depth":3,"material":"metal","color":"blue"}
```

## Authoring

- `outline` lies at local z = `-depth/2`; `endOutline` lies at `+depth/2`. Both are XY coordinates. `depth` is 0.01–100.
- Each ring has 3–24 corners, with exactly the same count. Corner 0 joins corner 0, and so on. Both rings must have the same winding; reversing both is fine. Points are not rematched or recentered.
- Both rings and every section between them must be strictly convex. Coordinates are finite and within -100–100. Do not repeat the first point at the end or add straight/repeated corners. A change of winding, collapsed intermediate section or unsafe Float32 mesh rejects the whole add before it can replace an existing object.
- Use ordinary `parent`, `pos`, `rot`, `explode`, `material`, `color`, `opacity`, `edges` and `at`. Arrays and existing motion, cutaway, replacement and replay work normally. Children use the loft's parent transform, but the loft itself is not a new automatic tube-attachment target.
- Faces have sharp polygon corners and flat caps by default. Optional `smooth: true` blends shallow wall joins and removes their longitudinal outlines, retaining sharp corners and flat caps; see [smooth profile surfaces](smooth-profiles.md). Side shading follows the ruled surface between matching edges. There is no bevel, hollow interior, concave section, arbitrary mesh input or animated profile change. For a constant profile use `extrude`; for a round body use `lathe`.

A strongly rotated second ring can narrow or cross the middle even if both ends look valid. Keep correspondence straightforward. Nearly collinear, very thin or compact translated profiles can reject conservatively. Put small profiles near their local origin and use `pos` for placement.

## Bounds and mesh meaning

Low/mid/high quality use 4/8/12 longitudinal strips, respectively. Maximum high-quality solid output is 672 vertices and 620 triangles per object. Default outlines have at most 72 segments. With `smooth: true`, changing creases can split longitudinal lines into partial runs, bounded conservatively by 336 outline segments at high quality (144 low, 240 mid, before the ordinary low-tier no-outline policy). Construction and admission checks run when an object is created, not on every animation sync. Low quality retains its ordinary no-outline behavior.

The intended side is a bilinear ruled patch. Triangles approximate its curvature between strip rows, while analytic normals avoid shading seams along diagonals. The emitted triangle mesh is therefore an approximation, not exact CAD. Higher quality adds strips. Only end perimeters and corresponding corner joins receive lines.

Admission checks the continuous ideal section orientation using quadratic minima. It also checks emitted Float32 ring geometry and the actual triangulated wall cross-sections across orientation-root events. Numerically ambiguous cases can reject; no silent topology repair or substitute box is produced. This is a bounded local modelling primitive, not an unrestricted geometry validator or proof about later transformed/clipped GPU pixels.

## Native review

On a compatible native Electron desktop, use the ordinary app to play `samples/scenes/profile-lofts.json`, or:

```sh
npm start -- --grab samples/scenes/profile-lofts.json --out /path/to/new-loft-evidence
```

Review all three quality tiers using the app's existing graphics setting, with a fresh output directory each time. Inspect the real native frames from both ends and the cutaway. Look for missing faces, crossed walls, cap gaps, dark diagonal stripes, spurious edge lines, unstable highlights, clipped framing and incorrect transparent-material sorting. Add a parent-scaled copy and inspect it too. The sample is hand-authored, not a live-model authoring test.

The current cloud environment cannot initialize the production WebGL2 renderer. No native screenshot, GPU/PBR quality, Windows desktop behavior or visual acceptance is claimed for this change. Portable mesh tests cannot verify rendered appearance or cut-cap pixels. No blocklist/sandbox override or alternative renderer is part of this work.
