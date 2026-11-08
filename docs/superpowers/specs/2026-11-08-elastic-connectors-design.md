# Profiled elastic connectors

## Intent
Make a reusable two-anchor visual suitable for an illustrative muscle/tendon, rubber cord or soft actuator. The author moves the bones or other parts with existing joints, loops and turns. The connector follows them and thickens as its path shortens. It does not exert forces, solve inverse kinematics, simulate tissue, or imply medical accuracy.

## Approach
Extend `connector`, rather than introducing an anatomical shape or a physics engine. Existing connectors already follow transforms after motion; existing tube geometry supplies smooth radius profiles and correct taper normals. A dedicated muscle shape would unnecessarily specialize the language. Physical simulation would introduce a new solver and substantially change deterministic playback.

## Interface
- `fromPoint` and `toPoint`: optional local-space Vec3 attachment points, each taking precedence over that end's named anchor or side. They follow translation, rotation and scale of the source part.
- `swell`: the existing tube radius profile, 2–8 [along, factor] pairs.
- `restLength`: optional length, 0.01–400, in the connector's own coordinate space, at which its authored radius applies. Scale the radius by sqrt(restLength / current local path length), bounded to 0.25–4. This is only an approximate volume-preserving visual. No hidden first-frame reference state, so seeks are deterministic.
- The new fields are supported for straight and slack connectors. Refuse them on wrapped belts rather than silently ignoring them. Existing connectors remain unchanged.

## Verification and constraints
Keep existing declarative validation, geometry budgets, material handling and endpoint visibility. No dependencies, model code execution, network behavior, Blender, merge or deployment. Test transformed anchors, profile shoulders, shortening/bulging, long/zero spans, fresh versus repeated seeks, unchanged geometry reuse, slack arc length and parent-space scaling. Include one clear hinged-muscle sample and a non-anatomical cord. Measure CPU updates; capture actual native Electron frames before making visual claims. Publish only a draft PR for review.
