# Rounded boxes at compact sizes

`box` uses the same rounded-edge geometry at small and large authored sizes. A small housing or thin plate no longer becomes sharp simply because its bevel is below a fixed world-unit threshold. This also applies to rounded boxes inside the existing parts kit.

Use the existing `size` and optional `bevel` fields. `bevel: 0` keeps a sharp box with its ordinary crease lines. The default remains one tenth of the shortest side, capped at 0.12 units. When comparing a compact box enlarged by a parent with one authored at full size, specify the equivalent full-size bevel if that default cap would differ.

The effective radius is capped just below half the shortest side, with a proportional flat seam. Radii at or below one millionth of the longest side use the sharp-box path. This precision floor avoids collapsed or reversed Float32 triangles when a requested bevel is too small compared with a wide, thin shape. It is not a guarantee of geometric accuracy near floating-point limits.

Rounded boxes have a continuous surface, so they do not receive dark crease lines. This prevents the generic edge extractor's fixed-coordinate hashing from inventing seams on compact round surfaces. Sharp boxes and other geometry keep their existing outline behavior. Outline sharing and cleanup stay unchanged.

## Example

`samples/scenes/compact-rounded-boxes.json` shows three pairs: a housing, a thin plate and a deeply rounded block. Each lower form is authored at a smaller size and enlarged as a group; its silhouette matches the full-size form above. A second step turns the view and cuts one pair. It uses only existing scene actions.

Build and capture through the app's native renderer:

```
npm start -- --grab samples/scenes/compact-rounded-boxes.json --out frames/compact-rounded-boxes --steps 0:3,1:3 --size 1100x800 --software --layout-seeks 15 --grab-metadata
```

The capture's metadata must show a real 3D camera, and its pixels must be inspected. A fallback notice is not a model screenshot.

## Cost and limits

The existing detail tiers and per-box upper bounds remain: 300, 588 and 1,452 triangles at low, mid and high quality. Shapes that formerly fell back to a 12-triangle sharp box now pay for the requested rounding. There is no new model call, dependency, schema field, per-frame tessellation, animation clock or additional streaming wait. Repeated sync keeps the same mesh.

A local Linux/Node 24 diagnostic measured first CPU scene sync for 20 compact default boxes at roughly 6.5/10.3/24.5 ms for low/mid/high, versus 1.6/1.3/0.9 ms when they were incorrectly sharp. The same boxes at ordinary size already incur rounded construction. These figures include default outline handling, exclude GPU and inference, vary with load and are not a live-answer responsiveness guarantee. Run the ordinary test and native capture workflows on the target platform before acceptance.

This does not add adaptive tessellation, mesh export or manufacturing geometry. Nonuniform object scaling still stretches the entire rounded shape. The intentional 0.12 default-radius cap means default rounding is not scale-invariant across all large sizes. Very thin features and extreme transforms remain subject to renderer precision.
