# Shading extrusions

The existing `extrude` primitive smooths adjacent surface triangles at their exact shared corners. Nearby but distinct corners do not borrow each other's normals. Compact plates and profiles keep their lighting when enlarged by a parent, and smooth walls no longer lean their highlights toward a triangle's diagonal.

The smoothing weights each face by its angle at the corner, not by how many triangles happen to touch it. Adjacent faces must still be within the existing 0.6-radian crease threshold. Sharp corners and ordinary flat caps stay sharp; sufficiently gentle outline turns and bevel segments remain smooth.

No scene field or extra triangle is added. Positions, triangle order, UVs, material groups, bevel dimensions and quality-tier counts are unchanged. The correction applies to solid and through-hole extrusions, including both the outer wall and the inside of every opening. Other shapes and kit parts that build their own geometry are unchanged. It runs once when a mesh is built; ordinary synchronization reuses the result.

## Native comparison

`samples/scenes/extrusion-shading.json` presents three matched pairs: a round wall, a beveled plate and a sharp fin. The lower forms are authored compactly and then enlarged. Their corresponding upper forms are authored at full size. Edge lines are explicitly disabled in this lighting comparison; outline generation is unchanged.

```
npm start -- --grab samples/scenes/extrusion-shading.json --out frames/extrusion-shading --steps 0:3,1:3 --size 1100x800 --software --layout-seeks 15 --grab-metadata
```

Inspect actual model pixels and check that metadata records a real 3D camera. A fallback notice does not establish visual acceptance. Compare side highlights, cap boundaries and bevel transitions from both views. CPU normal tests alone do not establish material, GPU or desktop appearance.

## Through-hole comparison

`samples/scenes/perforated-shading.json` shows two matching bronze rings (full-size and compactly authored), a rectangular plate with two round bores, and a round collar with a hexagonal opening. Round inner and outer walls have continuous highlights. The rectangular plate and hexagonal opening retain their hard corners, and the cap boundaries remain sharp.

```
npm start -- --grab samples/scenes/perforated-shading.json --out frames/perforated-shading --steps 0:3,1:3 --size 1100x800 --software --layout-seeks 15 --grab-metadata
```

Through-hole meshes still have no bevel, even when one is requested. The change only smooths gentle adjacent wall faces using the same crease rule as solid extrusions. It does not increase silhouette resolution or turn a deliberately low-sided opening into a smooth round one.

## Limits

This does not change the existing bevel cutoff, fix self-intersecting outlines, repair collapsed geometry, or change hole triangulation. Exact shared corners mean coordinates that only nearly coincide remain separate. Already-collapsed Float32 positions cannot recover lost geometry. Zero-area triangles have no visible surface and do not contribute to a neighbour's normal. Large translations and extreme transforms still have floating-point limits; nonuniform scales stretch the shape and transform normals through the existing normal matrix.

The number of vertices and draw calls is unchanged. Construction cost depends on the number of shared corners; there is no new model call, rendering pass, frame wait, dependency, or network route. Native acceptance on the intended platform remains a separate review step.
