# Open tube curves

The existing `tube` primitive uses centripetal Catmull–Rom interpolation through its distinct control points. A short span beside a long span no longer inherits the long span's uniform-knot tangent, which could make a cable double back even when all its controls advanced. This is useful for cables with closely guided ends, curved vessels, stems and flattened bands. No additional scene fields are required.

Consecutive identical points are ignored when sampling. They do not add rings, change the curve or consume part of the reveal/swell interval. Two distinct controls give a straight, evenly sampled tube. Every distinct control is still on the centerline, and the existing quality tiers keep their samples per span. Nonconsecutive repeated controls are preserved: they may deliberately bring a path back to an earlier point.

The path's shape changes from the previous uniform interpolation, so saved scenes using unevenly spaced controls can look different. Endpoints remain exact; endpoint tangents use an extrapolated neighbour. Equal parameter steps do not mean equal world-space distances, and the existing reveal and swell remain based on sampled-span progress. The stream follows the rendered path using its existing distance-based placement.

Straight `line` and `arrow` paths and motion (`along`) interpolation are unchanged. The sweep's cross-section, cap construction, frame transport and shading are also unchanged. This does not repair self-intersections, deliberate reversals, sharp bends that are too tight for the tube's radius, or geometry that collapses at floating-point precision. A smooth centerline is not a guarantee that a thick swept surface cannot overlap.

## Try the sample

`samples/scenes/open-curve-quality.json` contains three hand-written forms and a second step with reveal and flow. It requires no model or external assets. After building, use the existing frame-grab path with the installed Electron executable:

```sh
npm run build
npx --no-install electron . --grab samples/scenes/open-curve-quality.json --out frames --steps 0:8:12:8,1:5:-35:15 --size 1100x800 --software --grab-metadata
```

## Verification boundaries

`test/overlay-open-curves.test.ts` checks a hand-derived nonuniform midpoint, backwards-loop regression, exact control interpolation, duplicate handling, reversal/tangent continuity, scale and translation behavior, geometry budgets, finite normals, reveal, transformed streams and scene replacement/disposal. These are CPU geometry and renderer-state checks, not native pixel acceptance. The rest of the suite covers the unchanged motion and path consumers.

The number of rings never exceeds the existing per-span budget. Removing exact duplicate controls reduces it. No dependency, executable model output, asset import, network route or new renderer is introduced.
