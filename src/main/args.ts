// Command-line options of the app. Everything here is for development and checks; a normal
// launch passes none of them.

export type GrabStep = { step: number; t: number; /** Turn, zoom or open the model as a person could (`step:t:az:el:zoom:explode`). */ view?: { az?: number; el?: number; zoom?: number; explode?: number } };

export type Options = {
  /**
   * Draw these scene files offscreen at the given moments, write PNGs, and quit. Several files are
   * played as turns of one thread (a follow-up continues the scene before it), their steps numbered on.
   */
  grab?: { scenes: string[]; steps: GrabStep[]; out: string; width: number; height: number; scaleFactor: number };
  /** An image shown behind the drawing (frame grabs only). */
  backdrop?: string;
  /** Quit by itself after this many seconds (for any on-screen run). */
  maxSeconds?: number;
  /** Play the next sample scene on the primary display right away. */
  playSample: boolean;
  /** Do not install the global key hook. */
  noHotkey: boolean;
  /** Use the fake microphone Chromium provides (checks that need no real microphone). */
  fakeMic: boolean;
  /** Keep the overlay visible to screen capture and recordings (it is hidden from them by default). */
  visibleToCapture: boolean;
  /** Leave hardware acceleration on. Off by default while the GPU is reserved. */
  gpu: boolean;
  /** Press and release the chord once through the key hook itself (checks the whole path without a keyboard). */
  selfChord: boolean;
  /** Quit after this many chord presses have been fully processed (checks). */
  exitAfterChord: number;
  /** Settings file to read instead of the one in the app's data folder. */
  settings?: string;
  /** Checks: use this image as the screenshot instead of grabbing the screen. */
  captureImage?: string;
  /** Checks only: keep pins in this folder instead of the app's data folder. */
  pinsDir?: string;
  /** Checks only: a pen stroke made without a mouse, as points on the 0..1000 scale ("x,y x,y ..."). */
  /** Checks only: write the picture the model gets with a stroke (and its crop) into this folder. */
  savePen?: string;
  fakeStroke?: Array<[number, number]>;
  /** Checks: use this WAV file as the microphone (with --fake-mic). */
  fakeMicFile?: string;
  /** Checks: how long --self-chord holds the keys, in milliseconds. */
  chordHoldMs: number;
  /** Checks: this many seconds after the page has finished showing the first answer, ask for more detail (as the page's button does); one chord only. */
  detailAfter?: number;
  /** Checks: log every validated step sent to the overlay. */
  logSteps: boolean;
  /** Checks: write the grabbed screen frame to this file. */
  saveCapture?: string;
  /** Checks: use this text as the transcript instead of calling the speech server. */
  question?: string;
  /** Checks: never show the overlay windows; they still render. */
  hidden: boolean;
  /** Checks: speak nothing. */
  silentVoice: boolean;
  /** Checks: write a picture of the overlay to this folder every --frame-every ms after a chord release. */
  framesDir?: string;
  frameEveryMs: number;
  /** Checks: seconds to keep running after a question has been answered, so the scene can play out. */
  settleSeconds: number;
};

export function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    playSample: false, noHotkey: false, fakeMic: false, visibleToCapture: false, gpu: false, exitAfterChord: 0, selfChord: false,
    hidden: false, silentVoice: false, chordHoldMs: 2000, logSteps: false, frameEveryMs: 700, settleSeconds: 9,
  };
  const value = (i: number, name: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${name} needs a value`);
    return v;
  };
  let grabScene: string | undefined;
  let grabSteps: GrabStep[] = [{ step: 0, t: 0 }];
  let grabOut: string | undefined;
  let size = { width: 1280, height: 720 };
  let scaleFactor = 1;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case '--grab': grabScene = value(i, a); i++; break;
      case '--steps': grabSteps = parseSteps(value(i, a)); i++; break;
      case '--out': grabOut = value(i, a); i++; break;
      case '--size': size = parseSize(value(i, a)); i++; break;
      case '--scale': scaleFactor = Number(value(i, a)); i++; break;
      case '--backdrop': options.backdrop = value(i, a); i++; break;
      case '--max-seconds': options.maxSeconds = Number(value(i, a)); i++; break;
      case '--play-sample': options.playSample = true; break;
      case '--no-hotkey': options.noHotkey = true; break;
      case '--fake-mic': options.fakeMic = true; break;
      case '--visible-to-capture': options.visibleToCapture = true; break;
      case '--gpu': options.gpu = true; break;
      case '--settings': options.settings = value(i, a); i++; break;
      case '--save-pen': options.savePen = value(i, a); i++; break;
      case '--fake-stroke': {
        const points = value(i, a).trim().split(/\s+/).map((pair) => pair.split(',').map(Number) as [number, number]);
        if (points.length < 2 || points.some((p) => p.length !== 2 || !p.every(Number.isFinite))) throw new Error('--fake-stroke needs points like "300,300 450,300 450,450"');
        options.fakeStroke = points;
        i++;
        break;
      }
      case '--pins-dir': options.pinsDir = value(i, a); i++; break;
      case '--capture-image': options.captureImage = value(i, a); i++; break;
      case '--fake-mic-file': options.fakeMicFile = value(i, a); options.fakeMic = true; i++; break;
      case '--save-capture': options.saveCapture = value(i, a); i++; break;
      case '--chord-hold': options.chordHoldMs = Number(value(i, a)); i++; break;
      case '--detail-after': options.detailAfter = Number(value(i, a)); i++; break;
      case '--log-steps': options.logSteps = true; break;
      case '--question': options.question = value(i, a); i++; break;
      case '--hidden': options.hidden = true; break;
      case '--silent-voice': options.silentVoice = true; break;
      case '--frames-dir': options.framesDir = value(i, a); i++; break;
      case '--settle-seconds': options.settleSeconds = Number(value(i, a)); i++; break;
      case '--frame-every': options.frameEveryMs = Number(value(i, a)); i++; break;
      case '--self-chord': options.selfChord = true; break;
      case '--exit-after-chord': options.exitAfterChord = Number(value(i, a)); i++; break;
      default: break; // Electron and the OS pass their own arguments
    }
  }
  if (options.detailAfter !== undefined && !(options.detailAfter >= 0)) throw new Error('--detail-after must be zero or more seconds');
  if (grabScene !== undefined) {
    if (grabOut === undefined) throw new Error('--grab needs --out <folder>');
    if (!(scaleFactor > 0)) throw new Error('--scale must be a positive number');
    options.grab = { scenes: grabScene.split(","), steps: grabSteps, out: grabOut, ...size, scaleFactor };
  }
  if (options.maxSeconds !== undefined && !(options.maxSeconds > 0)) throw new Error('--max-seconds must be positive');
  return options;
}

/**
 * "0:0.5,1:2" -> step 0 at 0.5 s, step 1 at 2 s. After the time may come the model's view as a person could
 * leave it: "2:3:40:20:1.3:1" -> az 40, el 20, zoom 1.3, exploded; any of the four may be left empty ("2:3::::1").
 */
export function parseSteps(text: string): GrabStep[] {
  return text.split(',').map((part) => {
    const [step, t, az, el, zoom, explode] = part.split(':');
    const parsed: GrabStep = { step: Number(step), t: Number(t ?? 0) };
    if (!Number.isInteger(parsed.step) || parsed.step < 0 || !Number.isFinite(parsed.t) || parsed.t < 0) {
      throw new Error(`bad --steps entry "${part}" (expected step:seconds)`);
    }
    const view: NonNullable<GrabStep['view']> = {};
    for (const [key, raw] of [['az', az], ['el', el], ['zoom', zoom], ['explode', explode]] as const) {
      if (raw === undefined || raw === '') continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`bad --steps entry "${part}" (${key} is not a number)`);
      view[key] = n;
    }
    if (Object.keys(view).length > 0) parsed.view = view;
    return parsed;
  });
}

export function parseSize(text: string): { width: number; height: number } {
  const m = /^(\d{2,5})x(\d{2,5})$/.exec(text);
  if (!m) throw new Error(`bad --size "${text}" (expected 1280x720)`);
  return { width: Number(m[1]), height: Number(m[2]) };
}
