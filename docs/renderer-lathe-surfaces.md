# Shading rotational surfaces

The existing `lathe` shape spins a profile of `[radius, y]` points around the vertical axis. It can describe hollow vessels, nozzles, rings and other rotational forms without a new preset or executable model output. Rounded cylinder pieces also use this builder.

The surface normals now come from the profile and angular topology rather than grouping nearby positions into fixed coordinate bins. This gives round walls radial normals, keeps tiny adjacent surfaces separate, and avoids a highlight bias from the diagonal used to split each quad into triangles.

- More than eight sides shades smoothly around the axis. Gentle profile bends share equal-angle normals; a turn of at least 0.9 radians keeps a sharp shoulder.
- Three to eight sides keeps the circumferential faces flat, with the existing 0.4-radian profile crease threshold.
- An explicitly closed profile shares its first/last join when the bend is gentle. Repeated points do not create a new crease. A line along the rotation axis has no drawable surface and does not influence neighboring surfaces.
- A rounded pole shares its axial normal where all angular sectors lie within the crease threshold. A pointed cone or low-sided facet keeps its distinct directions.

The generated positions, triangle order, UVs, side counts, material controls and scene instructions are unchanged. No extra triangles, dependency, network request or generated code is added. Existing motion, arrays, transforms and disposal still use the ordinary scene path.

## Example

`samples/scenes/lathe-surfaces.json` is a hand-written example of a smooth hollow vessel, a stepped nozzle and an eight-sided collar, with a second elevated camera view. It is not model-generated output or a manufacturing model.

Run the portable checks:

```sh
node --test test/overlay-lathe-normals.test.ts
npm test
npm run typecheck
npm run build
```

On a machine with working native 3D rendering, the existing development capture tool can render the example:

```sh
npx electron scripts/overlay-frames.cjs samples/scenes/lathe-surfaces.json --out lathe-frames --steps 0:99,1:99 --size 1280x720 --tier high --gpu yes
```

## Limits

This corrects shading, not geometry. Self-intersecting profiles can still overlap, and dimensions below renderer precision can still collapse. It does not add automatic profile repair, new subdivision, new end caps or lathe cut-face caps. Smooth shading represents the intended rotational surface; it does not turn a coarse silhouette into a higher-resolution shape.

CPU geometry and scene tests do not establish native visual quality. A headless Electron capture attempt in the implementation environment exited during startup before producing a usable frame. Native GPU/PBR appearance, Windows desktop behavior and live-model authoring remain unverified.
