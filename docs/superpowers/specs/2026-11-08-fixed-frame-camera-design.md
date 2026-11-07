# Fixed-frame camera fitting

## Intent and evidence

Sequential section-hatching captures exposed history-dependent camera framing: after 16 seeks the 30× model clipped and the return looked tiny. Each seek advanced the capture clock by only 1/30 s, irrespective of requested scene time. The 0.45 s camera easing constant consequently retained about 31% of the previous fit difference. Wall-clock waiting could not settle it. Cold-state captures passed.

This is fixed-capture correctness, not evidence of a permanently stuck live camera. Live easing is intentional. Scheduled capture clips also use seeks and must retain their glide.

## Approach

Add an optional internal `cameraFit: 'instant'` seek field for fixed-frame callers. Its draw omits the camera's smoothing clock, an existing supported `PanelScene` mode. Still grabs request it; scheduled clips leave it absent. The label/pen capture clock, source timeline, camera angles, geometry, thresholds and security settings do not change.

Globally snapping all seeks was rejected because it would change generated clips. Increasing layout retries was rejected because fixed-state correctness should not depend on previous scene extent or retry count.

## Acceptance and limits

A real overlay grab must frame 1× → 30× → angled → 1× correctly on the first request, retain that camera through repeated layout seeks, and preserve capture clock progression. Existing live glide tests and unflagged native sequential captures must retain their old behavior. Native comparison uses identical PR47 prerequisites and the same authored section sample, without clearing between checkpoints.

No claim of improved live transition animation or temporal shimmer. No new dependency, external request, privileged capture, security override or merge.
