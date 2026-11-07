# Smooth profile surfaces

## Intent

Give rounded lofts and shaped sweeps continuous lighting without changing their geometry or making angular examples round. This is an independently selected continuation of the rendering-quality work.

## Approach

Add optional `smooth: true` to `loft` and `sweep`. Omitted, null and false retain existing shading and outlines. At each section corner, blend only the two adjacent wall normals when they meet within 0.6 radians, using their known topology rather than position buckets. Keep caps independent and retain any blend that would oppose an incident triangle as a sharp corner. Remove longitudinal outline segments only where both ends are smoothed. Keep end perimeters.

Alternatives considered: unconditional smoothing would change authored polygonal designs; adding more section points costs geometry and does not remove shading seams; a new rounded primitive duplicates the existing vocabulary. Opt-in shading uses existing bounded meshes and keeps ordinary scenes unchanged.

## Constraints and acceptance

- No dependencies, new render passes, code execution from scene data, Blender, security overrides or backend changes.
- Positions, indices, triangle count, bounds, cap normals and topology are unchanged. Detail tiers retain their solid vertex/triangle budgets and low-tier no-outline policy. Loft outline segments may split at changing creases, bounded by the existing sampled rings.
- Default behavior remains byte-identical. New work occurs only at geometry creation, not ordinary sync.
- Prove radial lighting on a straight regular profile, crease/cap preservation, transformed/replaced/array ownership, compact and reversed profiles, bent/warped sections, and outward finite unit normals.
- Run focused and full portable tests, typecheck, build and independent review. Native visual review must use the authorised desktop route and be reported separately from portable evidence.
- Open a draft through hearthworksai only after verification; do not merge.

## Limits

Smoothing changes lighting, not polygon silhouettes, physical roundover or wall thickness. The fixed crease threshold follows the existing extrusion smoothing convention. Nearly folded geometry can retain a crease to protect valid outward normals. Sweeps remain open paths and lofts remain solid convex-section transitions.
