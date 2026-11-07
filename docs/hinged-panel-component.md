# A reusable hinged-panel component

This is an **offline authoring library component**, not a new model tool or a production scene action. One bounded TypeScript call produces normal, editable scene data for a door/access-panel hinge, a folding-device hinge or a compact mechanical joint. It depends only on public main's existing group, extrude, lathe and cylinder primitives.

## Use it

```ts
import { hingedPanels } from '../scripts/components/hinged-panels.ts';
import { validateScene } from '../src/scene/validate.ts';

const hinge = hingedPanels({ id: 'door', width: 2.4, height: 6, knuckles: 5, fold: 55 });
const checked = validateScene({ steps: [{ say: 'The leaves share one pin.', actions: [
  { op: 'panel', x: 100, y: 100, w: 800, h: 800 },
  { op: 'orbit', az: -25, el: 20 },
  ...hinge.actions,
] }] });
if (!checked.ok || checked.issues.length) throw new Error('Scene needs correction');
```

Parameters:

- `id`: a non-reserved scene ID prefix, 1–20 characters. Letters first, then letters, digits, underscores or hyphens.
- `width`: width of each leaf, 0.8–6 scene units; default 2.4.
- `height`: length of the knuckle stack along y, 2–12; default 5.
- `knuckles`: integer 3–7; default 5. Adjacent knuckles belong to alternate leaves.
- `fold`: 0–180 degrees about the pin's y axis; default 45. Zero lies flat and 180 folds back.

Invalid numbers, accessors, unknown options and bad prefixes throw before expansion. Thickness, barrel radius, pin clearance, knuckle spacing and chamfers are derived, not additional independent controls. Each call returns fresh arrays and profiles.

The component emits `8 + 2 × knuckles` actions: 14–22 in total, leaving room for a panel and orbit within the current 24-action step budget. Multiple assemblies still consume the normal scene action/object budgets. This is bounded expansion, not hidden renderer instancing or a reduction in the number of scene actions the renderer processes.

The caller must reserve **all generated IDs**, not only distinct root prefixes. For example, a component with prefix `h` owns `h_pin`, so another component rooted at `h_pin` would collide. The real scene validator must still check the final combined scene and follow-ups. The helper does not inspect or allocate IDs from live state.

## Meaningful parts remain addressable

`hinge.ids` contains:

- `root`, `fixed`, `moving`: assembly groups. `moving` rotates at the pin axis.
- `fixedLeaf`, `movingLeaf`: the two bevelled plates with rounded outlines.
- `knuckles[]`, `necks[]`: every hollow sleeve and its tapered shoulder connection to its leaf.
- `pin`, `pinHead`, `pinTip`: the shaft and its two turned end caps. The caps are children of the pin.

A later ordinary `turn` on `ids.moving` folds that leaf and its own knuckles/necks. An ordinary `move` on `ids.pin` carries its end caps. Each leaf, sleeve or pin can be pinned, styled or highlighted independently. Clearing the root clears its descendants; clearing the pin leaves the sleeves and their bores intact.

This is an explanatory assembly, not CAD or a manufacturing model. Necks overlap their leaves and sleeves at their junctions; they are separate meshes, not boolean-welded solids. There are no mounting holes, fasteners or certified tolerances. Tests check basic leaf clearance at intermediate folds, but do not establish continuous collision-free motion, strength or physical constraints. Follow-up actions use the existing language and can move parts beyond the helper's initial parameter bounds. The offset-pin example is an exploded illustration, not a validated extraction path. Existing lathe cutaway/capping limitations are unchanged.

## Construction refinement

The component uses existing renderer geometry:

- Leaf corners use a 24-point rounded outline with a radius independent of the edge bevel. Plate thickness increases from 0.40 to 0.65 of the barrel radius, so the edges remain readable.
- Tapered neck shoulders spread over more of each sleeve while keeping the central bore clear.
- Knuckles occupy 94% rather than 84% of their pitch. Separate lips and internal chamfers give the closer seams a construction detail without merging the parts.
- Pin caps use explicit turned profiles with a shoulder and low crown instead of tall cylindrical discs. The shaft, head and tip still have the same independent IDs and parent relationship.
- The two leaf colours are lighter for legibility; the existing metal material is unchanged. This does not add a painted, brushed or anisotropic material.

The same controls, role IDs, action count and object budget apply. The leaves and necks now use ordinary `extrude` actions instead of boxes, and the caps use `lathe` instead of cylinders. Consumers that inspect primitive shapes must handle these changes; consumers using the documented IDs for move, turn, style, highlight and clear can keep using them. Every current example fixture is regenerated from the helper.

## Reproduce and view in Talkthrough

Generate the four ordinary scene fixtures and run the geometry tests:

```sh
node scripts/components/hinged-panels-examples.ts
node --test test/component-hinged-panels.test.ts
```

The fixtures use Talkthrough's existing validator, timeline and Three.js renderer. Capture them through the app's existing Electron `--grab` path:

```sh
npm run build
npx --no-install electron . --grab samples/components/hinged-panels-door.json --steps 0:10 --out hinge-grab/door --grab-metadata
npx --no-install electron . --grab samples/components/hinged-panels-folding.json --steps 0:10 --out hinge-grab/folding --grab-metadata
npx --no-install electron . --grab samples/components/hinged-panels-joint.json --steps 0:10 --out hinge-grab/joint --grab-metadata
npx --no-install electron . --grab samples/components/hinged-panels-inspect.json --steps 0:10,1:10,2:10 --out hinge-grab/inspect --grab-metadata
```

These commands require a supported Electron environment. They write PNG frames and metadata identifying the source fixtures and built renderer. The three inspection steps show the intact hinge, offset pin and independently folded moving leaf. See [overlay capture notes](overlay.md#looking-at-it-without-the-app) for the capture options and acknowledgement limits.

There is no external renderer, mesh-export pipeline or additional dependency in this component. The authored scenes run in the program; there is no runtime generation or execution of model-authored code.

## Scope and verification

No production adapter, renderer, validator, schema, prompt, model route or package dependency changes. The helper is an offline authoring utility, not a live model tool or a new scene primitive. Base: `bda682acd8b5fd2e0f2efef8d4caac864ecef40e`. No pending PR is required.

Thirteen focused tests cover 135 parameter combinations through unchanged real validation, malformed inputs, fresh output, ID-based follow-ups and recursive clear, pin hierarchy, real hollow geometry, basic folding transforms, 81 intermediate-angle leaf-clearance cases, finite/compact boundary meshes, reproducible scenes, rounded leaf silhouettes, tight but separate barrel seams, and 72 boundary/tier combinations with 12 off-axis bore rays each. These are sampled geometry regression checks, not certification of a physical mechanism.

Fresh portable verification: 1,346 tests, 1,333 passed, 13 skipped, zero failures; typecheck, production build and whitespace checks passed. The predecessor ran 1,347 tests with 1,334 passes and the same 13 skips; the removed test exercised the retired mesh-export script. The existing synthetic speech-server test needs a process-only proxy exclusion for `127.0.0.2` in this cloud environment. No system or application proxy setting was changed.

A native capture was attempted in this environment, but Electron exited before producing a frame. Native visual acceptance, physical desktop interaction and GPU performance are therefore unverified. No substitute renderer images are included. The supported capture path above is the way to review appearance in the program.

The library does not integrate catalogue selection, streaming assembly admission, state-aware ID allocation, model authoring or live request measurement. No token savings, first-answer improvement, speed or live-model quality result is claimed. Those remain separate integration decisions.
