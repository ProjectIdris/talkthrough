# The overlay renderer

The overlay page (`src/overlay/`) draws the scene language (see `scene-language.md`) over the display it covers and plays scenes sent by the main process. It draws what it is given and nothing else: every scene has already been through the validator, and strings are only ever drawn as text.

## Layers

From back to front inside the overlay window:

1. **Backdrop** (development and frame grabs only): an image shown behind everything. It is also the source of image-card crops.
2. **The stage frame** (optional): a rounded box behind the model, only when the scene asks for `frame`. It never takes the pointer.
3. **The 3D canvas**: one WebGL canvas covering the display. The model floats on it, lit and shadowed, over the page.
4. **The marks canvas**: a 2D canvas covering the display, drawn in device pixels: marks, tags pinned to 3D parts, note cards, image cards.
5. **The app's own words**: a listening cue, a thinking indicator, an offer card and a short notice (DOM, from `index.html`).

Scene coordinates run 0 to 1000 across each axis of the window, which covers the display that was captured. Every rectangle is snapped to physical pixels, so lines stay crisp at any display scaling.

## The 3D look

- **Surfaces** (`materials.ts`): physically based (roughness, metalness, a little clear coat) in a named set: plastic, metal, rubber, pcb, glass, glow, paper. A colour tints a surface.
- **Light**: three's room environment, pre-filtered once, plus one key light; Neutral tone mapping so colours keep their identity.
- **Shadow**: a soft shadow on the page under the model (a real shadow map on the higher tiers, and a gradient blob on every tier), on a floor just under the lowest part. The model is never clipped to the stage rectangle: the camera is given the whole display as its window (`setViewOffset`) and the render is scissored to where the model and its shadow are, so cost follows what is drawn, not the display size.
- **Camera**: the longer side of the stage sees 35 degrees, so a wide stage does not skew the edges.
- **Edges**: thin dark lines on solids, from the second tier up.
- **Tiers** (`TIERS` in `materials.ts`): `low` (no multisampling, no shadow map, no edge lines, no clear coat), `mid` (the default on software rendering: multisampling, a 1024 shadow map, edges, clear coat), `high` (2048 shadow map, device pixel ratio up to 2). The page address takes `?tier=low|mid|high`; with none it picks `mid` on a software rasteriser and `high` otherwise.

## Building models

`geometry.ts` makes the shapes (rounded boxes, extrusions, lathes, tubes along a curve, drawn on a ring at a time); `parts.ts` builds the parts kit from the same pieces, fitted to the box a scene gives; `scene3d.ts` brings a Frame into three.js, applies explode (children sit at their position times one plus the spread), places the floor, light and shadow, and projects points of objects to the screen for pins and hit tests.

## Looks

`theme.ts` holds the one look of tags, cards and image cards: dark glass, a coloured dot or bar for each item, thin light lines, Windows' own fonts (Segoe UI Variable). The scene never chooses it.

### Where tags go

`labels.ts` places the tag of every `pin` by itself; the scene only says what is pinned to what. It is plain geometry (tested without a window): the page gives it the outline of every part of the model on screen, how busy the page underneath is (edges in the screenshot, so text counts), and the anchor of each pin. A tag is put where it overlaps neither the model, nor another tag, nor (as far as there is room) the page's own text; its leader never crosses another leader or tag, and runs over as little of the model as possible. Placed tags stay put while the model turns; only the leaders follow their parts. When the model moves a long way (a new stage, a big zoom) the tags are laid out again and glide to their new places; a tag whose way would take it through another (two that swap sides) fades out where it is and in at its new place instead, so tags never pass over each other. A scene's `off` is only a hint for the side.

## Time

`timeline.ts` is the clock-free core. A step becomes a plan (`planStep`) that starts from the state the previous step settled in, and a plan plus a time becomes a complete frame to draw (`evaluate`). Because later steps start from the settled state, objects, ids and the camera carry across steps and across follow-up questions. Actions are applied in time order (`at`, then list order). Paths (`along`) are splines, and `reveal` and `explode` are ordinary tweens.

In real time (`player.ts`):

- Each step is spoken through the `Voice` adapter, and the step's drawing starts when the voice's `start` event fires.
- The step's clock is scaled to the voice's own estimate of how long it will speak, so the actions run over the utterance.
- The next step is spoken once its speech has ended and the step's drawing has finished.
- A voice that never starts does not stall the picture: after 2.5 s, or as soon as it reports the end, the drawing plays anyway.
- Steps may arrive while earlier ones play (`begin`, `step`, `end` messages): they queue. Running out of steps is not the end of the turn until `end` has come.
- `hush` stops the speech at once and drops queued steps; the step in progress finishes drawing.
- After the last step a model that is on screen turns slowly by itself (about 5 degrees a second after a pause, easing in) until the user takes hold of it or the scene fades; a follow-up carries on from where it got to.
- A new turn continues the picture on screen (a follow-up); the first turn of a question clears it first.

## Fading

When a turn has finished, the scene stays at full strength for `FADE_AFTER_MS` (set in `src/shared/ipc.ts`), then fades over 1.2 s, unless the pointer is on the model or the app's words; touching it starts the count again. A faded scene takes no clicks. It is hidden, not cleared, so a follow-up still reaches its ids; the next question or Clear removes it. `fade.ts` is the logic and is tested without a clock.

Dragging the model turns the camera (0.4 degrees a pixel). The drag is folded into the camera's tweens, so a camera action after it starts from where the camera is. The pointer region is the model's own bounding rectangle, so the page around it stays clickable.

## The pen

While the keys are held the main process sends `pen on` and the window takes the mouse. The page (`pen.ts`, plain state tested without a window) draws what is dragged as a red, round stroke with a faint dark outline, about half a percent of the longer side wide, and reports it with `stroke`: points on the 0 to 1000 scale, appended per stroke id, once per frame while drawing and once more when the button comes up (`done`). A click, or a twitch under 3 units, draws and reports nothing. While the pen is on the mouse never turns the model or clicks the app's own words, and the browser's own image drag is switched off (it would cancel the stroke). After `pen off` the stroke stays until the answer's first step (or the end, a notice, a clear or an idle status), then fades over 0.6 s; a new `pen on` removes it at once. It is never part of a scene, and the screenshot kept for image cards is the clean one.

## Looking at it without the app

`scripts/overlay-frames.cjs` renders a scene with the overlay page in a hidden, software-rendered Electron window and saves PNG frames, either at chosen moments (`--steps 2:1.5,5:3`) or by playing the scene in real time (`--play`):

```
npm run build
npx electron scripts/overlay-frames.cjs samples/scenes/pi-camera.json --out frames \
    --steps 0:3,4:3 --backdrop samples/pages/product.svg --tier mid
```

Offscreen windows always render at a device scale of 1; add `--hidden --dpr 2` to render in a hidden window at another scale (the PNG is then at physical size).

`samples/pages/` has backdrops drawn to the layouts the samples' marks were written against. A follow-up is rendered after its first scene with `--after samples/scenes/earth-layers.json`.

## Software rendering

The renderer works without a GPU: Electron with hardware acceleration off runs WebGL on the system's software rasteriser. The mid tier is meant for that; the high tier is judged on a real GPU.
