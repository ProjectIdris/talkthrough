# Offline native 3D visual checks

Run this from a development checkout with Node 24+, installed dependencies and Electron:

```sh
node scripts/prototypes/check-visual-quality.ts --out /path/to/new-evidence-directory
# Also check the production high-tier finishing pass on a compatible machine:
node scripts/prototypes/check-visual-quality.ts --out /path/to/another-new-directory --tier high
```

The output directory must not already exist. Each run is a separate evidence set, so stale screenshots cannot be mistaken for a new success. Open `inspection.html` locally, then inspect each PNG at full size alongside `report.json` and `native.log`. No upload is performed. Do not commit personal captures or machine logs.

## What is exercised

This is a removable development harness. It bundles the **current checkout's real overlay and preload**, uses the actual scene validator, and sends ordinary seek IPC messages to the renderer. It does not import another implementation or substitute a browser-only renderer. Production source, model adapters, prompt/schema and dependencies are unchanged.

Three hand-written scene families each have front and oblique views:

- Box, sphere and torus: silhouette, holes, curved shading and corners.
- Extrusion, lathe and open tube: profile caps, notches, seams and bends.
- Wheel, gear and USB-C port: distinct built-in details and openings.

The fixtures use current-main scene semantics, not pending geometry extensions. A run on a geometry PR exercises that checkout's implementations and records their hashes; it does not establish acceptance of other PRs or the combined stack.

Each capture uses an 800 × 600 viewport at scale 1, a fixed scene time of three seconds, an acknowledged empty-scene reset followed by two fixture seek acknowledgements and an additional 150 ms before `capturePage`. The default tier is explicitly `mid`; `--tier low|mid|high` selects another existing production tier. Camera metadata must match the requested view, and seek counts are preserved. The acknowledged reset prevents unrelated fixtures from reusing old geometry under the same numeric object keys. The native compositor is offscreen: these are real Electron renderer pixels, not physical-monitor presentation or a user-desktop screenshot.

The 3D canvas alone is visible over a neutral inspection background. Harness CSS hides all 2D marks, captions, HUD and controls, so they cannot satisfy a 3D check. The baseline is captured before any fixture. The profile is guarded and temporary, permissions/navigation/popups are denied, and requests are restricted to the two local overlay assets. GPU and sandbox security are not relaxed. On Linux without a display, the runner uses headless Ozone; an unavailable WebGL stack is reported, not replaced.

## Diagnostics and exit codes

- **0, `passed-smoke-checks`:** all six captures exist and pass the conservative pixel checks. Human visual review is still needed.
- **1, `failed`:** a pixel check, validator, camera acknowledgement, build, launch, timeout or resource check failed. Captured images and diagnostic output are retained where available.
- **2, `unsupported`:** the production overlay could not initialize WebGL2. No 3D capture or visual pass is claimed. The neutral baseline remains available for debugging the harness only.

`nativeVisualAcceptance` is always `null`. Even a smoke pass cannot establish semantic completeness, attractive rendering, correct geometry or good model-authored output. A bright but wrong/incomplete shape can pass; inspect every image. These are deliberately broad heuristics, not a pixel-perfect golden-image comparison, perceptual-quality score or validated cross-device quality gate.

The analyser composites premultiplied BGRA pixels onto the same neutral background, ignores hidden transparent RGB and measures changes against the baseline:

| Check | Current threshold | Typical failure |
| --- | --- | --- |
| Blank | No changed pixels above 18 levels of channel difference | Missing model or transparent output |
| Too small | Changed coverage below 0.5% | Unreadably small framing |
| Too large | Changed coverage above 70% | Full-screen fill or severely oversized framing |
| Dark | More than 85% of changed pixels have luminance below 55/255 | Black/dark rendering |
| Edge clipping | More than 2% of changed pixels in outer 1% bands, or more than 2% of any outer boundary occupied | Model touching capture edges |
| Off-centre | Changed-pixel centroid more than 30% of image width/height from centre | Bad fitting or displaced geometry |

Shadows, antialiasing and material choices affect these statistics. The thresholds are fixed smoke defaults and are included in every report. They are tested against synthetic failure examples; they have not yet been calibrated by native 3D captures across GPUs. Do not silently relax them to make a failed scene pass.

## Reproduction and existing tools

The report contains scene data and hashes, views, source/build hashes, Git revision and dirty state, runtime/renderer details, thresholds, camera metadata and diagnostics. Generated assets are private to each run; a pre-existing `dist/` cannot alter the tested overlay. Source hashes describe the working tree, while the Git revision alone may not when the tree is dirty.

For arbitrary scenes and normal hidden-window capture, the app's existing `--grab` path remains available:

```sh
npm start -- --grab samples/scenes/pin-tumbler-lock.json --out /path/to/grabs --grab-metadata
```

See `src/main/args.ts` for exact grab/view/time options. `--grab` uses a different window/capture path and is not replaced by this 3D-only harness. PR27's earlier first-stroke probe measures a small 2D marker arriving from a streamed fixture; it is not visual-quality acceptance, and this harness does not depend on that PR. Timing measurements belong to their own harness.

## Verification boundary in the development environment

The available Linux cloud runtime ran the actual sandboxed overlay and returned `unsupported`: WebGL and OpenGL were `disabled_off`, and the production fallback hid its unavailable 3D canvas. The neutral baseline and diagnostic report were produced; **no native 3D screenshot, positive-pixel acceptance or human inspection of a rendered model was possible**. No sandbox or GPU override was attempted. Portable tests validate the negative pixel controls, fixtures, report behavior and native unsupported path. Run this on a compatible native Electron graphics stack before treating it as a reviewed visual result.
