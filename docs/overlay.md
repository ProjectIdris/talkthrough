# The overlay renderer

The overlay page (`src/overlay/`) draws the scene language (see `scene-language.md`) over the display it covers and plays scenes sent by the main process. It draws what it is given and nothing else: every scene has already been through the validator, and strings are only ever drawn as text.

## Layers

From back to front inside the overlay window:

1. **Backdrop** (development and frame grabs only): an image shown behind everything.
2. **The panel frame**: a rounded, translucent rectangle (a DOM element) at the 3D panel's rectangle. It is the only part of the page that takes the pointer, so the rest stays click-through.
3. **The 3D canvas**: one WebGL canvas covering the display. The panel is a viewport on it with its own perspective camera, clipped to the frame.
4. **The marks canvas**: a 2D canvas covering the display, drawn in device pixels.

Scene coordinates run 0 to 1000 across each axis of the window, which covers the display that was captured, so no other mapping is needed. Every rectangle is snapped to physical pixels, so lines stay crisp at any display scaling (the page reads `devicePixelRatio`).

## What is drawn

- **Marks**: a box, an oval (`circle`), an underline, an arrow and a label. They draw themselves in over 0.4 s: a box or oval traces its outline, an underline grows, an arrow's shaft extends and its head pops in, a label fades and rises. Every mark has a dark halo so it reads on light and dark pages. `highlight` thickens and glows the outline.
- **The 3D panel**: solids, lines, arrows, camera-facing text and groups, lit by a hemisphere light and a light that travels with the camera. Translucent shells (nested spheres) draw largest first so the inner ones show through. `highlight` makes an object glow and swell briefly.
- **Tweens** ease in and out. A tween starts from wherever its property is when it begins, so overlapping and chained actions join up.

## Time

`timeline.ts` is the clock-free core. A step becomes a plan (`planStep`) that starts from the state the previous step settled in, and a plan plus a time becomes a complete frame to draw (`evaluate`). Because later steps start from the settled state, objects, ids and the camera carry across steps and across follow-up questions. Actions are applied in time order (`at`, then list order).

In real time (`player.ts`):

- Each step is spoken through the `Voice` adapter, and the step's drawing starts when the voice's `start` event fires.
- The step's clock is scaled to the voice's own estimate of how long it will speak, so the actions run over the utterance instead of by the assumed pace of 2.5 words a second.
- The next step is spoken once its speech has ended and its drawing has finished.
- A voice that never starts (none installed, or it fails) does not stall the picture: after 2.5 s, or as soon as it reports the end, the drawing plays anyway.
- With no system voice the player paces each step by its word count with a silent voice.
- A new scene continues the picture on screen (a follow-up); the first turn of a question clears it first.

Dragging the panel turns the camera (0.4 degrees a pixel). The drag is folded into the camera's tweens, so a camera action after it starts from where the camera is.

## Looking at it without the app

`scripts/overlay-frames.cjs` renders a scene with the overlay page in a hidden, software-rendered Electron window and saves PNG frames, either at chosen moments (`--steps 2:1.5,5:3`) or by playing the scene in real time (`--play`):

```
npm run build
npx electron scripts/overlay-frames.cjs samples/scenes/bar-chart.json --out frames \
    --steps 2:2.5,5:3.5 --backdrop samples/pages/bar-chart.svg
```

`samples/pages/` has a backdrop for each sample, drawn to the page layout the sample's marks were written against. A follow-up is rendered after its first scene with `--after samples/scenes/earth-layers.json`.

## Software rendering

The renderer works without a GPU: Electron with hardware acceleration off runs WebGL on the system's software rasteriser, and scenes are kept light (a few dozen objects).
