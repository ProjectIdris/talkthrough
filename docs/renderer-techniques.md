# Renderer techniques without a framework migration

Talkthrough draws validated scene data with plain Three.js inside Electron. Its renderer already has physical materials, room lighting, soft shadows, camera fitting, controlled mechanisms, on-demand frames, transparent GTAO/SMAA finishing and a speech-aware seekable timeline. Improving this system does not require adopting every library used by React-based demos.

## Implemented: reuse immutable solid geometry

The resource-sharing approach described in [React Three Fiber's performance guide](https://r3f.docs.pmnd.rs/advanced/scaling-performance) applies directly to Three.js. Equal boxes, spheres, cylinders, cones, tori and planes now reuse their vertex/index buffers inside a `PanelScene`. Existing edge sharing is retained.

- Geometry identity includes tier, shape, dimensions and effective box bevel. Equal shapes can still have different colors, surfaces, opacity, parents, transforms, animation, edge visibility and cut planes.
- Meshes and materials remain separate. IDs, picking, pins and cutaway stencil helpers keep their current ownership. This is **not draw-call batching or instancing**.
- The last live owner disposes its geometry and removes the cache entry. Clearing/replacing models cannot accumulate a cross-answer cache. Separate panels do not share ownership.
- Mutable lines, arrows, tubes, connectors, stream markers, blobs, generated kit parts and other geometry remain outside this cache. In particular, progressive path draw ranges cannot affect a peer.
- No scene-language fields, model prompt, schema, dependencies, network destination, postprocessing shader or playback clock changes. First-time geometry is still built synchronously when that validated object arrives; there is no preload barrier or new runtime to initialize.

## What each library contributes

- **Three.js:** remains the renderer and implements this reuse directly. Repeated geometry should be shared only while its ownership and mutation rules are known. See [resource disposal](https://threejs.org/manual/en/how-to-dispose-of-objects.html).
- **React Three Fiber:** its resource reuse and on-demand rendering practices are useful. Talkthrough already schedules frames on demand. Introducing React and migrating lifecycle ownership would not be needed for either technique.
- **Drei:** its helper designs are references, rather than a dependency to import into a non-React renderer. [Adaptive DPR](https://drei.docs.pmnd.rs/performances/adaptive-dpr) is a possible next experiment if measured interaction frame times justify it. It would need to preserve crisp 2D labels and restore full-quality stills without resolution thrashing.
- **React Postprocessing:** retain the current alpha-aware, model-region finishing path. The underlying [postprocessing library](https://pmndrs.github.io/postprocessing/public/docs/) can work without React, but replacing or stacking it is not justified by a missing effect here. Any later comparison must test stencil cutaway caps, alpha, color management and fallback as well as appearance. Current low/mid tiers skip constructing/running finishing; its static import is still bundled, so this is not bundle-level lazy loading.
- **React Three Rapier:** its underlying [Rapier JavaScript API](https://rapier.rs/docs/user_guides/javascript/getting_started_js/) is the compatible route for a future explanation requiring collisions or gravity. Existing hinges, gears and cams are controlled kinematics. A physics extension would first need bounded validated bodies/colliders, asynchronous WASM loading outside the first useful-piece path, and deterministic seek/replay policy. No physics engine is added by this change.
- **Theatre.js:** [works with plain Three.js](https://www.theatrejs.com/docs/latest/getting-started/with-three-js) and could help author prepared camera/animation sequences. A future authoring adapter should export reviewed data into existing actions, leaving Studio and a competing clock out of live streamed answers. No Theatre runtime or editor is added here.

Blender is excluded from this work, including offline authoring. These choices implement one concrete reuse improvement, not a claim to have installed or integrated all the listed packages.

## Reproduce the CPU/resource measurement

Run `node scripts/benchmark-solid-sharing.ts` with Node 24. It emits JSON with source/benchmark/fixture hashes, complete geometry-and-transform digests, typed-array byte counts and timing summaries for all three tiers. It validates its own 1-object and 60-object fixtures with the production validator. Sixty objects use three steps to respect the existing action limit.

Default sampling is two warmups and ten measured instances per case. Each uses a fresh `PanelScene`; first sync and the following unchanged warm sync are measured separately. Imports, fixture validation, timeline evaluation and scene construction occur before those clocks. Edges are disabled to isolate the new solid reuse. Timings are process-warm CPU diagnostics, not cold startup or performance guarantees. Bytes count vertex/index typed-array storage, not GPU allocation, process heap or total scene memory.

Compare the same benchmark file on current main and this change. Geometry digests include every attribute, index, group, draw range and mesh world transform. Matching digests check that these fixtures retain their geometry; they do not establish matching rendered pixels, materials, shadows, alpha or cutaway appearance.

In one Linux x64 / Node 24.22.1 / Three.js r187 run, main → candidate:

| Tier | Repeated first sync, p50 | Repeated solid bytes | Unique first sync, p50 |
| --- | --- | --- | --- |
| Low | 11.59 → 3.32 ms | 1,226,040 → 122,604 | 11.22 → 11.91 ms |
| Mid | 19.03 → 2.98 ms | 2,403,960 → 240,396 | 18.83 → 21.67 ms |
| High | 38.92 → 4.63 ms | 5,107,000 → 510,700 | 39.73 → 41.39 ms |

The repeated fixture has ten instances of each of six shapes: unique solid buffers fell from 60 to 6. Unique dimensions still use 60 buffers and show no benefit; timings were slower in this run. Single-piece p50 was 0.66 → 0.94 ms (low), 0.52 → 0.78 ms (mid), and 1.09 → 1.16 ms (high). Unchanged warm sync remained roughly 0.02–0.33 ms. All nine geometry digests matched between versions. Timing variation and the small sample size prevent a general latency conclusion.

## Acceptance boundaries

Portable tests exercise sharing, last-owner disposal, repeated sync/clear, same-ID replacement, arrays, independent materials/cut planes and mutable path draw ranges. Existing rendering tests remain necessary. No WebGL frame rate, native GPU visual acceptance, live model output or first useful piece within three seconds is established by this benchmark. The live target remains an end-to-end measurement, not something to infer from geometry build time.

Pending geometry/assembly branches may also touch `scene3d.ts`. This change does not duplicate their primitives or part improvements; combine and retest their final trees before merge.
