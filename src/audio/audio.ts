// The hidden page that records the question. Mono 16 kHz floats are what the speech recogniser takes.

const TARGET_RATE = 16000;

let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let chunks: Blob[] = [];
let startedAt = 0;
let startLatencyMs = 0;

async function start(): Promise<void> {
  if (recorder) return;
  const asked = performance.now();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (error) {
    window.talkthroughAudio.error(`microphone unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  chunks = [];
  recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.onstart = () => {
    startedAt = performance.now();
    startLatencyMs = Math.round(startedAt - asked);
  };
  recorder.start(250);
}

async function stop(): Promise<void> {
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

window.talkthroughAudio.onStart(() => void start());
window.talkthroughAudio.onStop(() => void stop());
