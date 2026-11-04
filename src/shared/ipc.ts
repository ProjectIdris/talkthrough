// The contract between the main process and the overlay renderer. Main validates a scene
// (src/scene) before it sends it; the renderer draws what it is given and nothing else.
// The preload script exposes `window.talkthrough` (TalkthroughApi) to the overlay page.

import type { Scene } from '../scene/types.ts';

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
} as const;

export type DisplayInfo = {
  id: number;
  /** The display in device-independent pixels; the overlay window covers exactly this. */
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  /** For development and frame grabs only: an image file URL to show behind the drawing. */
  backdrop?: string;
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
  | { kind: 'seek'; scene: Scene; step: number; t: number; token: number };


/** What the hidden audio page records while the chord is held: mono, 16 kHz, floats in -1..1. */
export type MicResult = { samples: Float32Array; sampleRate: 16000; durationMs: number; startLatencyMs: number };

export const AUDIO_CHANNEL = {
  start: 'tt:mic-start',
  stop: 'tt:mic-stop',
  result: 'tt:mic-result',
  error: 'tt:mic-error',
} as const;

export interface TalkthroughAudioApi {
  onStart(listener: () => void): void;
  onStop(listener: () => void): void;
  result(result: MicResult): void;
  error(message: string): void;
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
}

declare global {
  interface Window {
    talkthrough: TalkthroughApi;
    talkthroughAudio: TalkthroughAudioApi;
  }
}
