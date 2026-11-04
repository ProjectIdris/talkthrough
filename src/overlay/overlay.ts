// The overlay page: draws the scene language over the display it covers and plays what the main
// process sends. A 3D model floats over the page on a WebGL canvas (lit by a room environment, with a
// soft shadow on the page); marks, tags pinned to parts, and cards are drawn on a 2D canvas above it.
// Everything is data-driven by validated scenes (see src/scene).

import { NeutralToneMapping, PMREMGenerator, SRGBColorSpace, WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FADE_AFTER_MS } from '../shared/ipc.ts';
import type { DisplayInfo, SceneMessage } from '../shared/ipc.ts';
import type { Voice } from '../adapters/voice.ts';
import { createSpeechSynthesisVoice } from '../adapters/speech-synthesis-voice.ts';
import { AutoFade, fadeFrame } from './fade.ts';
import { HudState } from './hud.ts';
import { LabelBoard, Occupancy, busyFromGray } from './labels.ts';
import type { Busy } from './labels.ts';
import { panelRect } from './layout.ts';
import { createHold, explodeButtonBox, overModel, wheelFactor } from './orbit.ts';
import { drawMarks } from './marks.ts';
import type { View } from './marks.ts';
import { TIERS } from './materials.ts';
import type { Tier } from './materials.ts';
import { PenLayer, drawPen } from './pen.ts';
import { Player, createSilentVoice } from './player.ts';
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
const marksCtx = marksCanvas.getContext('2d') as CanvasRenderingContext2D;

/** The quality tier: asked for in the page address, or chosen from what the graphics stack is. */
function chooseTier(): Tier {
  const asked = params.get('tier');
  if (asked === 'low' || asked === 'mid' || asked === 'high') return asked;
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    const name = info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    return /swiftshader|basic render|llvmpipe|software/i.test(name) ? 'mid' : 'high';
  } catch {
    return 'low';
  }
}

const tier = chooseTier();
const settings = TIERS[tier];
const renderer = new WebGLRenderer({ canvas: glCanvas, alpha: true, antialias: settings.msaa, premultipliedAlpha: true });
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = NeutralToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.setClearColor(0x000000, 0);
renderer.autoClear = false;
renderer.shadowMap.enabled = settings.shadows;

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

/**
 * Speaks with the system voice, or paces steps silently where there is no speech synthesis at all.
 * The voice list is empty when the page starts and fills after the first utterance, so it is not
 * a test of whether speaking works; a voice that never answers is covered by the player's patience.
 */
function chooseVoice(): Voice {
  if (typeof speechSynthesis === 'undefined') return createSilentVoice();
  return createSpeechSynthesisVoice();
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
    fader.arm(performance.now());
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
let view: View = { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 };
/** Where the model is on screen (for the pointer), and the stage's frame when it has one. */
let modelRect: ScreenRect | undefined;
// Whether the window is solid for the pointer (orbit.ts): worked out from where the pointer is and where the model is.
const hold = createHold((over) => window.talkthrough.setInteractive(over));
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

function draw(frame: Frame): void {
  renderer.setScissorTest(false);
  renderer.clear();
  const rect = panelRect(frame.panel, view);
  modelRect = undefined;
  if (rect && frame.panel) {
    const { x, y, w, h, alpha } = rect;
    if (frame.panel.frame) {
      frameEl.style.display = 'block';
      frameEl.style.left = `${x}px`;
      frameEl.style.top = `${y}px`;
      frameEl.style.width = `${w}px`;
      frameEl.style.height = `${h}px`;
      frameEl.style.opacity = String(alpha);
    } else {
      frameEl.style.display = 'none';
    }
    panelScene.sync(frame, w / h, { rect: { x, y, w, h }, width: view.width, height: view.height });
    const bounds = panelScene.screenBounds(view.width, view.height);
    if (bounds) {
      modelRect = frame.panel.frame ? { x, y, w, h } : bounds.model;
      const r = clampRect(bounds.drawn, 14);
      if (r.w > 0 && r.h > 0) {
        renderer.setViewport(0, 0, view.width, view.height);
        renderer.setScissor(r.x, view.height - r.y - r.h, r.w, r.h);
        renderer.setScissorTest(true);
        renderer.render(panelScene.scene, panelScene.camera);
      }
    }
  } else {
    // No stage, or one too faint to see: nothing here may take the pointer.
    frameEl.style.display = 'none';
    panelScene.sync(frame, 1);
  }
  placeExplode(frame);
  board.beginFrame({ width: view.width, height: view.height, model: modelRect, dragging, now: labelClock() });
  board.keep(new Set(frame.marks.filter((m) => m.mark.op === 'pin').map((m) => m.key)));
  drawMarks(marksCtx, frame.marks, view, {
    view,
    place: (key, request) => board.place(key, request, labelEnvironment),
    project: (key, point, anchor) => panelScene.project(key, point, view.width, view.height, anchor),
    ...(cropSource() ? { source: cropSource()! } : {}),
  });
  drawPen(marksCtx, pen.view(labelClock()), view);
  if (pointerX >= 0) hold.onHud(overHud(document.elementFromPoint(pointerX, pointerY))); // a button can fade under a resting pointer
  hold.model(modelRect);

  if (!milestones.mark && (frame.marks.some((m) => m.appear > 0) || frame.objects.some((o) => o.appear > 0))) {
    milestones.mark = true;
    milestone('first-mark');
  }
}

/** The image crops are taken from: the screenshot the model was given, else the development backdrop. */
function cropSource(): { image: CanvasImageSource; width: number; height: number } | undefined {
  for (const img of [shot, backdropEl]) if (img.complete && img.naturalWidth > 0) return { image: img, width: img.naturalWidth, height: img.naturalHeight };
  return undefined;
}

const board = new LabelBoard();
const pen = new PenLayer();
// Frame grabs (seek) step a clock of their own, one thirtieth of a second a grab, so a clip's tags move at the clip's pace.
let seekClock: number | undefined;
const labelClock = (): number => seekClock ?? performance.now();
let busyFor: { image: CanvasImageSource; busy: Busy } | undefined;

/** How busy each part of the page is, from the screenshot (or backdrop): tags keep off its text. */
function busyMap(): Busy | undefined {
  const source = cropSource();
  if (!source) return undefined;
  if (busyFor?.image === source.image) return busyFor.busy;
  const cols = 192, rows = 108;
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const c = canvas.getContext('2d', { willReadFrequently: true });
  if (!c) return undefined;
  c.drawImage(source.image, 0, 0, cols, rows);
  const data = c.getImageData(0, 0, cols, rows).data;
  const gray = new Uint8Array(cols * rows);
  for (let i = 0; i < gray.length; i++) gray[i] = (data[i * 4] as number) * 0.3 + (data[i * 4 + 1] as number) * 0.59 + (data[i * 4 + 2] as number) * 0.11;
  busyFor = { image: source.image, busy: busyFromGray(gray, cols, rows, view.width, view.height) };
  return busyFor.busy;
}

function labelEnvironment(): { occ: Occupancy; busy?: Busy } {
  const occ = new Occupancy(view.width, view.height);
  for (const hull of panelScene.silhouette(view.width, view.height)) occ.fillConvex(hull);
  // The Explode button is not for a tag to sit on.
  if (explodeEl.style.display !== 'none') {
    const x = parseFloat(explodeEl.style.left) || 0, y = parseFloat(explodeEl.style.top) || 0;
    const w = explodeEl.offsetWidth || 74, h = explodeEl.offsetHeight || 26;
    occ.fillConvex([{ x: x - 4, y: y - 4 }, { x: x + w + 4, y: y - 4 }, { x: x + w + 4, y: y + h + 4 }, { x: x - 4, y: y + h + 4 }]);
  }
  const busy = busyMap();
  return busy ? { occ, busy } : { occ };
}

function showHud(): void {
  const now = performance.now();
  const v = hud.view(now);
  statusEl.className = v.status === 'idle' ? '' : v.status;
  statusEl.style.display = v.status === 'idle' ? 'none' : 'flex';
  if (v.offer === null) {
    offerEl.style.display = 'none';
  } else {
    offerEl.style.display = 'flex';
    if (offerText.textContent !== `I can ask a deeper helper: ${v.offer}`) offerText.textContent = `I can ask a deeper helper: ${v.offer}`;
  }
  if (v.notice === null) {
    noticeEl.style.display = 'none';
  } else {
    noticeEl.style.display = 'block';
    noticeEl.className = v.notice.level;
    noticeEl.style.opacity = String(v.notice.alpha);
    if (noticeEl.textContent !== v.notice.text) noticeEl.textContent = v.notice.text;
  }
}

/** Shows the Explode / Assemble control at the corner of a finished model with parts to spread, and hides it otherwise. */
function placeExplode(frame: Frame): void {
  if (!modelRect || !player.settled || frame.objects.length < 2 || pen.active) {
    explodeEl.style.display = 'none';
    return;
  }
  explodeEl.style.display = 'block';
  const label = player.exploded ? 'Assemble' : 'Explode';
  if (explodeEl.textContent !== label) explodeEl.textContent = label;
  const box = explodeButtonBox(modelRect, view, { w: explodeEl.offsetWidth || 74, h: explodeEl.offsetHeight || 26 });
  explodeEl.style.left = `${box.x}px`;
  explodeEl.style.top = `${box.y}px`;
}

function loop(): void {
  raf = 0;
  const now = performance.now();
  let frame = player.update();
  const k = fader.alpha(now);
  if (k <= 0 && player.idling) player.stopIdle();
  if (k < 1) frame = fadeFrame(frame, k);
  draw(frame);
  if (pen.active) sendPen();
  showHud();
  const fading = fader.armed && k < 1 && k > 0;
  if (player.active || dragging || fading || board.moving || pen.animating(now) || pen.active) {
    request();
    return;
  }
  // Nothing is moving: wake up only when the next thing is due (the scene starting to fade, a notice going).
  const due = [fader.untilChange(now), hud.untilChange(now)].filter((n): n is number => n !== undefined);
  if (due.length) {
    if (wake) clearTimeout(wake);
    wake = setTimeout(request, Math.max(16, Math.min(...due) + 16));
  }
}

function request(): void {
  if (!raf) raf = requestAnimationFrame(loop);
}

const interactiveEls: HTMLElement[] = [offerEl, noticeEl, explodeEl];

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
document.addEventListener('pointerdown', (e) => {
  if (pen.active) {
    // While the chord is held the mouse draws; it never turns the model or clicks the app's own words.
    if (e.button !== 0) return;
    document.documentElement.setPointerCapture(e.pointerId);
    penPointer = e.pointerId;
    pen.down(...toScale(e));
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
    pen.move(...toScale(e));
    request();
    return;
  }
  if (!dragging) return;
  player.dragCamera(-e.movementX * DRAG_DEGREES_PER_PIXEL, e.movementY * DRAG_DEGREES_PER_PIXEL);
  if (fader.armed) fader.touch(performance.now());
  request();
});
const endDrag = (e: PointerEvent): void => {
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
document.addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'e' && e.key !== 'E')) return;
  if (pen.active || !hold.over || !modelRect || !player.settled) return;
  e.preventDefault();
  toggleExplode();
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
noticeEl.addEventListener('click', () => {
  hud.dismissNotice();
  hold.release();
  request();
});

/** Resolves after the next frame has been painted (two animation frames). */
const painted = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function beginTurn(turn: number): void {
  seekClock = undefined;
  fader.disarm();
  hud.newTurn();
  pendingOffer = undefined;
  // The first turn of a question starts clean; later turns continue it, keeping objects and ids.
  if (turn <= 1) player.clear();
  milestones.mark = false;
  milestones.word = false;
}

function handleScene(message: SceneMessage): void {
  switch (message.kind) {
    case 'play':
      beginTurn(message.turn);
      milestones.mark = true;
      milestones.word = true;
      player.play(message.scene);
      break;
    case 'pen':
      if (message.on) {
        penEnding = false;
        pen.turnOn();
      } else {
        pen.turnOff();
        sendPen();
        if (penPointer !== undefined) endPenStroke();
        penEnding = true;
        setTimeout(() => { penEnding = false; }, 500);
      }
      break;
    case 'screenshot':
      shot.onload = () => request();
      shot.src = message.url;
      break;
    case 'begin':
      beginTurn(message.turn);
      player.beginTurn();
      break;
    case 'step':
      pen.fade(labelClock());
      fader.disarm();
      hud.stopWorking();
      player.pushStep(message.step);
      break;
    case 'step-open':
      pen.fade(labelClock());
      fader.disarm();
      hud.stopWorking();
      player.openStep(message.say);
      break;
    case 'action':
      player.addAction(message.action);
      break;
    case 'step-close':
      player.closeStep();
      break;
    case 'end':
      pen.fade(labelClock());
      hud.stopWorking();
      if (message.escalate !== undefined) pendingOffer = message.escalate;
      player.endTurn();
      break;
    case 'status':
      if (message.status === 'hush') player.hush();
      else if (message.status === 'idle') {
        hud.setStatus('idle');
        pen.fade(labelClock());
      }
      else hud.setStatus(message.status);
      break;
    case 'notice':
      pen.fade(labelClock());
      hud.showNotice(message.text, message.level, performance.now());
      break;
    case 'clear':
      pen.fade(labelClock());
      shot.removeAttribute('src');
      player.clear();
      fader.disarm();
      hud.reset();
      pendingOffer = undefined;
      break;
    case 'seek':
      seekClock = (seekClock ?? 0) + 1000 / 30;
      fader.disarm();
      player.seek(message.scene, message.step, message.t, message.view);
      draw(player.update());
      void painted().then(() => window.talkthrough.rendered(message.token));
      break;
  }
  request();
}

window.addEventListener('resize', resize);
window.talkthrough.onDisplay((info) => {
  display = info;
  if (info.silent) player.setVoice(createSilentVoice());
  if (info.backdrop) {
    backdropEl.onload = () => request();
    backdropEl.src = info.backdrop;
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
