# Reuse repeated solid geometry

## Goal and constraints

Adopt the resource-sharing technique described by React Three Fiber/Drei without replacing Talkthrough's plain Three.js renderer or adding React dependencies. Preserve validated data-only scenes, per-object IDs/materials/cutaways, progressive delivery and transparent rendering. No Blender integration. This is a CPU/resource improvement, not a claim about live-model latency or GPU frame rate.

## Implementation

1. Add regression tests through PanelScene for shared immutable primitives, exact shape/size/bevel identity, independent transforms/materials/cuts, live reference release, replacement and clear/rebuild cycles. Run before implementation; sharing assertions must fail.
2. Cache only the existing box, sphere, cylinder, cone, torus and plane solid buffers per PanelScene. Reuse the exact geometry identity used by existing edge sharing. Release on final live reference. Keep mutable paths, streamed geometry, blobs and kit parts private.
3. Add a deterministic offline CPU benchmark using validated repeated/unique fixtures. Record per-mesh buffer bytes and deduplicated bytes, first sync and warm sync separately. Compare fresh main with the candidate; do not infer GPU memory or model latency.
4. Run focused regressions, complete suite, typecheck, build and whitespace checks. Have an independent reviewer inspect the whole change. Prepare a draft through hearthworksai only; do not merge.

## Review focus

Premature disposal with surviving peers, repeated sync reference leaks, equal geometry with independent material/clipping state, changed bevel/dimensions, same-ID replacement, and mutable draw ranges accidentally shared.

## Other libraries

Retain existing on-demand rendering and transparent GTAO/SMAA. Rapier would add simulated physics rather than improve drawing; it needs bounded validated physics actions and seek/replay before production use. Theatre can author reviewed sequences, but should not introduce a second live playback clock. Document these choices and official references in the renderer guide.
