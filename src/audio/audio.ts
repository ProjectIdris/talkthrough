// The hidden page that records the question and grabs one frame of the screen, both away from the
// main process. Mono 16 kHz floats are what the speech recogniser takes; the frame is scaled here too.

import { grayOf } from '../overlay/page-gray.ts';
import { Snapper } from '../overlay/snap.ts';
import type { InkGrid } from '../shared/pen-blocks.ts';
import type { ComposeRequest } from '../shared/ipc.ts';
import { gridFor } from '../shared/pen-grid.ts';
import type { Grid } from '../shared/pen-grid.ts';
import { readPen } from '../shared/pen-read.ts';
import { strokeBounds } from '../shared/pen.ts';

const TARGET_RATE = 16000;

// The full-resolution frames of the latest grabs, in memory only, kept so a pen stroke can be drawn onto
// the scaled picture and a sharper crop taken around it. Only the newest two are kept.
const frames = new Map<number, ImageBitmap>();
function keepFrame(id: number, bitmap: ImageBitmap): void {
  frames.set(id, bitmap);
  while (frames.size > 2) {
    const oldest = frames.keys().next().value as number;
    frames.get(oldest)?.close();
    frames.delete(oldest);
  }
}

async function toPng(canvas: OffscreenCanvas): Promise<Uint8Array> {
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

/** The frame scaled so its longer side is at most maxEdge. */
function scaledCanvas(bitmap: ImageBitmap, maxEdge: number): OffscreenCanvas {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d canvas');
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Draws the pen strokes (0..1000 scale) onto a canvas: red, round, with a dark edge so it shows on any page. */
function drawStrokes(canvas: OffscreenCanvas, strokes: Array<Array<[number, number]>>): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const width = Math.max(3, Math.round(Math.max(canvas.width, canvas.height) * 0.006));
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const [color, w] of [['rgba(20,20,20,0.85)', width + 3], ['#ff2a2a', width]] as const) {
    context.strokeStyle = color;
    context.lineWidth = w;
    for (const stroke of strokes) {
      if (stroke.length === 0) continue;
      context.beginPath();
      stroke.forEach(([x, y], i) => {
        const px = (x / 1000) * canvas.width;
        const py = (y / 1000) * canvas.height;
        if (i === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      });
      if (stroke.length === 1) context.lineTo((stroke[0]![0] / 1000) * canvas.width + 0.01, (stroke[0]![1] / 1000) * canvas.height);
      context.stroke();
    }
  }
}

type Cut = { box: { x: number; y: number; w: number; h: number }; kind: 'circle' | 'underline' | 'arrow' | 'picture'; loops?: number; open?: boolean };

/**
 * A lettered and numbered grid over a closer picture: thin light lines with a dark edge so they show on any picture, and each cell's name in
 * its top-left corner (columns A.. across, rows 1.. down), small enough to leave the picture readable. See pen-grid.ts.
 */
function drawGrid(context: OffscreenCanvasRenderingContext2D, width: number, height: number, grid: Grid): void {
  const cw = width / grid.cols, ch = height / grid.rows;
  const font = Math.max(10, Math.round(Math.min(cw, ch) * 0.22));
  context.save();
  context.lineWidth = 1;
  for (const [style, offset] of [['rgba(0,0,0,0.55)', 1], ['rgba(255,255,255,0.8)', 0]] as const) {
    context.strokeStyle = style;
    context.beginPath();
    for (let c = 1; c < grid.cols; c++) { context.moveTo(Math.round(c * cw) + offset + 0.5, 0); context.lineTo(Math.round(c * cw) + offset + 0.5, height); }
    for (let r = 1; r < grid.rows; r++) { context.moveTo(0, Math.round(r * ch) + offset + 0.5); context.lineTo(width, Math.round(r * ch) + offset + 0.5); }
    context.stroke();
  }
  context.font = `bold ${font}px sans-serif`;
  context.textBaseline = 'top';
  context.textAlign = 'left';
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const text = `${String.fromCharCode(65 + c)}${r + 1}`;
      const x = c * cw + 3, y = r * ch + 2;
      context.lineWidth = 3;
      context.strokeStyle = 'rgba(0,0,0,0.75)';
      context.strokeText(text, x, y);
      context.fillStyle = 'rgba(255,255,255,0.95)';
      context.fillText(text, x, y);
    }
  }
  context.restore();
}

/** Each box (0..1000) cut from the full-resolution frame and scaled to at most `cropEdge` on its longer side, as PNGs. */
async function cropsOf(bitmap: ImageBitmap, cuts: Cut[], cropEdge: number, withGrid = false) {
  const out = [];
  for (const cut of cuts) {
    const box = cut.box;
    const sx = Math.max(0, Math.min(bitmap.width - 1, Math.round((box.x / 1000) * bitmap.width)));
    const sy = Math.max(0, Math.min(bitmap.height - 1, Math.round((box.y / 1000) * bitmap.height)));
    const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round((box.w / 1000) * bitmap.width)));
    const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round((box.h / 1000) * bitmap.height)));
    const scale = Math.min(1, cropEdge / Math.max(sw, sh));
    const crop = new OffscreenCanvas(Math.max(1, Math.round(sw * scale)), Math.max(1, Math.round(sh * scale)));
    const context = crop.getContext('2d');
    if (!context) throw new Error('no 2d canvas');
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, crop.width, crop.height);
    const grid = withGrid ? gridFor(crop.width, crop.height) : undefined;
    if (grid) drawGrid(context, crop.width, crop.height, grid);
    out.push({ png: await toPng(crop), width: crop.width, height: crop.height, box, kind: cut.kind, ...(grid ? { grid } : {}), ...(cut.loops !== undefined ? { loops: cut.loops } : {}), ...(cut.open ? { open: true } : {}) });
  }
  return out;
}

/** Numbers beside the strokes of each mark, in the order drawn (only when there are several): a small dark disc with a white digit at the mark's top left. */
function drawNumbers(canvas: OffscreenCanvas, marks: ReadonlyArray<{ strokes: Array<Array<[number, number]>> }>): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const radius = Math.max(9, Math.round(Math.max(canvas.width, canvas.height) * 0.011));
  marks.forEach((mark, i) => {
    const b = strokeBounds(mark.strokes);
    if (!b) return;
    const cx = Math.min(canvas.width - radius, Math.max(radius, (b.x / 1000) * canvas.width - radius * 0.3));
    const cy = Math.min(canvas.height - radius, Math.max(radius, (b.y / 1000) * canvas.height - radius * 0.3));
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.fillStyle = 'rgba(20,20,20,0.92)';
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = '#ff2a2a';
    context.stroke();
    context.fillStyle = '#ffffff';
    context.font = `bold ${Math.round(radius * 1.35)}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(i + 1), cx, cy + 1);
  });
}

async function compose(request: ComposeRequest): Promise<void> {
  try {
    const bitmap = frames.get(request.grab);
    if (!bitmap) throw new Error('that frame is no longer held');
    if (request.boxes) {
      // Only parts of the frame, at full resolution (the closer picture of what an answer enlarged): nothing is drawn, nothing is read.
      window.talkthroughAudio.composed({ id: request.id, marks: await cropsOf(bitmap, request.boxes.map((box) => ({ box, kind: 'picture' as const })), request.cropEdge, request.grid === true) });
      return;
    }
    if (!strokeBounds(request.strokes)) throw new Error('no strokes');
    const full = scaledCanvas(bitmap, request.maxEdge);
    // The page's own ink (read before the strokes are drawn on it) grows a rough circle to the whole thing it is on.
    let grid: InkGrid | null = null;
    try {
      const g = grayOf(full, full.width, full.height);
      if (g) grid = new Snapper(g.gray, g.cols, g.rows).blockGrid;
    } catch {
      grid = null; // the stroke's own shape alone then
    }
    const marks = readPen(request.strokes, grid, bitmap.width / bitmap.height);
    if (marks.length === 0) throw new Error('no strokes');
    drawStrokes(full, request.strokes);
    if (marks.length > 1) drawNumbers(full, marks);
    // Each crop comes from the full-resolution frame, without the strokes.
    const crops = await cropsOf(bitmap, marks.map((m) => ({ box: m.crop, kind: m.kind, ...(m.loops !== undefined ? { loops: m.loops } : {}), ...(m.open ? { open: true } : {}) })), request.cropEdge);
    window.talkthroughAudio.composed({
      id: request.id,
      full: { png: await toPng(full), width: full.width, height: full.height },
      marks: crops,
    });
  } catch (error) {
    window.talkthroughAudio.composeError(request.id, `could not draw the stroke: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Checks only: take a PNG as if it had been grabbed from a screen. */
async function useImage(request: { id: number; png: Uint8Array; maxEdge: number }): Promise<void> {
  const asked = performance.now();
  try {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(request.png)], { type: 'image/png' }));
    keepFrame(request.id, bitmap);
    const canvas = scaledCanvas(bitmap, request.maxEdge);
    window.talkthroughAudio.frame({ id: request.id, png: await toPng(canvas), width: canvas.width, height: canvas.height, nativeWidth: bitmap.width, nativeHeight: bitmap.height, ms: Math.round(performance.now() - asked) });
  } catch (error) {
    window.talkthroughAudio.frameError(request.id, `could not read the image: ${error instanceof Error ? error.message : String(error)}`);
  }
}

let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let chunks: Blob[] = [];
let startedAt = 0;
let startLatencyMs = 0;

/** The recording constraints, for the microphone the person chose (exact) or the system's default. */
const audioConstraints = (deviceId: string): MediaTrackConstraints => ({ channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) });

/**
 * The microphone the person chose; when it has gone (unplugged, renamed) the system's default is used and main is told once, so it can say so.
 * Only a missing or unusable device falls back: a refusal of permission is not hidden behind the default.
 */
async function openMicrophone(deviceId: string): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(deviceId) });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (!deviceId || (name !== 'OverconstrainedError' && name !== 'NotFoundError')) throw error;
    window.talkthroughAudio.micFallback();
    return navigator.mediaDevices.getUserMedia({ audio: audioConstraints('') });
  }
}

/** The microphones and speakers the system lists; labels need the microphone permission, so a stream is opened for a moment (and closed) when they are empty. */
async function listDevices(requestId: number): Promise<void> {
  const read = async () => (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications');
  let all = await read();
  if (all.some((d) => (d.kind === 'audioinput' || d.kind === 'audiooutput') && d.label === '')) {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of probe.getTracks()) track.stop();
      all = await read();
    } catch {
      // no permission: the list stays as it is, without names
    }
  }
  const named = (kind: MediaDeviceKind, fallback: string) => all.filter((d) => d.kind === kind && d.deviceId !== '').map((d, i) => ({ id: d.deviceId, name: d.label || `${fallback} ${i + 1}` }));
  window.talkthroughAudio.devices(requestId, {
    microphones: [{ id: '', name: 'System default' }, ...named('audioinput', 'Microphone')],
    speakers: [{ id: '', name: 'System default' }, ...named('audiooutput', 'Speaker')],
  });
}

let generation = 0; // bumped by abort, so a start still waiting for the device gives it back
let starting: Promise<void> | null = null;

function start(deviceId?: string): Promise<void> {
  starting = open(deviceId);
  return starting;
}

async function open(deviceId = ''): Promise<void> {
  if (recorder) return;
  const mine = ++generation;
  const asked = performance.now();
  let device: MediaStream;
  try {
    device = await openMicrophone(deviceId);
  } catch (error) {
    if (mine === generation) window.talkthroughAudio.error(`microphone unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (mine !== generation) {
    // Aborted while the device was opening: give it back without touching what a newer start holds.
    for (const track of device.getTracks()) track.stop();
    return;
  }
  stream = device;
  chunks = [];
  recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.onstart = () => {
    startedAt = performance.now();
    startLatencyMs = Math.round(startedAt - asked);
    window.talkthroughAudio.started();
  };
  recorder.start(250);
}

/** Stops recording and releases the microphone without keeping anything. */
function abort(): void {
  generation++;
  const active = recorder;
  const media = stream;
  recorder = null;
  stream = null;
  chunks = [];
  if (active) {
    active.ondataavailable = null;
    active.onstop = null;
    try {
      active.stop();
    } catch {
      // already stopped
    }
  }
  if (media) for (const track of media.getTracks()) track.stop();
}

async function stop(): Promise<void> {
  await starting;
  const active = recorder;
  const media = stream;
  if (!active || !media) {
    window.talkthroughAudio.error('stop without a recording');
    return;
  }
  recorder = null;
  stream = null;
  const stopped = new Promise<void>((resolve) => (active.onstop = () => resolve()));
  active.stop();
  await stopped;
  for (const track of media.getTracks()) track.stop(); // releases the microphone
  try {
    const bytes = await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer();
    chunks = [];
    const context = new AudioContext({ sampleRate: TARGET_RATE });
    const decoded = await context.decodeAudioData(bytes);
    await context.close();
    const samples = decoded.getChannelData(0).slice();
    window.talkthroughAudio.result({
      samples,
      sampleRate: TARGET_RATE,
      durationMs: Math.round((samples.length / TARGET_RATE) * 1000),
      startLatencyMs,
    });
  } catch (error) {
    window.talkthroughAudio.error(`could not read the recording: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function grab(request: { id: number; sourceId: string; maxEdge: number; nativeWidth: number; nativeHeight: number }): Promise<void> {
  const asked = performance.now();
  let media: MediaStream | null = null;
  try {
    // The source id comes from the main process's screen list; the picker is never involved.
    media = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: request.sourceId,
          maxWidth: request.nativeWidth,
          maxHeight: request.nativeHeight,
          maxFrameRate: 5,
        },
      },
    } as unknown as MediaStreamConstraints);
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = media;
    await video.play();
    if (video.videoWidth === 0) await new Promise<void>((resolve) => video.addEventListener('loadeddata', () => resolve(), { once: true }));
    const bitmap = await createImageBitmap(video);
    keepFrame(request.id, bitmap);
    const nativeWidth = bitmap.width;
    const nativeHeight = bitmap.height;
    const canvas = scaledCanvas(bitmap, request.maxEdge);
    const width = canvas.width;
    const height = canvas.height;
    const png = await toPng(canvas);
    window.talkthroughAudio.frame({ id: request.id, png, width, height, nativeWidth, nativeHeight, ms: Math.round(performance.now() - asked) });
  } catch (error) {
    window.talkthroughAudio.frameError(request.id, `could not capture the screen: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (media) for (const track of media.getTracks()) track.stop();
  }
}

window.talkthroughAudio.onStart((deviceId) => void start(deviceId));
window.talkthroughAudio.onListDevices((requestId) => void listDevices(requestId));
window.talkthroughAudio.onAbort(abort);
window.talkthroughAudio.onGrab((request) => void grab(request));
window.talkthroughAudio.onCompose((request) => void compose(request));
window.talkthroughAudio.onRelease((grabId) => {
  frames.get(grabId)?.close();
  frames.delete(grabId);
});
window.talkthroughAudio.onUseImage((request) => void useImage(request));
window.talkthroughAudio.onStop(() => void stop());
