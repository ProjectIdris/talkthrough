# Native acceptance remains required

Portable tests exercise the real scene builder and lifecycle, not Electron/WebGL pixels. Desktop review must use the actual application renderer, its checked-in grab or sample playback route, authored scenes only, and neutral background. Do not collect the user's screen, credentials, or unrelated windows. No substitute renderer or screenshots from an earlier source tree establish acceptance.

## First subgroup

- `samples/scenes/wheel-spokes.json`: step 0 at 2 s, orbit 15/10, show five/eight distinct open gaps; step 1 at 2 s confirms axle motion; step 2 at 3.2 s, orbit 165/15, confirms backside hub caps and no solid disk hiding spokes.
- `samples/scenes/connector-sockets.json`: step 0 at 1 s, orbit 15/12, inspect USB/USB3/Ethernet/HDMI/USB-C lips, recesses, tongues, contacts; step 1 at 3.2 s, orbit -20/18, inspect opening depth; step 2 at 3.2 s, orbit 155/15, inspect closed backs.
- `samples/scenes/oblique-sections.json`: use authored sequence and inspect diagonal cuts at their action starts/midpoints/completion. Caps must move with object and parent transforms, not align to screen axes or appear before action time.
- `samples/scenes/perforated-plate.json`: all three through-openings must show the background and have wall thickness; slider passes through slot without a filled cap. Check near-front and oblique views.
- `samples/scenes/convex-housing.json`: authored corner markers coincide with faceted hull; interior point does not produce a hole. Oblique cut should cap a closed volume.
- `samples/scenes/closed-loops.json`: complete loop has no seam/caps at the join. Partial reveal has a moving end; streamed beads move continuously after closure rather than shrinking at the seam.

## Final finish/shape interaction fixtures

The final candidate adds separate `samples/scenes/integration-<feature>-finish.json` scenes for hull, patch, sweep, loft, shell, sector, extrusion-holes, extrusion-taper and closed-tube. Each is a readable matched pair: matte left, polished right, under rotated/nonuniform mounts. It deliberately avoids a crowded all-features diagram.

Use the actual renderer at default native hardware graphics settings, without software-renderer flags, GPU/security overrides or fallback substitutions. Capture final source only, using a temporary isolated app profile and neutral desktop content. Suggested exact grab checkpoints for each non-tube scene: `--steps 0:2,1:2.1,2:0.5,2:1.5,2:2.1,3:2.1 --size 1200x1000 --grab-metadata`. For the closed-tube pair: `--steps 0:2,1:2.1,2:2.1`, plus interactive playback for at least one 4-second bead cycle.

- Step 0: orbit 25/18, unchanged silhouettes, tighter polished highlights, correct holes/cavities/boundaries.
- Step 1: orbit -35/22, continuous shading and expected creases only. Patch shows both sides without a cap or triangulation lines.
- Step 2 at 0.5: cut has not started. At 1.5: left-only diagonal cut is underway. At 2.1: cut completed at local offset 0, following the rotated/nonuniform mount. Right peer must remain whole with its own finish.
- Step 3 at 2.1: cut restored, rear orbit 145/20, no residual cap or missing face. All shapes must cleanly clear/replay without stale lines or missing meshes.
- Closed-tube pair: no seam or end-cap disk when complete; beads remain visible through the closing join. Separate original closed-loop sample covers reveal behavior.
- Repeat finish pairs at low/mid/high. Low disables clearcoat but keeps roughness/metalness differences. Do not mistake a low-tier missing coat for failure.

Also run the authored offline hinged-panel gallery through native playback. Inspect closed/open poses and named part alignment; offline component files must not appear as a production catalogue/model route change. Review existing controls/Explorer separately if not already verified on the exact source tree.

## Windows schema startup probe

Run `node --test test/scene-schema-windows.test.ts` on Windows. It launches only a hidden local Node receiver, with the same default shell-free argument quoting as the adapter, and verifies both lean and chained schema arguments arrive intact. It makes no provider call, reads no prompt or screenshot, and opens no interactive application. The portable quote-budget test is not a substitute for this Windows startup check.
