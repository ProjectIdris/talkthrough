// The contract between the main process and the overlay renderer. Main validates a scene
// (src/scene) before it sends it; the renderer draws what it is given and nothing else.
// The preload script exposes `window.talkthrough` (TalkthroughApi) to the overlay page.

import type { Scene, Step } from '../scene/types.ts';

export const CHANNEL = {
  /** main -> overlay: which display this overlay covers. Sent after `ready`, and again if it changes. */
  display: 'tt:display',
  /** main -> overlay: a SceneMessage. */
  scene: 'tt:scene',
  /** overlay -> main: the page has loaded and wants its DisplayInfo. */
  ready: 'tt:ready',
  /** overlay -> main: boolean, the pointer is over something the user can drag (the 3D panel). */
  interactive: 'tt:interactive',
  /** overlay -> main: the token of a `seek` whose frame is now painted. */
  rendered: 'tt:rendered',
  /** overlay -> main: the played scene has finished (all steps spoken and drawn). */
  done: 'tt:done',
  /** overlay -> main: the user clicked the escalation offer. */
  offer: 'tt:offer',
  /** overlay -> main: a piece of a pen stroke (Stroke), streamed as the pointer moves while the pen is on. */
  stroke: 'tt:stroke',
  /** overlay -> main: a Milestone, for latency measurement (the first mark drawn or word spoken of a live turn). */
  milestone: 'tt:milestone',
} as const;

/** Part of one pen stroke: points are appended per id; coordinates run 0..1000 across the whole overlay window. */
export type Stroke = { id: number; points: Array<[number, number]>; done: boolean };

/** A scene finished and, after this long with no new question, the page fades it out by itself. */
export const FADE_AFTER_MS = 12_000;

/** The first thing the user could see or hear of a live turn; `at` is epoch milliseconds (Date.now()). */
export type Milestone = { what: 'first-mark' | 'first-word'; at: number };

export type DisplayInfo = {
  id: number;
  /** The display in device-independent pixels; the overlay window covers exactly this. */
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  /** For development and frame grabs only: an image file URL to show behind the drawing. */
  backdrop?: string;
  /** For development runs only: speak nothing (use a silent voice). */
  silent?: boolean;
};

/**
 * Scene coordinates (0..1000 per axis) map across the whole overlay window, which covers the
 * display that was captured, so the renderer needs no other mapping.
 */
export type SceneMessage =
  /**
   * Play a validated scene in real time, speaking each step. Turn 1 starts a fresh scene (anything
   * drawn before is removed first); a later turn continues the same scene, so ids from earlier turns
   * stay reachable and what is on screen stays.
   */
  | { kind: 'play'; scene: Scene; turn: number }
  /** Remove everything drawn and stop speaking. */
  | { kind: 'clear' }
  /**
   * Frame grabs: stop the clock and draw the scene as it is `t` seconds into step `step`
   * (earlier steps complete), with no speech. Once painted, answer with `rendered(token)`.
   */
  | { kind: 'seek'; scene: Scene; step: number; t: number; token: number }
  /**
   * Live turns, while a model is still writing. `begin` starts a turn (1 = fresh scene, later = continues),
   * each `step` is one validated step to append (the first starts at once, the rest queue behind it), and
   * `end` says no more steps are coming; `escalate` (validated text) is offered once the last step is done.
   */
  /**
   * The image being explained (a data URL of the screenshot the model was given), sent just before a
   * live turn's first step, for actions that crop a region of it. Held in memory by the page and replaced
   * by the next one; never written anywhere.
   */
  | { kind: 'screenshot'; url: string }
  /**
   * The pen: while on (the chord is held, on the display under the pointer) the window takes mouse
   * input and the page draws what the user drags as a visible stroke, reporting it with `stroke`.
   * The stroke stays until the first `step` of the answer arrives, then fades; a new `pen on` removes it.
   */
  | { kind: 'pen'; on: boolean }
  | { kind: 'begin'; turn: number }
  | { kind: 'step'; step: Step }
  | { kind: 'end'; escalate?: string }
  /**
   * hush: the chord was made, stop any speech still going now (marks stay; no cue);
   * listening: recording has really started (show the cue);
   * working: released, waiting for the first step; idle: hide the cue and the indicator.
   */
  | { kind: 'status'; status: 'hush' | 'listening' | 'working' | 'backend' | 'idle' }
  /** A short line that fades by itself. */
  | { kind: 'notice'; text: string; level: 'info' | 'error' };


/** What the hidden audio page records while the chord is held: mono, 16 kHz, floats in -1..1. */
export type MicResult = { samples: Float32Array; sampleRate: 16000; durationMs: number; startLatencyMs: number };

/** What the hidden media page grabs of a screen: one frame, scaled, as PNG bytes. */
/** Compose request: draw strokes onto the frame grabbed under id `grab`, and crop around them from the full-resolution frame. */
export type ComposeRequest = { id: number; grab: number; maxEdge: number; cropEdge: number; strokes: Array<Array<[number, number]>> };
export type ComposeResult = {
  id: number;
  /** The screenshot with the strokes drawn on it. */
  full: { png: Uint8Array; width: number; height: number };
  /** A higher-resolution crop of the strokes' padded bounding box, without the strokes. */
  crop: { png: Uint8Array; width: number; height: number };
  /** The crop's box on the 0..1000 scale of the full screenshot. */
  box: { x: number; y: number; w: number; h: number };
};
/** Checks only: decode this PNG as if it had been grabbed from a screen. */
export type UseImageRequest = { id: number; png: Uint8Array; maxEdge: number };

export type GrabRequest = { id: number; sourceId: string; maxEdge: number; nativeWidth: number; nativeHeight: number };
export type FrameResult = { id: number; png: Uint8Array; width: number; height: number; nativeWidth: number; nativeHeight: number; ms: number };

export const AUDIO_CHANNEL = {
  start: 'tt:mic-start',
  /** main -> page: stop and decode the clip. */
  stop: 'tt:mic-stop',
  /** main -> page: stop and throw the clip away. */
  abort: 'tt:mic-abort',
  result: 'tt:mic-result',
  error: 'tt:mic-error',
  /** page -> main: the recorder has really started. */
  started: 'tt:mic-started',
  /** main -> page: grab one frame of the screen the display-media handler is set to. */
  grab: 'tt:cap-grab',
  frame: 'tt:cap-frame',
  frameError: 'tt:cap-error',
  compose: 'tt:cap-compose',
  composed: 'tt:cap-composed',
  composeError: 'tt:cap-compose-error',
  useImage: 'tt:cap-use-image',
  release: 'tt:cap-release',
} as const;

export interface TalkthroughAudioApi {
  onStart(listener: () => void): void;
  onStop(listener: () => void): void;
  onAbort(listener: () => void): void;
  onGrab(listener: (request: GrabRequest) => void): void;
  result(result: MicResult): void;
  error(message: string): void;
  started(): void;
  frame(result: FrameResult): void;
  frameError(id: number, message: string): void;
  onCompose(listener: (request: ComposeRequest) => void): void;
  composed(result: ComposeResult): void;
  composeError(id: number, message: string): void;
  onUseImage(listener: (request: UseImageRequest) => void): void;
  /** The question is over: close the full-resolution frame held under this grab id. */
  onRelease(listener: (grabId: number) => void): void;
}

/** The small settings window (API key entry). The key only ever travels page -> main. */
export const SETTINGS_CHANNEL = {
  status: 'tt:key-status',
  save: 'tt:key-save',
  clear: 'tt:key-clear',
} as const;

export interface TalkthroughSettingsApi {
  /** Whether a key can be stored here, and whether one is saved. Never the key. */
  status(): Promise<{ available: boolean; saved: boolean }>;
  save(key: string): Promise<{ ok: true } | { ok: false; message: string }>;
  clear(): Promise<void>;
}

export interface TalkthroughApi {
  /** Tell main the page is ready; main answers with onDisplay. */
  ready(): void;
  onDisplay(listener: (display: DisplayInfo) => void): void;
  onScene(listener: (message: SceneMessage) => void): void;
  /** True while the pointer is over the draggable 3D panel; main stops clicks passing through. */
  setInteractive(over: boolean): void;
  rendered(token: number): void;
  done(): void;
  /** The user clicked the escalation offer. */
  offer(): void;
  /** A piece of a pen stroke, while the pen is on. */
  stroke(stroke: Stroke): void;
  /** The first mark drawn or first word spoken of a live turn (for latency measurement). */
  milestone(milestone: Milestone): void;
}

declare global {
  interface Window {
    talkthrough: TalkthroughApi;
    talkthroughAudio: TalkthroughAudioApi;
    talkthroughSettings: TalkthroughSettingsApi;
  }
}
