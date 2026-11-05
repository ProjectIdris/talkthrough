// The overlay page: draws the scene language over the display it covers and plays what the main
// process sends. A 3D model floats over the page on a WebGL canvas (lit by a room environment, with a
// soft shadow on the page); marks, tags pinned to parts, and cards are drawn on a 2D canvas above it.
// Everything is data-driven by validated scenes (see src/scene).

import { NeutralToneMapping, PMREMGenerator, SRGBColorSpace, VSMShadowMap, WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FADE_AFTER_MS } from '../shared/ipc.ts';
import type { DisplayInfo, SceneMessage } from '../shared/ipc.ts';
import type { Action, Scene } from '../scene/types.ts';
import type { Voice } from '../adapters/voice.ts';
import { createSpeechSynthesisVoice } from '../adapters/speech-synthesis-voice.ts';
import { createServerVoice } from './server-voice.ts';
import { timedVoice } from '../adapters/timed-voice.ts';
import { AutoFade, fadeFrame } from './fade.ts';
import { ACTION_LABELS, HudState, STATUS_LABELS } from './hud.ts';
import type { NoticeAction } from './hud.ts';
import { answerBox } from './answer-box.ts';
import { LabelBoard, Occupancy, busyFromGray } from './labels.ts';
import { snapperFor } from './page-gray.ts';
import { PageMemory } from './page-memory.ts';
import { THEME, fontAt } from './theme.ts';
import { Placer, cardFootprint, followDiagram, markFootprint, ownedByDiagram, ownedMarkIds, pageGrid, foreseePoints, placeAction, reserveMarks, settleMark, splitOwned } from './placement.ts';
import { snapToControl } from '../shared/controls.ts';
import type { ControlBox } from '../shared/controls.ts';
import { snapActions } from './snap.ts';
import type { Snapper } from './snap.ts';
import type { PageGrid } from './placement.ts';
import type { Busy } from './labels.ts';
import { StageGrowth, cardShows, panelRect } from './layout.ts';
import { createHold, modelButtonRects, overModel, wheelFactor } from './orbit.ts';
import { DiagramPainter } from './diagram-draw.ts';
import { drawMarks } from './marks.ts';
import type { View } from './marks.ts';
import { TIERS } from './materials.ts';
import { Finishing } from './post.ts';
import type { Tier } from './materials.ts';
import { PenLayer, drawPen, routePenPointer, undoPlace } from './pen.ts';
import { Player, VOICE_PATIENCE_MARGIN_MS, createSilentVoice } from './player.ts';
import { captionSpot, createCaptionDriver } from './captions.ts';
import type { CaptionDriver, CaptionState, Rect } from './captions.ts';
import { readingSeconds } from '../shared/captions.ts';
import { PanelScene } from './scene3d.ts';
import type { ScreenRect } from './scene3d.ts';
import type { Frame } from './timeline.ts';

const DRAG_DEGREES_PER_PIXEL = 0.4;
const params = new URLSearchParams(location.search);

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const backdropEl = byId<HTMLImageElement>('backdrop');
const frameEl = byId<HTMLDivElement>('panel');
const glCanvas = byId<HTMLCanvasElement>('gl');
const marksCanvas = byId<HTMLCanvasElement>('marks');
const statusEl = byId<HTMLDivElement>('status');
const offerEl = byId<HTMLDivElement>('offer');
const offerText = byId<HTMLSpanElement>('offer-text');
const offerButton = byId<HTMLButtonElement>('offer-button');
const noticeEl = byId<HTMLDivElement>('notice');
const explodeEl = byId<HTMLButtonElement>('explode');
const detailEl = byId<HTMLButtonElement>('detail');
const cutEl = byId<HTMLButtonElement>('cut');
const undoEl = byId<HTMLButtonElement>('undo');
const statusLabel = statusEl.querySelector('.lbl') as HTMLSpanElement;
const noticeDot = noticeEl.querySelector('.dot') as HTMLSpanElement;
const noticeText = byId<HTMLSpanElement>('notice-text');
const noticeAction = byId<HTMLButtonElement>('notice-action');
const answerEl = byId<HTMLDivElement>('answer');
const answerQuestion = byId<HTMLSpanElement>('answer-q');
const answerText = byId<HTMLParagraphElement>('answer-text');
const answerSpoken = byId<HTMLSpanElement>('answer-spoken');
const answerCopy = byId<HTMLButtonElement>('answer-copy');
const answerPin = byId<HTMLButtonElement>('answer-pin');
const answerClose = byId<HTMLButtonElement>('answer-close');
/** The label inside one of the capsule's segments. */
const labelOf = (el: HTMLElement): HTMLElement => el.querySelector('.lbl') as HTMLElement;
const marksCtx = marksCanvas.getContext('2d') as CanvasRenderingContext2D;

/** The quality tier: asked for in the page address, or chosen from what the graphics stack is. */
/** The name the graphics stack gives its renderer ('' when it will not say or there is no WebGL). */
function graphicsName(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  } catch {
    return '';
  }
}

function chooseTier(): Tier {
  const asked = params.get('tier');
  if (asked === 'low' || asked === 'mid' || asked === 'high') return asked;
  try {
    return /swiftshader|basic render|llvmpipe|software/i.test(graphicsName()) ? 'mid' : 'high';
  } catch {
    return 'low';
  }
}

const tier = chooseTier();
// Said once, for the app log of a check run: which tier, on what graphics, and whether the finishing pass is on.
console.info(`talkthrough: overlay tier ${tier} on ${graphicsName() || 'an unnamed renderer'}`);
const settings = TIERS[tier];
const renderer = new WebGLRenderer({ canvas: glCanvas, alpha: true, antialias: settings.msaa, premultipliedAlpha: true, stencil: true });
renderer.localClippingEnabled = true; // a model can be cut open (cutaway.ts)
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = NeutralToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.setClearColor(0x000000, 0);
renderer.autoClear = false;
renderer.shadowMap.enabled = settings.shadows;
// A variance map is blurred, so the edge of a shadow is smooth; the default filter's edge is grainy.
renderer.shadowMap.type = VSMShadowMap;

/** The high tier's occlusion and smoothing; absent on the others, and if the graphics stack will not run it. */
let finishing: Finishing | undefined;

const panelScene = new PanelScene({
  tier,
  makeCanvas: (width, height) => {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
  },
});
{
  const pmrem = new PMREMGenerator(renderer);
  panelScene.setEnvironment(pmrem.fromScene(new RoomEnvironment(), 0.04).texture, 0.8);
  pmrem.dispose();
}
if (tier === 'high') {
  try {
    finishing = new Finishing(renderer, panelScene.scene, panelScene.camera);
    console.info('talkthrough: high tier finishing pass on');
  } catch {
    finishing = undefined; // the plain render is the fallback
    console.info('talkthrough: high tier finishing pass unavailable, drawing plainly');
  }
}

/**
 * Speaks with the system voice, or paces steps silently where there is no speech synthesis at all.
 * The voice list is empty when the page starts and fills after the first utterance, so it is not
 * a test of whether speaking works; a voice that never answers is covered by the player's patience.
 */
function chooseVoice(): Voice {
  if (typeof speechSynthesis === 'undefined') return createSilentVoice();
  return timedVoice(createSpeechSynthesisVoice(), (line) => console.info(`talkthrough: ${line}`));
}

const hud = new HudState();
/** The screenshot being explained, held in memory only: replaced by the next one, dropped on clear. */
const shot = new Image();
const fader = new AutoFade(FADE_AFTER_MS);
const milestones = { mark: true, word: true };
let pendingOffer: string | undefined;

function milestone(what: 'first-mark' | 'first-word'): void {
  window.talkthrough.milestone({ what, at: Date.now() });
}

const player = new Player({
  voice: chooseVoice(),
  onDone: () => {
    window.talkthrough.done();
    // The quick answer can finish playing while a detail pass is still being waited for: the model stays until that arrives.
    if (detailState !== 'asked' && detailState !== 'running' && !guiding) fader.arm(performance.now());
    if (pendingOffer !== undefined) {
      hud.offer(pendingOffer);
      pendingOffer = undefined;
    }
    request();
  },
  onSpeechStart: () => {
    if (!milestones.word) {
      milestones.word = true;
      milestone('first-word');
    }
  },
});

let display: DisplayInfo | undefined;
/**
 * Where "More detail" is for this answer: offered (none), asked and not yet begun (asked), being drawn (running), or
 * done. Only a failure (a notice while asked or running) offers it again; a new question starts afresh.
 */
/** A guide walk is on (a step waits for the person's click, or the next is being made): the page stays until it ends. */
let guiding = false;
let detailState: 'none' | 'asked' | 'running' | 'done' = 'none';
let view: View = { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 };
/** Where the model is on screen (for the pointer), and the stage's frame when it has one. */
let modelRect: ScreenRect | undefined;
/** The model's card, when the panel is drawn in a frame: tags stay inside it. */
let cardRect: ScreenRect | undefined;
// Whether the window is solid for the pointer (orbit.ts): worked out from where the pointer is and where the model is.
const hold = createHold((over) => window.talkthrough.setInteractive(over, over ? keyRegion() : undefined));
let pointerX = -1, pointerY = -1;
let dragging = false;
let raf = 0;
let wake: ReturnType<typeof setTimeout> | undefined;

function resize(): void {
  const width = display?.bounds.width ?? window.innerWidth;
  const height = display?.bounds.height ?? window.innerHeight;
  const dpr = window.devicePixelRatio || display?.scaleFactor || 1;
  view = { width, height, dpr };
  document.documentElement.style.width = `${width}px`;
  document.documentElement.style.height = `${height}px`;
  renderer.setPixelRatio(Math.min(dpr, settings.maxPixelRatio));
  renderer.setSize(width, height);
  marksCanvas.width = Math.round(width * dpr);
  marksCanvas.height = Math.round(height * dpr);
  marksCanvas.style.width = `${width}px`;
  marksCanvas.style.height = `${height}px`;
  request();
}

const clampRect = (r: ScreenRect, pad: number): ScreenRect => {
  const x0 = Math.max(0, Math.floor(r.x - pad)), y0 = Math.max(0, Math.floor(r.y - pad));
  const x1 = Math.min(view.width, Math.ceil(r.x + r.w + pad)), y1 = Math.min(view.height, Math.ceil(r.y + r.h + pad));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
};

/** The system's "reduce motion" setting: marks then appear in one step instead of being drawn along like a pen stroke. */
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
reduceMotion.addEventListener('change', () => request());

/** How far the visible card has grown to hold the model this time it is up. */
const stageGrowth = new StageGrowth();

/** The stage's size in pixels this frame: tags are drawn smaller beside a small stage. */
let stageSize: { w: number; h: number } | undefined;
let lastDisplayedFrame: Frame | undefined;

function draw(frame: Frame): Frame {
  renderer.setScissorTest(false);
  renderer.clear();
  const rect = panelRect(frame.panel, view);
  modelRect = undefined;
  cardRect = undefined;
  stageSize = undefined;
  if (rect && frame.panel) {
    const { x, y, w, h, alpha } = rect;
    panelScene.sync(frame, w / h, { rect: { x, y, w, h }, width: view.width, height: view.height, now: labelClock() });
    stageSize = { w, h };
    const bounds = panelScene.screenBounds(view.width, view.height);
    // The card is not a frame the model is cut to: it grows to hold the whole model (see StageGrowth). The camera keeps the panel's own rectangle.
    const card = stageGrowth.card({ x, y, w, h }, bounds?.model, view) ?? { x, y, w, h };
    if (cardShows(frame.panel.frame, bounds?.model)) {
      frameEl.style.display = 'block';
      frameEl.style.left = `${card.x}px`;
      frameEl.style.top = `${card.y}px`;
      frameEl.style.width = `${card.w}px`;
      frameEl.style.height = `${card.h}px`;
      frameEl.style.opacity = String(alpha);
      // A frame over a light page is light, over a dark one dark, so it never reads as a black slab on a white article.
      const under = placer()?.brightness({ x: (card.x / view.width) * 1000, y: (card.y / view.height) * 1000, w: (card.w / view.width) * 1000, h: (card.h / view.height) * 1000 }) ?? 0;
      frameEl.classList.toggle('light', under > 150);
    } else {
      frameEl.style.display = 'none';
    }
    if (bounds) {
      modelRect = frame.panel.frame ? card : bounds.model;
      if (frame.panel.frame) cardRect = card;
      // Development: `?scissor=off` draws over the whole window, to see what the rectangle would cut (scripts/overlay-frames.cjs --scissor off).
      const r = params.get('scissor') === 'off' ? { x: 0, y: 0, w: view.width, h: view.height } : clampRect(bounds.drawn, 14);
      if (r.w > 0 && r.h > 0) {
        renderer.setViewport(0, 0, view.width, view.height);
        renderer.setScissor(r.x, view.height - r.y - r.h, r.w, r.h);
        renderer.setScissorTest(true);
        if (finishing?.fits(r)) {
          try {
            finishing.render(panelScene.scene, panelScene.camera, r, view);
          } catch {
            // The graphics stack would not run it: this tier goes on without, from the next frame.
            finishing.dispose();
            finishing = undefined;
            renderer.setRenderTarget(null);
            renderer.render(panelScene.scene, panelScene.camera);
          }
        } else {
          renderer.render(panelScene.scene, panelScene.camera);
        }
      }
    }
  } else {
    // No stage, or one too faint to see: nothing here may take the pointer.
    stageGrowth.card(undefined, undefined, view);
    frameEl.style.display = 'none';
    panelScene.sync(frame, 1);
  }
  placeExplode(frame);
  // Rehydrate from the current visible frame, then use the real grown-stage and button
  // rectangles rather than the panel requested earlier. Frame keys distinguish replacement.
  const p = placer();
  if (p) {
    const aspect = view.width / view.height;
    const source = cropSource();
    const sourceAspect = source ? source.width / source.height : aspect;
    const surfaces: Array<{ id: string; key: number; box: { x: number; y: number; w: number; h: number } }> = [];
    for (const m of frame.marks) if (m.appear > 0 && m.fade > 0 && (m.mark.op === 'card' || m.mark.op === 'image')) {
      const box = cardFootprint(m.mark, view.height, aspect, sourceAspect, p.captionMeasure())[0];
      if (box) surfaces.push({ id: m.id, key: m.key, box });
    }
    for (const d of frame.diagrams) if (d.appear > 0 && d.fade > 0) surfaces.push({ id: d.id, key: d.key, box: { x: d.def.x, y: d.def.y, w: d.def.w, h: d.def.h } });
    p.syncVisible(surfaces);
    if (modelRect) {
      const units = (r: {x: number; y: number; w: number; h: number}) => ({ x: r.x / view.width * 1000, y: r.y / view.height * 1000, w: r.w / view.width * 1000, h: r.h / view.height * 1000 });
      const visibleButtons = [explodeEl, cutEl, detailEl].flatMap((el) => {
        if (el.style.display === 'none' || el.style.display === '') return [];
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? [units({x:r.left, y:r.top, w:r.width, h:r.height})] : [];
      });
      p.syncRenderedStage(units(modelRect), visibleButtons);
    } else if (!frame.panel) p.setStage(undefined);
    for (const surface of surfaces) { const current = p.surface(surface.id); if (current) p.home(surface.id, surface.box, current); }
    frame = { ...frame,
      marks: frame.marks.map((m) => {
        const mark = m.mark;
        if (mark.op === 'card' || mark.op === 'image') {
          const current = p.surface(m.id);
          if (!current) return m;
          return { ...m, mark: mark.op === 'card' ? { ...mark, x: current.x, y: current.y } : { ...mark, dx: current.x, dy: current.y } };
        }
        if (!ownedMarks.has(m.id)) return m;
        const moved = followDiagram(p, mark, aspect);
        return moved ? { ...m, mark: moved as typeof m.mark } : m;
      }),
      diagrams: frame.diagrams.map((d) => { const current = p.surface(d.id); return current ? { ...d, def: { ...d.def, x: current.x, y: current.y } } : d; }),
    };
  }
  lastDisplayedFrame = frame;
  board.beginFrame({ width: view.width, height: view.height, model: modelRect, dragging, now: labelClock(), ...(cardRect ? { within: cardRect } : {}) });
  board.keep(new Set(frame.marks.filter((m) => m.mark.op === 'pin').map((m) => m.key)));
  const annotator = {
    view,
    ...(stageSize ? { stage: stageSize } : {}),
    place: (key: number, request: Parameters<typeof board.place>[1]) => board.place(key, request, labelEnvironment),
    project: (key: number, point: Parameters<typeof panelScene.project>[1], anchor?: Parameters<typeof panelScene.project>[4]) => panelScene.project(key, point, view.width, view.height, anchor),
    ...(cropSource() ? { source: cropSource()! } : {}),
  };
  // A mark that lies on a flat diagram (a ring on a chart's crossing, an arrow at a bar) is drawn above the diagram's opaque card, or it would be hidden by it.
  const { under, over } = splitOwned(frame.marks, ownedMarks);
  drawMarks(marksCtx, under, view, annotator, { reduceMotion: reduceMotion.matches });
  // The flat diagrams go over the marks' canvas in free space; a piece moved by a later arrival glides, which wants frames until it is there.
  diagramsMoving = frame.diagrams.length > 0 && diagramPainter.draw(marksCtx, frame.diagrams, view, labelClock());
  if (over.length > 0) drawMarks(marksCtx, over, view, annotator, { reduceMotion: reduceMotion.matches, append: true });
  drawPen(marksCtx, pen.view(labelClock(), { reduceMotion: reduceMotion.matches }), view);
  syncUndo();
  if (pointerX >= 0) hold.onHud(overHud(document.elementFromPoint(pointerX, pointerY))); // a button can fade under a resting pointer
  hold.model(modelRect);

  if (!milestones.mark && (frame.marks.some((m) => m.appear > 0) || frame.diagrams.some((d) => d.appear > 0) || frame.objects.some((o) => o.appear > 0))) {
    milestones.mark = true;
    milestone('first-mark');
  }
  return frame;
}

/** The image crops are taken from: the screenshot the model was given, else the development backdrop. */
function cropSource(): { image: CanvasImageSource; width: number; height: number } | undefined {
  for (const img of [shot, backdropEl]) if (img.complete && img.naturalWidth > 0) return { image: img, width: img.naturalWidth, height: img.naturalHeight };
  return undefined;
}

const board = new LabelBoard();
/** The ids of the marks that belong to a flat diagram (placement.ts): drawn over its card, where the rest stay under it. */
const ownedMarks = new Set<string>();
const diagramPainter = new DiagramPainter({
  onBounds: (id, box) => placer()?.publishSurface(id, { x: box.x / view.width * 1000, y: box.y / view.height * 1000, w: box.w / view.width * 1000, h: box.h / view.height * 1000 }),
  // A flow card that had to grow is placed again for its new size, off the page's text and figures (placement.ts).
  regrow: (id, want) => {
    const p = placer();
    if (!p) return want;
    const placed = p.regrow(id, { x: (want.x / view.width) * 1000, y: (want.y / view.height) * 1000, w: (want.w / view.width) * 1000, h: (want.h / view.height) * 1000 });
    return placed ? { x: (placed.x / 1000) * view.width, y: (placed.y / 1000) * view.height, w: (placed.w / 1000) * view.width, h: (placed.h / 1000) * view.height } : undefined;
  },
});
let diagramsMoving = false;
const pen = new PenLayer();
/** The question was cancelled with a right click and the button is still down: nothing the mouse does now reaches the page. */
let cancelling = false;
// Frame grabs (seek) step a clock of their own, one thirtieth of a second a grab, so a clip's tags move at the clip's pace.
let seekClock: number | undefined;
const labelClock = (): number => seekClock ?? performance.now();
// The screenshot element is reused for every capture, so what is worked out from the page is kept per picture and
// dropped when a new one arrives (handleScene), not told apart by the element.
const pageMemory = new PageMemory();

/** A small gray picture of the screenshot (or backdrop), kept for as long as it is the same picture. */
function pageFor(): { busy: Busy; grid: PageGrid } | undefined {
  const source = cropSource();
  if (!source) return undefined;
  return pageMemory.recall('page', source.image, '', () => grayPage(source));
}

function grayPage(source: { image: CanvasImageSource; width: number; height: number }): { busy: Busy; grid: PageGrid } | undefined {
  const cols = 192, rows = 108;
  // Shrunk in halves, so thin text blurs into a tone instead of being skipped over by a single big step.
  let from: CanvasImageSource = source.image;
  let fw = source.width, fh = source.height;
  while (fw > cols * 2 && fh > rows * 2) {
    const step = document.createElement('canvas');
    step.width = Math.max(cols, Math.ceil(fw / 2));
    step.height = Math.max(rows, Math.ceil(fh / 2));
    const sc = step.getContext('2d');
    if (!sc) return undefined;
    sc.imageSmoothingQuality = 'high';
    sc.drawImage(from, 0, 0, step.width, step.height);
    from = step;
    fw = step.width;
    fh = step.height;
  }
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const c = canvas.getContext('2d', { willReadFrequently: true });
  if (!c) return undefined;
  c.imageSmoothingQuality = 'high';
  c.drawImage(from, 0, 0, cols, rows);
  const data = c.getImageData(0, 0, cols, rows).data;
  const gray = new Uint8Array(cols * rows);
  for (let i = 0; i < gray.length; i++) gray[i] = (data[i * 4] as number) * 0.3 + (data[i * 4 + 1] as number) * 0.59 + (data[i * 4 + 2] as number) * 0.11;
  return { busy: busyFromGray(gray, cols, rows, view.width, view.height), grid: pageGrid(gray, cols, rows) };
}

/** How busy each part of the page is, from the screenshot (or backdrop): tags keep off its text. */
const busyMap = (): Busy | undefined => pageFor()?.busy;

let previousPlacer: Placer | undefined;

/** Where the stage and the cards go on this page (placement.ts); there is none without a picture of the page. */
function placer(): Placer | undefined {
  const page = pageFor();
  const source = cropSource();
  if (!page || !source) return undefined;
  const aspect = view.width / view.height;
  const p = pageMemory.recall('placer', source.image, `${aspect}:${view.height}`, () => {
    const next = new Placer(page.grid, { aspect, height: view.height, sourceAspect: source.width / source.height, measureCaption: (text) => { marksCtx.save(); marksCtx.font = fontAt(THEME.font, Math.max(13, view.height * 0.018)); const width = marksCtx.measureText(text).width; marksCtx.restore(); return width; }, onImpossible: () => console.warn('talkthrough: placement cannot fit all surfaces or targets') });
    if (lastDisplayedFrame) {
      if (previousPlacer) next.restore(previousPlacer.snapshot());
      else {
      const surfaces: Array<{id: string; key: number; box: {x: number; y: number; w: number; h: number}}> = [];
      for (const m of lastDisplayedFrame.marks) if (m.appear > 0 && m.fade > 0 && (m.mark.op === 'card' || m.mark.op === 'image')) { const b = cardFootprint(m.mark, view.height, aspect, source.width / source.height, next.captionMeasure())[0]; if (b) surfaces.push({id: m.id, key: m.key, box: b}); }
      for (const d of lastDisplayedFrame.diagrams) if (d.appear > 0 && d.fade > 0) surfaces.push({id: d.id, key: d.key, box: {x:d.def.x, y:d.def.y, w:d.def.w, h:d.def.h}});
      next.syncVisible(surfaces);
      if (lastDisplayedFrame.panel) next.setStage(lastDisplayedFrame.panel.rect);
      }
    }
    return next;
  });
  p.setControls(realControls);
  previousPlacer = p;
  return p;
}

/** The page's edges and corners, for putting marks on what they point at (snap.ts); kept for as long as the picture is the same. */
function snapper(): Snapper | undefined {
  const source = cropSource();
  if (!source) return undefined;
  return pageMemory.recall('snapper', source.image, '', () => snapperFor(source.image, source.width, source.height));
}

/**
 * The window's real controls (main/uia.ts), when the system gave them: they arrive after the screenshot they belong to,
 * usually before the first mark, and are dropped with the next screenshot. Empty: marks snap to the picture alone.
 */
let realControls: ControlBox[] = [];

/**
 * Marks moved onto what they point at: first a real control (a button, tab or menu item) when the system described
 * the window and the mark was aimed at one, otherwise the page's own lines, corners and figures from the picture.
 * Each move is said once in the app log (a check run reads it).
 */
function snappedActions(actions: readonly Action[]): Action[] {
  const aspect = view.width / view.height;
  const s = snapper();
  return actions.map((a) => {
    const c = realControls.length > 0 ? snapToControl(a, realControls, aspect) : undefined;
    if (c) {
      if ('id' in a && typeof a.id === 'string') console.info(`talkthrough: control-snapped ${a.op} ${a.id} by ${Math.round(c.moved * 10) / 10} units (${c.kind})`);
      return c.action;
    }
    return s ? snapActions(s, [a], (r) => console.info(`talkthrough: snapped ${r.op} ${r.id} by ${r.moved} units`))[0] as Action : a;
  });
}

function labelEnvironment(): { occ: Occupancy; busy?: Busy } {
  const occ = new Occupancy(view.width, view.height);
  for (const hull of panelScene.silhouette(view.width, view.height)) occ.fillConvex(hull);
  // The buttons beside the model are not for a tag to sit on.
  for (const el of [explodeEl, cutEl, detailEl]) {
    if (el.style.display === 'none') continue;
    const x = parseFloat(el.style.left) || 0, y = parseFloat(el.style.top) || 0;
    const w = el.offsetWidth || 90, h = el.offsetHeight || 32;
    occ.fillConvex([{ x: x - 4, y: y - 4 }, { x: x + w + 4, y: y - 4 }, { x: x + w + 4, y: y + h + 4 }, { x: x - 4, y: y + h + 4 }]);
  }
  const busy = busyMap();
  const keepOut = buttonKeepOut();
  return { occ, ...(busy ? { busy } : {}), ...(keepOut.length > 0 ? { keepOut } : {}) };
}

/** What the buttons beside the model will cover once they show (they come when the model is finished, after its tags are placed): no tag sits there. */
function buttonKeepOut(): ScreenRect[] {
  if (!modelRect) return [];
  const rects = modelButtonRects(modelRect, view, buttonSizes());
  return [rects.explode, rects.cut, ...(rects.detail ? [rects.detail] : [])];
}

function buttonSizes(): { explode: { w: number; h: number }; cut: { w: number; h: number }; detail?: { w: number; h: number } } {
  return {
    explode: { w: explodeEl.offsetWidth || 104, h: explodeEl.offsetHeight || 32 },
    cut: { w: cutEl.offsetWidth || 70, h: cutEl.offsetHeight || 32 },
    ...(display?.detail && detailState === 'none' ? { detail: { w: detailEl.offsetWidth || 124, h: detailEl.offsetHeight || 32 } } : {}),
  };
}

/** What the button on the notice on screen does (it is the notice's own: 'hearing' or 'settings'). */
let noticeActionKind: NoticeAction | undefined;

function showHud(): void {
  const now = performance.now();
  const v = hud.view(now);
  statusEl.className = v.status === 'idle' ? '' : v.status;
  statusEl.style.display = v.status === 'idle' ? 'none' : 'flex';
  if (v.status !== 'idle' && statusLabel.textContent !== STATUS_LABELS[v.status]) statusLabel.textContent = STATUS_LABELS[v.status];
  if (v.offer === null) {
    offerEl.style.display = 'none';
  } else {
    offerEl.style.display = 'flex';
    if (offerText.textContent !== `I can ask a deeper helper: ${v.offer}`) offerText.textContent = `I can ask a deeper helper: ${v.offer}`;
  }
  if (v.notice === null) {
    noticeEl.style.display = 'none';
    noticeActionKind = undefined;
  } else {
    noticeEl.style.display = 'flex';
    noticeEl.className = `${v.notice.level}${v.notice.action ? ' hasaction' : ''}`;
    noticeDot.className = `dot ${v.notice.level === 'error' ? 'err' : v.notice.level === 'warning' ? 'warn' : ''}`;
    noticeEl.style.opacity = String(v.notice.alpha);
    if (noticeText.textContent !== v.notice.text) noticeText.textContent = v.notice.text;
    noticeActionKind = v.notice.action;
    if (v.notice.action && noticeAction.textContent !== ACTION_LABELS[v.notice.action]) noticeAction.textContent = ACTION_LABELS[v.notice.action];
  }
}

/** The model's region in page pixels, with its buttons: what main checks the real cursor against before it lets the page keep the E key. */
function keyRegion(): { x: number; y: number; w: number; h: number } | undefined {
  if (!modelRect) return undefined;
  let x0 = modelRect.x, y0 = modelRect.y, x1 = modelRect.x + modelRect.w, y1 = modelRect.y + modelRect.h;
  for (const el of [explodeEl, cutEl, detailEl]) {
    if (el.style.display === 'none' || el.style.display === '') continue;
    const r = el.getBoundingClientRect();
    x0 = Math.min(x0, r.left);
    y0 = Math.min(y0, r.top);
    x1 = Math.max(x1, r.right);
    y1 = Math.max(y1, r.bottom);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ---- Captions ----------------------------------------------------------------------------------------------------------------------

const captionEl = byId<HTMLDivElement>('caption');
let captionDriver: CaptionDriver | undefined;
let captionState: CaptionState | null = null;
let captionDrawn = { text: '', upTo: -1 };
let captionAt: { x: number; y: number } | undefined;
/** How long the words stay once the step has been said (or read), and how long they take to go. */
const CAPTION_HOLD_MS = 6000;
const CAPTION_FADE_MS = 500;

/** What the person chose (settings): voice only shows no words; text only speaks nothing and keeps each step up for its reading time. */
let captionMode: string | undefined;
function setCaptions(mode: 'voice' | 'text' | 'both'): void {
  if (mode === captionMode) return;
  captionMode = mode;
  captionDriver = mode === 'voice' ? undefined : createCaptionDriver({ mode, onChange: (s) => { captionState = s; box.words(s); request(); } });
  player.setCaptions(captionDriver);
  if (mode === 'text') player.setVoice(createSilentVoice(undefined, readingSeconds));
}

/** What the caption keeps clear of, in pixels: the marks and diagrams on screen, the model, the buttons, the status pills. */
function captionKeepOut(frame: Frame): Rect[] {
  const out: Rect[] = [];
  const aspect = view.width / view.height;
  const px = (b: { x: number; y: number; w: number; h: number }): Rect => ({ x: (b.x / 1000) * view.width, y: (b.y / 1000) * view.height, w: (b.w / 1000) * view.width, h: (b.h / 1000) * view.height });
  for (const m of frame.marks) if (m.appear > 0.05 && m.fade > 0.05) for (const b of markFootprint(m.mark, aspect)) out.push(px(b));
  const source = cropSource();
  for (const m of frame.marks) if (m.appear > 0.05 && m.fade > 0.05) for (const b of cardFootprint(m.mark, view.height, aspect, source ? source.width / source.height : aspect, placer()?.captionMeasure())) out.push(px(b));
  for (const d of frame.diagrams) if (d.appear > 0.05 && d.fade > 0.05) out.push(px(d.def));
  out.push(...board.shownRects());
  if (modelRect) out.push(modelRect);
  for (const el of [explodeEl, cutEl, detailEl, statusEl, offerEl, noticeEl, undoEl]) {
    if (el.style.display === 'none' || el.style.display === '') continue;
    const r = el.getBoundingClientRect();
    out.push({ x: r.left, y: r.top, w: r.width, h: r.height });
  }
  return out;
}

/** Draws the caption: the words said so far, in the pill that is sized for the whole sentence, clear of the marks; it goes a while after the step ends. */
function showCaption(frame: Frame): void {
  const s = captionState;
  if (answerShown || !s || s.upTo <= 0) {
    if (captionEl.style.display !== 'none') captionEl.style.display = 'none';
    captionDrawn = { text: '', upTo: -1 };
    captionAt = undefined;
    return;
  }
  const now = performance.now();
  let alpha = 1;
  if (s.endedAt !== undefined) {
    const late = now - s.endedAt - CAPTION_HOLD_MS;
    if (late >= CAPTION_FADE_MS) {
      captionDriver?.clear();
      return;
    }
    if (late > 0) alpha = 1 - late / CAPTION_FADE_MS;
  }
  if (captionDrawn.text !== s.text || captionDrawn.upTo !== s.upTo) {
    const said = document.createElement('span');
    said.textContent = s.text.slice(0, s.upTo);
    const rest = document.createElement('span');
    rest.className = 'off';
    rest.textContent = s.text.slice(s.upTo);
    captionEl.replaceChildren(said, rest);
    if (captionDrawn.text !== s.text) captionAt = undefined;
    captionDrawn = { text: s.text, upTo: s.upTo };
  }
  captionEl.style.display = 'block';
  captionEl.style.opacity = String(alpha);
  const at = captionSpot(view, { w: captionEl.offsetWidth, h: captionEl.offsetHeight }, captionKeepOut(frame), captionAt);
  captionAt = at;
  captionEl.style.left = `${at.x}px`;
  captionEl.style.top = `${at.y}px`;
}

// ---- The answer box -----------------------------------------------------------------------------------------------------------------

/** An answer with no drawing is shown as words in a box (see answer-box.ts); this is its state. */
const box = answerBox();
let answerShown = false;
let boxDrawn = '';
let boxCopied = 0;

/** A words-only answer is on screen now, in its box: the page reports it as something that is up (so Escape and the like treat it as a drawing). */
function textBoxUp(): boolean {
  return answerShown;
}

function showAnswer(): void {
  const k = fader.alpha(performance.now());
  const shown = captionMode !== undefined && captionMode !== 'voice' && box.visible() && k > 0;
  answerShown = shown;
  if (!shown) {
    if (answerEl.style.display !== 'none') answerEl.style.display = 'none';
    boxDrawn = '';
    return;
  }
  const view = box.view();
  const key = JSON.stringify([view.question, view.said, view.rest, captionMode]);
  if (key !== boxDrawn) {
    boxDrawn = key;
    answerQuestion.textContent = view.question || 'Your question';
    const said = document.createElement('span');
    said.textContent = view.said;
    const rest = document.createElement('span');
    rest.className = 'off';
    rest.textContent = view.rest;
    answerText.replaceChildren(said, rest);
    answerSpoken.textContent = captionMode === 'both' ? 'Spoken as well' : 'Shown only, not spoken';
  }
  answerEl.style.display = 'block';
  answerEl.style.opacity = String(k);
  // The offer card sits at the bottom right too: the box goes above it.
  answerEl.style.bottom = `${offerEl.style.display === 'flex' ? 28 + offerEl.offsetHeight + 14 : 44}px`;
  const copied = performance.now() < boxCopied;
  if (answerCopy.textContent !== (copied ? 'Copied' : 'Copy')) answerCopy.textContent = copied ? 'Copied' : 'Copy';
}

/** Milliseconds until the caption next changes by itself (it starts to go), or undefined. */
function captionUntilChange(now: number): number | undefined {
  const s = captionState;
  if (!s || s.endedAt === undefined) return undefined;
  return Math.max(0, s.endedAt + CAPTION_HOLD_MS - now);
}

/** Shows the Explode / Assemble control at the corner of a finished model with parts to spread, and hides it otherwise. */
function placeExplode(frame: Frame): void {
  if (!modelRect || !player.settled || frame.objects.length < 2 || pen.active) {
    explodeEl.style.display = 'none';
    detailEl.style.display = 'none';
    cutEl.style.display = 'none';
    return;
  }
  explodeEl.style.display = 'flex';
  cutEl.style.display = 'flex';
  const label = player.exploded ? 'Assemble' : 'Explode';
  if (labelOf(explodeEl).textContent !== label) labelOf(explodeEl).textContent = label;
  const rects = modelButtonRects(modelRect, view, buttonSizes());
  explodeEl.style.left = `${rects.explode.x}px`;
  explodeEl.style.top = `${rects.explode.y}px`;
  // Cut touches Explode on its right, and More detail touches Cut: one capsule.
  const cutLabel = player.cut ? 'Whole' : 'Cut';
  if (labelOf(cutEl).textContent !== cutLabel) labelOf(cutEl).textContent = cutLabel;
  cutEl.style.left = `${rects.cut.x}px`;
  cutEl.style.top = `${rects.cut.y}px`;
  // "More detail" is the last segment, once per answer, and only where a detail model is set up.
  const withDetail = Boolean(display?.detail) && detailState === 'none';
  explodeEl.classList.add('first');
  explodeEl.classList.remove('last');
  cutEl.classList.toggle('last', !withDetail);
  detailEl.classList.add('last');
  if (!withDetail) {
    detailEl.style.display = 'none';
    return;
  }
  detailEl.style.display = 'flex';
  const place = rects.detail;
  if (place) {
    detailEl.style.left = `${place.x}px`;
    detailEl.style.top = `${place.y}px`;
  }
}

/** The buttons the page shows, by the name main knows them by. */
const buttonEls: Array<[string, HTMLElement]> = [['offer', offerButton], ['explode', explodeEl], ['cut', cutEl], ['detail', detailEl], ['fix', noticeAction], ['copy', answerCopy], ['pin', answerPin], ['close', answerClose]];
let lastButtons = '';
/**
 * Tells main where the buttons are, when that changes. The window is click-through and learns the pointer is over a button only
 * from a mouse move, so a click with none before it would go to the app beneath: main lays a small window of its own over each
 * button, and the press comes back as a 'press' message.
 */
function reportButtons(): void {
  const list: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
  for (const [id, el] of buttonEls) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) list.push({ id, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  }
  const text = JSON.stringify(list);
  if (text === lastButtons) return;
  lastButtons = text;
  window.talkthrough.buttons(list);
}

/** A catcher over a button was pressed: do what a click on the button does (if it is still there). */
function pressButton(id: string): void {
  const el = buttonEls.find(([name]) => name === id)?.[1];
  if (el && el.getBoundingClientRect().width > 0) el.click();
}

function clearEverything(): void {
  pen.fade(labelClock());
  shot.removeAttribute('src');
  player.clear();
  lastDisplayedFrame = undefined;
  fader.disarm();
  hud.reset();
  pendingOffer = undefined;
  detailState = 'none';
  guiding = false;
}

function loop(): void {
  raf = 0;
  const now = performance.now();
  let frame = player.update();
  const k = fader.alpha(now);
  if (k <= 0 && player.idling) player.stopIdle();
  if (fader.dismissed && k <= 0) {
    clearEverything(); // Escape: the quick fade is over, the drawing goes
    frame = player.update();
  }
  if (k < 1) frame = fadeFrame(frame, k);
  reportShowing(frame, k);
  frame = draw(frame);
  showAnswer();
  showCaption(frame);
  if (pen.active) sendPen();
  showHud();
  reportButtons();
  const fading = fader.armed && k < 1 && k > 0;
  const captionFading = captionState?.endedAt !== undefined && now > captionState.endedAt + CAPTION_HOLD_MS;
  if (player.active || dragging || fading || board.moving || diagramsMoving || panelScene.fitting || captionFading || pen.animating(labelClock(), { reduceMotion: reduceMotion.matches }) || pen.active) {
    request();
    return;
  }
  // Nothing is moving: wake up only when the next thing is due (the scene starting to fade, a notice going).
  const due = [fader.untilChange(now), hud.untilChange(now), captionUntilChange(now)].filter((n): n is number => n !== undefined);
  if (due.length) {
    if (wake) clearTimeout(wake);
    wake = setTimeout(request, Math.max(16, Math.min(...due) + 16));
  }
}

function request(): void {
  if (!raf) raf = requestAnimationFrame(loop);
}

/** Whether a drawing of an answer is up, told to the program so the Escape key is ours only while it is (and given back the moment it is not). Said again every second while it is: the program lets it lapse if the page goes quiet. */
let showingSent = false;
function reportShowing(frame: Frame, k: number): void {
  const up = k > 0 && (frame.panel !== null || frame.marks.length > 0 || frame.diagrams.length > 0 || frame.objects.length > 0 || textBoxUp());
  if (up === showingSent) return;
  showingSent = up;
  window.talkthrough.showing(up);
}
setInterval(() => {
  if (showingSent) window.talkthrough.showing(true);
}, 1000);

const interactiveEls: HTMLElement[] = [offerEl, noticeEl, explodeEl, cutEl, detailEl, answerEl];

/** True for a moment after the pen goes off, so a button released then still ends its stroke. */
let penEnding = false;
/** The pointer the pen's stroke holds, so it can be let go when the keys come up with the button still down. */
let penPointer: number | undefined;

/** Ends any stroke in progress and lets go of the pointer, whichever way the press ended. */
function endPenStroke(): void {
  pen.up();
  sendPen();
  if (penPointer !== undefined && document.documentElement.hasPointerCapture(penPointer)) document.documentElement.releasePointerCapture(penPointer);
  penPointer = undefined;
  request();
}

const overHud = (target: EventTarget | null): boolean => interactiveEls.some((el) => el.style.display !== 'none' && target instanceof Node && el.contains(target));
document.addEventListener('mousemove', (e) => {
  pointerX = e.clientX;
  pointerY = e.clientY;
  const hudHover = overHud(e.target);
  if (overModel(modelRect, e.clientX, e.clientY) || hudHover) {
    if (fader.armed) {
      fader.touch(performance.now());
      request();
    }
  }
  hold.pointer(e.clientX, e.clientY, hudHover);
});

const toScale = (e: PointerEvent): [number, number] => [(e.clientX / view.width) * 1000, (e.clientY / view.height) * 1000];
/** Sends what the pen has drawn since the last send (once per frame while drawing, and at once when the stroke ends). */
function sendPen(): void {
  for (const piece of pen.take()) window.talkthrough.stroke(piece);
}
// A press on the page must never start the browser's own drag of an image or text: it would cancel the pen's stroke.
document.addEventListener('dragstart', (e) => e.preventDefault());
/** Shows the Undo button beside the last circle while the chord is held and a circle is there to take back; hides it otherwise (and while one is being drawn). */
function syncUndo(): void {
  const box = pen.canUndo && !pen.drawing && !cancelling ? pen.lastBox() : undefined;
  if (!box) {
    if (undoEl.style.display !== 'none') undoEl.style.display = 'none';
    return;
  }
  undoEl.style.display = 'flex';
  const at = undoPlace(box, view, { w: undoEl.offsetWidth || 70, h: undoEl.offsetHeight || 30 });
  undoEl.style.left = `${Math.round(at.x)}px`;
  undoEl.style.top = `${Math.round(at.y)}px`;
}
/** Takes back the last circle (the Undo button), and tells the main process to drop it. */
function undoCircle(): void {
  if (!pen.undo()) return;
  sendPen();
  request();
}
undoEl.addEventListener('click', (e) => {
  e.stopPropagation();
  undoCircle();
});
// No menu of the page's own, and no other button, ever acts while the pen is on or has just been cancelled.
document.addEventListener('contextmenu', (e) => {
  if (pen.active || cancelling || penEnding) e.preventDefault();
});
document.addEventListener('pointerdown', (e) => {
  if (cancelling) {
    e.preventDefault();
    return;
  }
  if (pen.active) {
    // While the chord is held the mouse draws; it never turns the model or clicks the app's own words.
    const route = routePenPointer({ button: e.button, onUndo: e.target instanceof Node && undoEl.contains(e.target) });
    if (route.consume) e.preventDefault();
    if (route.act === 'cancel') {
      // A right click: the whole question is cancelled. The drawing goes at once; the window keeps the mouse until the button is up.
      cancelling = true;
      pen.cancel();
      if (penPointer !== undefined && document.documentElement.hasPointerCapture(penPointer)) document.documentElement.releasePointerCapture(penPointer);
      penPointer = undefined;
      undoEl.style.display = 'none';
      window.talkthrough.cancel(false);
      request();
      return;
    }
    if (route.act !== 'draw') return;
    document.documentElement.setPointerCapture(e.pointerId);
    penPointer = e.pointerId;
    pen.down(...toScale(e), labelClock());
    request();
    return;
  }
  if (e.button !== 0 || !overModel(modelRect, e.clientX, e.clientY)) return;
  dragging = true;
  hold.drag(true);
  player.stopIdle(); // the slow turn stops while the model is held
  window.talkthrough.engage(true);
  document.body.classList.add('dragging');
  document.documentElement.setPointerCapture(e.pointerId);
  request();
});
document.addEventListener('pointermove', (e) => {
  if (pen.active) {
    pen.move(...toScale(e), labelClock());
    request();
    return;
  }
  if (!dragging) return;
  player.dragCamera(-e.movementX * DRAG_DEGREES_PER_PIXEL, e.movementY * DRAG_DEGREES_PER_PIXEL);
  if (fader.armed) fader.touch(performance.now());
  request();
});
const endDrag = (e: PointerEvent): void => {
  if (cancelling) {
    if (e.button === 2) {
      cancelling = false;
      window.talkthrough.cancel(true);
    }
    e.preventDefault();
    return;
  }
  if (pen.active || penEnding) {
    endPenStroke();
    return;
  }
  if (!dragging) return;
  // However this ends, the model is let go and click-through is worked out again from where the pointer is.
  try {
    if (document.documentElement.hasPointerCapture(e.pointerId)) document.documentElement.releasePointerCapture(e.pointerId);
  } finally {
    dragging = false;
    document.body.classList.remove('dragging');
    hold.pointer(e.clientX, e.clientY, overHud(document.elementFromPoint(e.clientX, e.clientY)));
    hold.drag(false);
    request();
  }
};
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);
// Capture lost some other way (the window went click-through under a held button): the stroke ends there.
document.documentElement.addEventListener('lostpointercapture', () => {
  if (penPointer !== undefined) endPenStroke();
});

// The wheel zooms the model, a double click puts the camera back (and closes the model), E opens and closes it.
document.addEventListener('wheel', (e) => {
  if (pen.active || dragging || !overModel(modelRect, e.clientX, e.clientY)) return;
  e.preventDefault();
  player.zoomCamera(wheelFactor(e.deltaY, e.deltaMode));
  if (fader.armed) fader.touch(performance.now());
  request();
}, { passive: false });
document.addEventListener('dblclick', (e) => {
  if (pen.active || !overModel(modelRect, e.clientX, e.clientY)) return;
  player.resetCamera();
  if (fader.armed) fader.touch(performance.now());
  request();
});
const toggleExplode = (): void => {
  player.toggleExplode();
  if (fader.armed) fader.touch(performance.now());
  request();
};
explodeEl.addEventListener('pointerdown', () => window.talkthrough.engage(true));
explodeEl.addEventListener('click', toggleExplode);
// "More detail": one request per answer; the button goes, and the status says it is working until the richer scene has arrived.
detailEl.addEventListener('click', () => {
  detailState = 'asked';
  detailEl.style.display = 'none';
  hold.release();
  window.talkthrough.detail();
  request();
});
cutEl.addEventListener('click', () => {
  player.toggleCut();
  if (fader.armed) fader.touch(performance.now());
  request();
});
// While the pointer is on the model the page keeps saying so; if the page goes quiet, main lets clicks through again.
// The buttons come and go under a resting pointer, and the model can fade or be cleared there, so each beat looks again.
setInterval(() => {
  hold.onHud(overHud(document.elementFromPoint(pointerX, pointerY)));
  hold.beat();
}, 3000);

offerButton.addEventListener('click', () => {
  hud.dismissOffer();
  window.talkthrough.offer();
  hold.release();
  request();
});
noticeEl.addEventListener('click', (e) => {
  if (e.target instanceof Node && noticeAction.contains(e.target)) return; // the button has its own
  hud.dismissNotice();
  hold.release();
  request();
});
// The button on a notice does what the notice says is needed: open the settings window (at its hearing section, for a fault of hearing).
noticeAction.addEventListener('click', () => {
  const what = noticeActionKind;
  if (!what) return;
  hud.dismissNotice();
  hold.release();
  window.talkthrough.action({ what });
  request();
});
// The words-only answer: copy the words, pin the answer, or close the box.
answerCopy.addEventListener('click', () => {
  window.talkthrough.action({ what: 'copy', text: box.fullText() });
  boxCopied = performance.now() + 1500;
  setTimeout(request, 1600);
  request();
});
answerPin.addEventListener('click', () => {
  window.talkthrough.action({ what: 'pin' });
  request();
});
answerClose.addEventListener('click', () => {
  box.close();
  hold.release();
  request();
});

/** Resolves after the next frame has been painted (two animation frames). */
const painted = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function beginTurn(turn: number, detail = false): void {
  seekClock = undefined;
  fader.disarm();
  // A detail pass adds to what is on screen: nothing is cleared, and the offer and notices stay as they are.
  if (detail) return;
  hud.newTurn();
  pendingOffer = undefined;
  detailState = 'none';
  guiding = false;
  // The first turn of a question starts clean; later turns continue it, keeping objects and ids.
  if (turn <= 1) { player.clear(); lastDisplayedFrame = undefined; placer()?.release('all'); }
  milestones.mark = false;
  milestones.word = false;
}

/** The scene with its stage and cards moved off the page's text and off what it points at (placement.ts). */
function placedScene(scene: Scene): Scene {
  const p = placer();
  if (!p) return scene;
  p.reset();
  if (!lastDisplayedFrame) p.setStage(undefined);
  const aspect = view.width / view.height;
  if (!lastDisplayedFrame) ownedMarks.clear();
  const source = cropSource();
  const sourceAspect = source ? source.width / source.height : aspect;
  for (const id of ownedMarkIds(scene.steps, aspect, view.height, sourceAspect, p.captionMeasure())) ownedMarks.add(id);
  // A mark written after a flat diagram and inside the rectangle it was asked for belongs to it (it is not snapped to the page or kept clear of), and goes with it.
  const owned = ownedByDiagram(scene.steps, aspect, view.height, sourceAspect, p.captionMeasure());
  const snapped = scene.steps.map((step, i) => ({ ...step, actions: step.actions.map((a, j) => (owned[i]![j] ? a : (snappedActions([a])[0] as Action))) }));
  snapped.forEach((step, i) => reserveMarks(p, step.actions.filter((_, j) => !owned[i]![j]), aspect));
  const placed = snapped.map((step) => ({ ...step, actions: step.actions.map((a) => placeAction(p, a, view.height)) }));
  // The points of a step are known to its names before they are marked (so a name written first finds its point); the next step's are not.
  return { ...scene, steps: placed.map((step, i) => { foreseePoints(p, step.actions, aspect); return { ...step, actions: step.actions.map((a, j) => settleMark(p, owned[i]![j] ? followDiagram(p, a, aspect) ?? a : a)) }; }) };
}

function placedAction(action: Action): Action {
  const p = placer();
  if (!p) return action;
  const following = followDiagram(p, action, view.width / view.height);
  if (following) {
    if ('id' in following && typeof following.id === 'string') ownedMarks.add(following.id);
    return settleMark(p, following);
  }
  if ('id' in action && typeof action.id === 'string') ownedMarks.delete(action.id);
  const [snapped] = snappedActions([action]) as [Action];
  reserveMarks(p, [snapped], view.width / view.height);
  return settleMark(p, placeAction(p, snapped, view.height));
}

/**
 * While the screenshot (or the backdrop) is still being decoded, the scene's messages wait for it, so the first
 * stage and card are placed against the real page and not put down and moved afterwards.
 */
let pageDecoding = false;
const heldScene: SceneMessage[] = [];
const WAITS_FOR_PAGE = new Set(['play', 'begin', 'step', 'step-open', 'action', 'step-close', 'end', 'seek']);
function waitForPage(image: HTMLImageElement): void {
  if (!image.src || image.complete) return;
  pageDecoding = true;
  const release = (): void => {
    if (!pageDecoding) return;
    pageDecoding = false;
    // Worked out now, while the model is still thinking, not when the first mark is due.
    if (image.complete && image.naturalWidth > 0) { placer(); snapper(); }
    for (const held of heldScene.splice(0)) handleScene(held);
  };
  void image.decode().then(release, release);
  setTimeout(release, 1500);
}

function handleScene(message: SceneMessage): void {
  if (message.kind === 'screenshot') {
    shot.onload = () => request();
    pageMemory.renew(); // the same element holds every capture: what was worked out from the last one is out of date
    realControls = []; // and so is the window's list of controls
    shot.src = message.url;
    waitForPage(shot);
    return;
  }
  if (message.kind === 'controls') {
    realControls = message.boxes;
    console.info(`talkthrough: ${message.boxes.length} real controls`);
    return;
  }
  if (message.kind === 'clear') heldScene.length = 0;
  if (pageDecoding && WAITS_FOR_PAGE.has(message.kind)) {
    heldScene.push(message);
    return;
  }
  applyScene(message);
}

function applyScene(message: SceneMessage): void {
  switch (message.kind) {
    case 'play':
      beginTurn(message.turn);
      box.reset('');
      if (message.scene.steps.some((step) => step.actions.length > 0)) box.drew();
      box.stepClosed();
      milestones.mark = true;
      milestones.word = true;
      player.play(placedScene(message.scene));
      break;
    case 'pen':
      if (message.on) {
        penEnding = false;
        cancelling = false;
        pen.turnOn();
      } else {
        pen.turnOff();
        sendPen();
        if (penPointer !== undefined) endPenStroke();
        penEnding = true;
        setTimeout(() => { penEnding = false; }, 500);
      }
      break;
    case 'begin':
      beginTurn(message.turn, message.detail === true);
      if (message.detail !== true) box.reset(typeof message.question === 'string' ? message.question : '');
      placer()?.reset();
      if (message.detail !== true) ownedMarks.clear(); // a detail pass leaves the diagrams on screen, and the marks that go with them
      if (message.turn <= 1 && message.detail !== true) placer()?.setStage(undefined); // a detail pass keeps the stage it grows into
      if (message.detail === true) detailState = 'running';
      player.beginTurn(message.detail === true);
      break;
    case 'step':
      pen.fade(labelClock());
      fader.disarm();
      hud.stopWorking();
      if (message.step.actions.length > 0) box.drew();
      box.stepClosed();
      {
        const p = placer();
        if (p) foreseePoints(p, message.step.actions, view.width / view.height);
      }
      player.pushStep({ ...message.step, actions: message.step.actions.map(placedAction) });
      break;
    case 'step-open':
      pen.fade(labelClock());
      fader.disarm();
      hud.stopWorking();
      player.openStep(message.say);
      break;
    case 'action':
      box.drew();
      player.addAction(placedAction(message.action));
      break;
    case 'step-close':
      box.stepClosed();
      player.closeStep();
      break;
    case 'toggle-explode':
      // E, pressed while the pointer is on the model the person pressed on (main holds the key only then).
      if (!pen.active && hold.over && modelRect && player.settled) toggleExplode();
      break;
    case 'end':
      if (detailState === 'running') detailState = 'done';
      pen.fade(labelClock());
      hud.stopWorking();
      if (message.escalate !== undefined) pendingOffer = message.escalate;
      player.endTurn();
      break;
    case 'status':
      if (message.status === 'hush') player.hush();
      else if (message.status === 'idle') {
        hud.setStatus('idle');
        guiding = false;
        pen.fade(labelClock());
        // A detail pass that was asked for and ended without starting (a new press cancelled it): the model fades as usual.
        if (detailState === 'asked') {
          detailState = 'none';
          fader.arm(performance.now());
        }
      }
      else {
        hud.setStatus(message.status);
        if (message.status === 'waiting' || message.status === 'checking') {
          guiding = true;
          fader.disarm();
        }
        // A detail pass can take a minute to start: the model on screen stays until it arrives instead of fading under the wait.
        if (message.status === 'detail') {
          fader.disarm();
          if (detailState === 'none') detailState = 'asked'; // asked by voice: the same wait as after the button
        }
      }
      break;
    case 'press':
      pressButton(message.id);
      break;
    case 'consent':
      break; // asked in a window of its own (main/consent-card.ts), which takes a click without a mouse move before it
    case 'notice':
      if (detailState === 'asked' || detailState === 'running') {
        detailState = 'none'; // it failed: the person may ask again, and the model fades as usual
        fader.arm(performance.now());
      }
      pen.fade(labelClock());
      hud.showNotice(message.text, message.level, performance.now(), message.action);
      break;
    case 'clear':
      clearEverything();
      break;
    case 'dismiss':
      // Escape: the voice stops, what was still to be said is dropped, and what is drawn fades away quickly and goes.
      player.silence();
      pen.fade(labelClock());
      shot.removeAttribute('src');
      player.clear();
      box.reset('');
      fader.disarm();
      hud.reset();
      pendingOffer = undefined;
      detailState = 'none';
      guiding = false;
      fader.dismiss(performance.now());
      break;
    case 'seek':
      seekClock = (seekClock ?? 0) + 1000 / 30;
      fader.disarm();
      player.seek(placedScene(message.scene), message.step, message.t, message.view);
      draw(player.update());
      void painted().then(() => window.talkthrough.rendered(message.token));
      break;
  }
  request();
}

window.addEventListener('resize', resize);
let serverVoiceSet = false;
window.talkthrough.onDisplay((info) => {
  display = info;
  // A voice server, with the system voice as its spare; a development run that speaks nothing overrides both.
  if (info.voice && !serverVoiceSet) {
    serverVoiceSet = true;
    player.setVoice(createServerVoice(window.talkthrough.voice, info.voice, chooseVoice(), (line) => console.info(`talkthrough: ${line}`), {
      ...(info.speaker ? { speaker: info.speaker } : {}),
      onSinkLost: () => hud.showNotice('The speaker you chose is not available, so the system default is used.', 'info', performance.now()),
    }));
    // The step waits as long for the server's first sound as the voice does before the system voice speaks instead.
    player.setPatience(info.voice.firstAudioMs + VOICE_PATIENCE_MARGIN_MS);
  }
  if (info.silent) player.setVoice(createSilentVoice());
  setCaptions(info.captions ?? 'voice');
  if (info.backdrop) {
    backdropEl.onload = () => request();
    backdropEl.src = info.backdrop;
    waitForPage(backdropEl);
    backdropEl.style.display = 'block';
  } else {
    backdropEl.style.display = 'none';
  }
  resize();
});
window.talkthrough.onScene((message) => {
  try {
    handleScene(message);
  } catch (error) {
    console.error('overlay: could not play the scene', error);
  }
});
resize();
window.talkthrough.ready();
