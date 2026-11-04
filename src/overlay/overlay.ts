// The overlay page: draws the scene language over the display it covers and plays scenes sent by
// the main process. Marks are drawn on a 2D canvas; each 3D panel is a three.js viewport on a
// WebGL canvas, under the marks. Everything is data-driven by validated scenes (see src/scene).

import { SRGBColorSpace, WebGLRenderer } from 'three';
import type { DisplayInfo, SceneMessage } from '../shared/ipc.ts';
import type { Voice } from '../adapters/voice.ts';
import { createSpeechSynthesisVoice } from '../adapters/speech-synthesis-voice.ts';
import { drawMarks, snap } from './marks.ts';
import type { View } from './marks.ts';
import { Player, createSilentVoice } from './player.ts';
import { PanelScene } from './scene3d.ts';
import type { Frame } from './timeline.ts';

const DRAG_DEGREES_PER_PIXEL = 0.4;

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const backdropEl = byId<HTMLImageElement>('backdrop');
const panelEl = byId<HTMLDivElement>('panel');
const glCanvas = byId<HTMLCanvasElement>('gl');
const marksCanvas = byId<HTMLCanvasElement>('marks');
const marksCtx = marksCanvas.getContext('2d') as CanvasRenderingContext2D;

const renderer = new WebGLRenderer({ canvas: glCanvas, alpha: true, antialias: true, premultipliedAlpha: true });
renderer.outputColorSpace = SRGBColorSpace;
renderer.setClearColor(0x000000, 0);
renderer.autoClear = false;

const panelScene = new PanelScene({
  makeCanvas: (width, height) => {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
  },
});

/** Speaks with the system voice when it has one, otherwise paces steps silently. */
function chooseVoice(): Voice {
  const silent = createSilentVoice();
  let real: Voice | undefined;
  const pick = (): Voice => {
    if (typeof speechSynthesis === 'undefined' || speechSynthesis.getVoices().length === 0) return silent;
    real ??= createSpeechSynthesisVoice();
    return real;
  };
  return {
    id: 'auto',
    speak: (text, listener) => pick().speak(text, listener),
    cancel() {
      silent.cancel();
      real?.cancel();
    },
  };
}

const player = new Player({ voice: chooseVoice(), onDone: () => window.talkthrough.done() });

let display: DisplayInfo | undefined;
let view: View = { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 };
let panelPx: { x: number; y: number; w: number; h: number } | undefined;
let interactive = false;
let dragging = false;
let raf = 0;

function resize(): void {
  const width = display?.bounds.width ?? window.innerWidth;
  const height = display?.bounds.height ?? window.innerHeight;
  const dpr = window.devicePixelRatio || display?.scaleFactor || 1;
  view = { width, height, dpr };
  document.documentElement.style.width = `${width}px`;
  document.documentElement.style.height = `${height}px`;
  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height);
  marksCanvas.width = Math.round(width * dpr);
  marksCanvas.height = Math.round(height * dpr);
  marksCanvas.style.width = `${width}px`;
  marksCanvas.style.height = `${height}px`;
  request();
}

function draw(frame: Frame): void {
  renderer.setScissorTest(false);
  renderer.clear();
  if (frame.panel) {
    // The panel's rectangle, snapped to physical pixels so the DOM frame and the viewport agree.
    const r = frame.panel.rect;
    const x = snap((r.x / 1000) * view.width, view.dpr);
    const y = snap((r.y / 1000) * view.height, view.dpr);
    const w = Math.max(8, snap((r.w / 1000) * view.width, view.dpr));
    const h = Math.max(8, snap((r.h / 1000) * view.height, view.dpr));
    panelPx = { x, y, w, h };
    const alpha = Math.max(0, Math.min(1, frame.panel.appear * frame.panel.fade));
    panelEl.style.display = alpha > 0.003 ? 'block' : 'none';
    panelEl.style.left = `${x}px`;
    panelEl.style.top = `${y}px`;
    panelEl.style.width = `${w}px`;
    panelEl.style.height = `${h}px`;
    panelEl.style.opacity = String(alpha);
    // The WebGL canvas covers the display; clip it to the panel's rounded frame.
    glCanvas.style.clipPath = `inset(${y}px ${view.width - x - w}px ${view.height - y - h}px ${x}px round 14px)`;
    panelScene.sync(frame, w / h);
    renderer.setViewport(x, view.height - y - h, w, h);
    renderer.setScissor(x, view.height - y - h, w, h);
    renderer.setScissorTest(true);
    renderer.render(panelScene.scene, panelScene.camera);
  } else {
    panelPx = undefined;
    panelEl.style.display = 'none';
    panelScene.sync(frame, 1);
    setInteractive(false);
  }
  drawMarks(marksCtx, frame.marks, view);
}

function loop(): void {
  raf = 0;
  draw(player.update());
  if (player.active || dragging) request();
}

function request(): void {
  if (!raf) raf = requestAnimationFrame(loop);
}

function setInteractive(over: boolean): void {
  if (over === interactive) return;
  interactive = over;
  window.talkthrough.setInteractive(over);
}

function overPanel(x: number, y: number): boolean {
  const p = panelPx;
  return !!p && x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h;
}

document.addEventListener('mousemove', (e) => {
  if (!dragging) setInteractive(overPanel(e.clientX, e.clientY));
});

panelEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  dragging = true;
  panelEl.classList.add('dragging');
  panelEl.setPointerCapture(e.pointerId);
  request();
});
panelEl.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  player.dragCamera(-e.movementX * DRAG_DEGREES_PER_PIXEL, e.movementY * DRAG_DEGREES_PER_PIXEL);
  request();
});
const endDrag = (e: PointerEvent): void => {
  if (!dragging) return;
  dragging = false;
  panelEl.classList.remove('dragging');
  if (panelEl.hasPointerCapture(e.pointerId)) panelEl.releasePointerCapture(e.pointerId);
  setInteractive(overPanel(e.clientX, e.clientY));
};
panelEl.addEventListener('pointerup', endDrag);
panelEl.addEventListener('pointercancel', endDrag);

/** Resolves after the next frame has been painted (two animation frames). */
const painted = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function handleScene(message: SceneMessage): void {
  switch (message.kind) {
    case 'play':
      // The first scene of a question starts clean; later turns continue it, keeping objects and ids.
      if (message.turn <= 1) player.clear();
      player.play(message.scene);
      request();
      break;
    case 'clear':
      player.clear();
      draw(player.update());
      break;
    case 'seek':
      player.seek(message.scene, message.step, message.t);
      draw(player.update());
      void painted().then(() => window.talkthrough.rendered(message.token));
      break;
  }
}

window.addEventListener('resize', resize);
window.talkthrough.onDisplay((info) => {
  display = info;
  if (info.backdrop) {
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
