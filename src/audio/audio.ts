// The hidden page that records the question and grabs one frame of the screen, both away from the
// main process. Mono 16 kHz floats are what the speech recogniser takes; the frame is scaled here too.

import { cropBox } from '../shared/pen.ts';

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

async function compose(request: { id: number; grab: number; maxEdge: number; cropEdge: number; strokes: Array<Array<[number, number]>> }): Promise<void> {
  try {
    const bitmap = frames.get(request.grab);
    if (!bitmap) throw new Error('that frame is no longer held');
    const box = cropBox(request.strokes);
    if (!box) throw new Error('no strokes');
    const full = scaledCanvas(bitmap, request.maxEdge);
    drawStrokes(full, request.strokes);
    // The crop comes from the full-resolution frame, without the strokes.
    const sx = Math.round((box.x / 1000) * bitmap.width);
    const sy = Math.round((box.y / 1000) * bitmap.height);
    const sw = Math.max(1, Math.round((box.w / 1000) * bitmap.width));
    const sh = Math.max(1, Math.round((box.h / 1000) * bitmap.height));
    const scale = Math.min(1, request.cropEdge / Math.max(sw, sh));
    const crop = new OffscreenCanvas(Math.max(1, Math.round(sw * scale)), Math.max(1, Math.round(sh * scale)));
    const context = crop.getContext('2d');
    if (!context) throw new Error('no 2d canvas');
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, crop.width, crop.height);
    window.talkthroughAudio.composed({
      id: request.id,
      full: { png: await toPng(full), width: full.width, height: full.height },
      crop: { png: await toPng(crop), width: crop.width, height: crop.height },
      box,
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

let generation = 0; // bumped by abort, so a start still waiting for the device gives it back
let starting: Promise<void> | null = null;

function start(): Promise<void> {
  starting = open();
  return starting;
}

async function open(): Promise<void> {
  if (recorder) return;
  const mine = ++generation;
  const asked = performance.now();
  let device: MediaStream;
  try {
    device = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
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

window.talkthroughAudio.onStart(() => void start());
window.talkthroughAudio.onAbort(abort);
window.talkthroughAudio.onGrab((request) => void grab(request));
window.talkthroughAudio.onCompose((request) => void compose(request));
window.talkthroughAudio.onUseImage((request) => void useImage(request));
window.talkthroughAudio.onStop(() => void stop());
