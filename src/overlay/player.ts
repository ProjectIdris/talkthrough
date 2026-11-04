// Plays scenes step by step in real time. Each step starts when its speech starts and runs over
// the utterance; the next step is spoken once the speech has ended and the step's drawing has
// finished. With no real voice the silent voice paces steps by their word count.
//
// The player is driven by `update()` (once per animation frame) and holds no timers of its own
// apart from the silent voice's, so tests can drive it with a fake clock and a fake voice.

import type { Voice } from '../adapters/voice.ts';
import type { Scene } from '../scene/types.ts';
import { emptyFrame, estimateSpeechSeconds, evaluate, frameAt, planStep, settle, shiftCamera } from './timeline.ts';
import type { Frame, StepPlan } from './timeline.ts';
import type { Step } from '../scene/types.ts';

/** If a voice neither starts nor ends within this long, the step plays anyway. */
export const VOICE_PATIENCE_MS = 2500;
const MIN_SPEED = 0.6;
const MAX_SPEED = 1.6;

export type Clock = { now(): number; after(ms: number, fn: () => void): () => void };

export const realClock: Clock = {
  now: () => performance.now(),
  after: (ms, fn) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
};

/** A voice that says nothing and takes as long as the words would. */
export function createSilentVoice(clock: Clock = realClock): Voice {
  const live = new Set<() => void>();
  return {
    id: 'silent',
    speak(text, listener = {}) {
      const ms = estimateSpeechSeconds(text) * 1000;
      let ended = false;
      let settle!: (e: { reason: 'finished' | 'cancelled' | 'error' }) => void;
      const finished = new Promise<{ reason: 'finished' | 'cancelled' | 'error' }>((r) => (settle = r));
      const stopStart = clock.after(0, () => listener.start?.({ estimatedMs: ms }));
      const stopEnd = clock.after(ms, () => finish('finished'));
      const finish = (reason: 'finished' | 'cancelled') => {
        if (ended) return;
        ended = true;
        stopStart();
        stopEnd();
        live.delete(cancel);
        listener.end?.({ reason });
        settle({ reason });
      };
      const cancel = () => finish('cancelled');
      live.add(cancel);
      return { finished, cancel };
    },
    cancel() {
      for (const c of [...live]) c();
    },
  };
}

type Phase = 'idle' | 'waiting' | 'running';

export type PlayerOptions = {
  voice: Voice;
  clock?: Clock;
  /** Called when the last step of a played scene has finished. */
  onDone?: () => void;
};

export class Player {
  private voice: Voice;
  private clock: Clock;
  private onDone: (() => void) | undefined;

  private phase: Phase = 'idle';
  /** The Frame before the current step (or the settled world when idle). */
  private base: Frame = emptyFrame();
  private plan: StepPlan | undefined;
  /** The last plan, kept when idle so a drag can still move the camera and the next play starts from it. */
  private resting: StepPlan | undefined;
  private steps: readonly Step[] = [];
  private index = 0;
  private generation = 0;

  private speechStarted = false;
  private speechEnded = false;
  private waitingSince = 0;
  private startedAt = 0;
  private speed = 1;
  private frozen: Frame | undefined;

  constructor(options: PlayerOptions) {
    this.voice = options.voice;
    this.clock = options.clock ?? realClock;
    this.onDone = options.onDone;
  }

  /** True while a scene is playing (the caller keeps animating). */
  get active(): boolean {
    return this.phase !== 'idle';
  }

  /** Plays a validated scene on top of what is already drawn; a scene in progress is finished off first. */
  play(scene: Scene): void {
    this.stop();
    this.frozen = undefined;
    this.steps = scene.steps;
    this.index = 0;
    if (scene.steps.length === 0) {
      this.finishScene();
      return;
    }
    this.beginStep();
  }

  /** Frame-grab mode: shows the scene as it is `t` seconds into step `step`, with no clock and no speech. */
  seek(scene: Scene, step: number, t: number): void {
    this.stop();
    this.base = emptyFrame();
    this.resting = undefined;
    this.frozen = frameAt(scene.steps, step, t);
    this.phase = 'idle';
  }

  /** Removes everything drawn and stops speaking. */
  clear(): void {
    this.stop();
    this.base = emptyFrame();
    this.resting = undefined;
    this.frozen = undefined;
  }

  /** A user drag of the 3D panel: moves the camera, and later camera actions start from there. */
  dragCamera(dAz: number, dEl: number): void {
    if (this.frozen) {
      this.frozen = { ...this.frozen, camera: { ...this.frozen.camera, az: this.frozen.camera.az + dAz, el: Math.max(-89, Math.min(89, this.frozen.camera.el + dEl)) } };
      return;
    }
    const plan = this.plan ?? this.resting;
    if (plan) shiftCamera(plan, dAz, dEl);
    if (!plan || this.phase === 'waiting') {
      this.base = { ...this.base, camera: { ...this.base.camera, az: this.base.camera.az + dAz, el: Math.max(-89, Math.min(89, this.base.camera.el + dEl)) } };
    }
  }

  /** Advances the state machine and returns what to draw now. */
  update(): Frame {
    if (this.frozen) return this.frozen;
    const now = this.clock.now();
    if (this.phase === 'waiting' && now - this.waitingSince > VOICE_PATIENCE_MS) {
      // A voice that never answers must not stall the picture.
      this.speechEnded = true;
      this.startClock(now, undefined);
    }
    if (this.phase === 'running' && this.plan) {
      const t = ((now - this.startedAt) / 1000) * this.speed;
      if (this.speechEnded && t >= this.plan.duration) {
        this.base = settle(this.plan);
        this.resting = this.plan;
        this.plan = undefined;
        this.index++;
        if (this.index < this.steps.length) this.beginStep();
        else this.finishScene();
        return this.update();
      }
      return evaluate(this.plan, t);
    }
    if (this.phase === 'waiting') return this.base;
    return this.resting ? settle(this.resting) : this.base;
  }

  private stop(): void {
    this.generation++;
    this.voice.cancel();
    if (this.plan) {
      this.base = settle(this.plan);
      this.resting = this.plan;
    } else if (this.resting) {
      this.base = settle(this.resting);
    }
    this.plan = undefined;
    this.phase = 'idle';
  }

  private finishScene(): void {
    this.phase = 'idle';
    this.plan = undefined;
    this.onDone?.();
  }

  private beginStep(): void {
    const step = this.steps[this.index] as Step;
    this.plan = planStep(this.base, step);
    this.phase = 'waiting';
    this.speechStarted = false;
    this.speechEnded = false;
    this.waitingSince = this.clock.now();
    const generation = this.generation;
    const say = step.say.trim();
    if (!say) {
      this.speechEnded = true;
      this.startClock(this.clock.now(), undefined);
      return;
    }
    this.voice.speak(say, {
      start: (e) => {
        if (generation !== this.generation || this.speechStarted) return;
        this.startClock(this.clock.now(), e.estimatedMs);
      },
      end: () => {
        if (generation !== this.generation) return;
        this.speechEnded = true;
        // Ended without ever starting (no voice available): play the drawing now.
        if (!this.speechStarted) this.startClock(this.clock.now(), undefined);
      },
    });
  }

  private startClock(now: number, estimatedMs: number | undefined): void {
    if (this.phase !== 'waiting' || !this.plan) return;
    this.speechStarted = true;
    this.phase = 'running';
    this.startedAt = now;
    const step = this.steps[this.index] as Step;
    const authored = estimateSpeechSeconds(step.say);
    const actual = estimatedMs && estimatedMs > 0 ? estimatedMs / 1000 : authored;
    this.speed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, authored / actual));
  }
}
