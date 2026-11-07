# Surface finish review

Four bounded `add` fields tune the existing named PBR surfaces without adding a material preset for every subject: `roughness`, `metalness`, `clearcoat` and `clearcoatRoughness`, each 0..1. They are available on solids, extrude, lathe, blob, tube and connector, the same additions that already accept `material`. Omission or null retains each named recipe; explicit zero is honored. See [scene language](scene-language.md#surfaces) for exact behavior.

The authored `surface-finishes.json` scene compares polished/rough copper spheres, matte/coated blue housings and glossy/matte teal tubes. Geometry and tint are identical within each pair. These are illustrative surfaces, not measured material presets.

## Native acceptance

Use the final reviewed source on a supported desktop. Run all automated checks, then capture actual renderer output:

```sh
npm run typecheck
npm test
npm run build
node scripts/start.mjs --grab samples/scenes/surface-finishes.json --out frames/surface-finishes --steps 0:8,1:2 --size 1200x1000 --software --grab-metadata
```

Also open this scene in ordinary interactive playback and compare low, mid and high rendering quality. The native capture uses the profile's selected quality; the command alone is not a three-tier comparison. Use an isolated test profile for capture. Check:

- Copper highlights are tighter on the polished sphere and broader on the rough sphere.
- The blue housings retain the same base tint and shape, while the coated one has a narrow top-layer highlight at mid/high. At low quality their appearances match because that tier disables clearcoat.
- Teal tube highlights respond to their different base roughnesses without changing their shape, opacity or draw behavior.
- Highlights follow the second view; there is no texture swimming, new pass or changed silhouette.
- Existing examples with omitted finish fields retain their appearance. Arrays, tint/highlight/opacity, cutaway and replacement still work, and interaction remains responsive.

CPU tests inspect actual Three.js materials and scene lifecycle; they do not establish GPU/PBR appearance, shader compilation on every driver, live-model authoring quality, Windows behavior or live-answer latency. A build without a native frame is not visual acceptance. This change adds no screenshots produced by another renderer.

## Cost and limits

Construction adds four optional scalar reads per object. Geometry and ordinary draw counts do not change; normal frame sync does not rebuild or retune materials. Explicitly enabling clearcoat on a previously uncoated surface can add the existing Three.js clearcoat shader work at mid/high quality. The low tier continues disabling that layer. There is no new postprocessing pass, texture, network access, code execution, dependency, asset cache, Blender path or framework rewrite.

Full and lean schemas add four optional/nullable scalar properties to each of six material-bearing variants. Strict structured-output providers therefore emit four extra numbers/nulls per such add action. They are construction-time controls, not animated `style` fields. Groups do not inherit finishes; arrays copy the source; built-in kit parts keep their mixed surfaces and cut faces keep their section treatment. Glass remains an alpha-blended shell, not physically refractive glass. Flat colors still depend on the named recipe, so use an explicit tint when changing metalness. Finite out-of-range inputs clamp with a validation issue; nonfinite and wrong-type inputs reject before state mutation.
