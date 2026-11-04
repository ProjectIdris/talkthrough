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
import { inRect, panelRect } from './layout.ts';
import { drawMarks } from './marks.ts';
import type { View } from './marks.ts';
import { TIERS } from './materials.ts';
import type { Tier } from './materials.ts';
import { Player, createSilentVoice } from './player.ts';
import { PanelScene } from './scene3d.ts';
import type { ScreenRect } from './scene3d.ts';
import { themeNamed } from './theme.ts';
import type { Frame } from './timeline.ts';

const DRAG_DEGREES_PER_PIXEL = 0.4;
const params = new URLSearchParams(location.search);
const theme = themeNamed(params.get('theme'));

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
let interactive = false;
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
  drawMarks(marksCtx, frame.marks, view, {
    theme,
    view,
    project: (key, point) => panelScene.project(key, point, view.width, view.height),
    ...(backdropEl.complete && backdropEl.naturalWidth > 0
      ? { source: { image: backdropEl, width: backdropEl.naturalWidth, height: backdropEl.naturalHeight } }
      : {}),
  });
  if (!modelRect) setInteractive(hudHover);

  if (!milestones.mark && (frame.marks.some((m) => m.appear > 0) || frame.objects.some((o) => o.appear > 0))) {
    milestones.mark = true;
    milestone('first-mark');
  }
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

function loop(): void {
  raf = 0;
  const now = performance.now();
  let frame = player.update();
  const k = fader.alpha(now);
  if (k < 1) frame = fadeFrame(frame, k);
  draw(frame);
  showHud();
  const fading = fader.armed && k < 1 && k > 0;
  if (player.active || dragging || fading) {
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

function setInteractive(over: boolean): void {
  if (over === interactive) return;
  interactive = over;
  window.talkthrough.setInteractive(over);
}

let hudHover = false;
const interactiveEls = [offerEl, noticeEl];

document.addEventListener('mousemove', (e) => {
  hudHover = interactiveEls.some((el) => el.style.display !== 'none' && el.contains(e.target as Node));
  const overModel = inRect(modelRect, e.clientX, e.clientY);
  if (overModel || hudHover) {
    if (fader.armed) {
      fader.touch(performance.now());
      request();
    }
  }
  if (!dragging) setInteractive(overModel || hudHover);
});

document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !inRect(modelRect, e.clientX, e.clientY)) return;
  dragging = true;
  document.body.classList.add('dragging');
  document.documentElement.setPointerCapture(e.pointerId);
  request();
});
document.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  player.dragCamera(-e.movementX * DRAG_DEGREES_PER_PIXEL, e.movementY * DRAG_DEGREES_PER_PIXEL);
  if (fader.armed) fader.touch(performance.now());
  request();
});
const endDrag = (e: PointerEvent): void => {
  if (!dragging) return;
  dragging = false;
  document.body.classList.remove('dragging');
  if (document.documentElement.hasPointerCapture(e.pointerId)) document.documentElement.releasePointerCapture(e.pointerId);
  setInteractive(inRect(modelRect, e.clientX, e.clientY) || hudHover);
};
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

offerButton.addEventListener('click', () => {
  hud.dismissOffer();
  window.talkthrough.offer();
  hudHover = false;
  setInteractive(false);
  request();
});
noticeEl.addEventListener('click', () => {
  hud.dismissNotice();
  hudHover = false;
  setInteractive(false);
  request();
});

/** Resolves after the next frame has been painted (two animation frames). */
const painted = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function beginTurn(turn: number): void {
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
    case 'begin':
      beginTurn(message.turn);
      player.beginTurn();
      break;
    case 'step':
      fader.disarm();
      hud.stopWorking();
      player.pushStep(message.step);
      break;
    case 'end':
      hud.stopWorking();
      if (message.escalate !== undefined) pendingOffer = message.escalate;
      player.endTurn();
      break;
    case 'status':
      if (message.status === 'hush') player.hush();
      else if (message.status === 'idle') hud.setStatus('idle');
      else hud.setStatus(message.status);
      break;
    case 'notice':
      hud.showNotice(message.text, message.level, performance.now());
      break;
    case 'clear':
      player.clear();
      fader.disarm();
      hud.reset();
      pendingOffer = undefined;
      break;
    case 'seek':
      fader.disarm();
      player.seek(message.scene, message.step, message.t);
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
