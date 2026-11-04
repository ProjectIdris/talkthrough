// The hidden page that records the question and grabs one frame of the screen, both away from the
// main process. Mono 16 kHz floats are what the speech recogniser takes; the frame is scaled here too.

const TARGET_RATE = 16000;

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
    const nativeWidth = video.videoWidth;
    const nativeHeight = video.videoHeight;
    const scale = Math.min(1, request.maxEdge / Math.max(nativeWidth, nativeHeight));
    const width = Math.max(1, Math.round(nativeWidth * scale));
    const height = Math.max(1, Math.round(nativeHeight * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d canvas');
    context.imageSmoothingQuality = 'high';
    context.drawImage(video, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const png = new Uint8Array(await blob.arrayBuffer());
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
window.talkthroughAudio.onStop(() => void stop());
