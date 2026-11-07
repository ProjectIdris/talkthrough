// Plays scenes step by step in real time. Each step starts when its speech starts and runs over
// the utterance; the next step is spoken once the speech has ended and the step's drawing has
// finished. With no real voice the silent voice paces steps by their word count.
//
// The player is driven by `update()` (once per animation frame) and holds no timers of its own
// apart from the silent voice's, so tests can drive it with a fake clock and a fake voice.

import type { Voice } from '../adapters/voice.ts';
import type { CaptionDriver } from './captions.ts';
import type { Scene } from '../scene/types.ts';
import { ExplodeValue } from './explode.ts';
import { IDLE_MAX_SECONDS, emptyFrame, estimateSpeechSeconds, evaluate, frameAt, movedCamera, planStep, settle, shiftCamera, withIdleTurn, withMotion } from './timeline.ts';
import { emptyMotion, freezeMotion, isMoving } from './motion.ts';
import type { Motion } from './motion.ts';
import type { Frame, StepPlan } from './timeline.ts';
import type { Action, Step } from '../scene/types.ts';

/** If a voice neither starts nor ends within this long, the step plays anyway. */
export const VOICE_PATIENCE_MS = 2500;
/** The wait a voice server is given before the system voice takes over is the patience too, with this much more for the system voice to begin. */
export const VOICE_PATIENCE_MARGIN_MS = 1500;
const MIN_SPEED = 0.6;
const MAX_SPEED = 1.6;
/** A machine left running when the scene is done keeps turning this long, then rests where it is. */
const MOTION_MAX_SECONDS = 120;

export type Clock = { now(): number; after(ms: number, fn: () => void): () => void };

export const realClock: Clock = {
  now: () => performance.now(),
  after: (ms, fn) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
};

/** A voice that says nothing and takes as long as the words would. */
export function createSilentVoice(clock: Clock = realClock, seconds: (text: string) => number = estimateSpeechSeconds): Voice {
  const live = new Set<() => void>();
  return {
    id: 'silent',
    speak(text, listener = {}) {
      const ms = seconds(text) * 1000;
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
  /** Called each time a step's speech really starts (the voice's start event). */
  onSpeechStart?: () => void;
  /** Told of each step's words as they are said (or, with text only, as the step begins), for the captions. */
  captions?: CaptionDriver;
};

export class Player {
  private voice: Voice;
  private clock: Clock;
  private onDone: (() => void) | undefined;
  private onSpeechStart: (() => void) | undefined;
  private captions: CaptionDriver | undefined;

  private phase: Phase = 'idle';
  /** The Frame before the current step (or the settled world when idle). */
  private base: Frame = emptyFrame();
  private plan: StepPlan | undefined;
  /** The last plan, kept when idle so a drag can still move the camera and the next play starts from it. */
  private resting: StepPlan | undefined;
  /** What was turning when the world last came to rest, and the clock time that was: a machine goes on turning from there. */
  private restMotion: Motion = emptyMotion();
  private restAt = 0;
  /** How far into the running step the clock has got (scene seconds), for the angle a machine settles at. */
  private lastT = 0;
  private steps: readonly Step[] = [];
  /** The step still being written (its actions arrive one by one), if any, and the latest start time given to one of its actions. */
  private openIndex: number | null = null;
  private openLastAt = 0;
  /** Original instructions for display-retimed actions; no runtime timing leaks into saved scenes. */
  private readonly authoredActions = new WeakMap<Action, Action>();
  /** A turn is open: more steps may still arrive, so running out of steps is not the end. */
  private live = false;
  private index = 0;
  private generation = 0;

  private speechStarted = false;
  /** When the finished scene began its idle turn (clock time), if it has. */
  private idleAt: number | undefined;
  private speechEnded = false;
  private waitingSince = 0;
  /** How long a step waits for its voice to begin before it plays on without it. */
  private patienceMs = VOICE_PATIENCE_MS;
  private startedAt = 0;
  private speed = 1;
  private frozen: Frame | undefined;
  /** The person's Explode control, and the camera the finished scene ended with (what a double click returns to). */
  private readonly explodeValue = new ExplodeValue();
  /** The person's Cut control: the model cut through the middle from the front, eased in and out like Explode. */
  private readonly cutValue = new ExplodeValue();
  private home: Frame['camera'] | undefined;
  /** A detail pass is being drawn: its words are not spoken (they only name what each step adds). */
  private quiet = false;

  constructor(options: PlayerOptions) {
    this.voice = options.voice;
    this.clock = options.clock ?? realClock;
    this.onDone = options.onDone;
    this.onSpeechStart = options.onSpeechStart;
    this.captions = options.captions;
  }

  /** Sets (or removes) the captions, once the page knows what the person chose. */
  setCaptions(captions: CaptionDriver | undefined): void {
    this.captions?.clear();
    this.captions = captions;
  }

  /** A voice that is a server may be given longer to make its first sound (see VOICE_PATIENCE_MARGIN_MS): the step waits as long. */
  setPatience(ms: number): void {
    this.patienceMs = Math.max(VOICE_PATIENCE_MS, Math.round(ms));
  }

  /** Swaps the voice (a development run with no speech). */
  setVoice(voice: Voice): void {
    this.voice = voice;
  }

  /**
   * The user started a new question: stop speaking now and let nothing more be spoken. The step in
   * progress finishes drawing; steps still queued, and any the model has yet to send, are dropped.
   */
  hush(): void {
    this.voice.cancel();
    this.live = false;
    this.openIndex = null;
    this.steps = this.steps.slice(0, this.index + 1);
  }

  /**
   * Escape: stop everything now. The voice and captions stop, the step in progress jumps to where it was going (so it can be seen to fade, not
   * freeze half drawn), and steps still queued, and any the model has yet to send, are dropped. Nothing is cleared; the caller fades it away.
   */
  silence(): void {
    this.stop();
    this.live = false;
    this.steps = this.steps.slice(0, this.index + 1);
  }

  /** True while a scene is playing (the caller keeps animating). */
  get active(): boolean {
    return this.phase !== 'idle' || this.idling || this.running || this.explodeValue.moving(this.clock.now()) || this.cutValue.moving(this.clock.now());
  }

  /** True while a machine in the finished scene is turning. */
  get running(): boolean {
    if (this.frozen) return false;
    return isMoving(this.restMotion) && this.clock.now() - this.restAt < MOTION_MAX_SECONDS * 1000;
  }

  /** True while the finished scene is turning slowly by itself. */
  get idling(): boolean {
    return this.idleAt !== undefined && (this.clock.now() - this.idleAt) / 1000 < IDLE_MAX_SECONDS + 1;
  }

  /** Ends the idle turn where it is (the scene went out of sight, or something else takes the camera). */
  stopIdle(): void {
    if (this.idleAt === undefined) return;
    this.rebase(withIdleTurn(this.restFrame(), (this.clock.now() - this.idleAt) / 1000));
    this.resting = undefined;
    this.idleAt = undefined;
  }

  /** The world as it stands now with no step running: settled, and a machine in it still turning. */
  private restFrame(): Frame {
    const rest = this.resting ? settle(this.resting) : this.base;
    return withMotion(rest, Math.min(MOTION_MAX_SECONDS, (this.clock.now() - this.restAt) / 1000), this.restMotion);
  }

  private rebase(frame: Frame): void {
    this.base = frame;
    this.restMotion = frame.motion;
    this.restAt = this.clock.now();
  }

  /** The user took hold of the model: whatever was turning stops where it is. */
  private freezeMachine(): void {
    if (this.phase !== 'idle' || this.frozen) return;
    const frame = this.restFrame();
    if (!isMoving(frame.motion)) return;
    this.rebase({ ...frame, motion: freezeMotion(frame.motion) });
    this.resting = undefined;
  }

  /** Plays a validated scene on top of what is already drawn; a scene in progress is finished off first. */
  play(scene: Scene): void {
    this.beginTurn();
    for (const step of scene.steps) this.pushStep(step);
    this.endTurn();
  }

  /**
   * Live play: opens a turn whose steps arrive one at a time with pushStep, as a model writes them.
   * What is drawn stays; a turn in progress is finished off first.
   */
  beginTurn(detail = false): void {
    this.stop();
    this.quiet = detail;
    // A detail pass adds to the model the person may have opened and turned: their explode and the camera a double
    // click returns to are left as they are.
    if (!detail) {
      this.explodeValue.reset();
      this.cutValue.reset();
      this.home = undefined;
    }
    this.frozen = undefined;
    this.steps = [];
    this.openIndex = null;
    this.index = 0;
    this.live = true;
  }

  /** Adds a validated step to the open turn. The first starts at once; the rest queue behind it. */
  pushStep(step: Step): void {
    if (!this.live) this.beginTurn();
    this.steps = [...this.steps, step];
    if (this.phase === 'idle' && this.index === this.steps.length - 1) this.beginStep();
  }

  /**
   * Opens a step whose actions will arrive one by one (addAction), closed with closeStep. Its words are spoken
   * as soon as it is the step in turn, so speech starts without waiting for the drawing.
   */
  openStep(say: string): void {
    if (!this.live) this.beginTurn();
    this.steps = [...this.steps, { say, actions: [] }];
    this.openIndex = this.steps.length - 1;
    this.openLastAt = 0;
    if (this.phase === 'idle' && this.index === this.steps.length - 1) this.beginStep();
  }

  /**
   * Adds a validated action to the open step. In the step being played it starts now, or at its own `at` if that
   * is later, so a part drawn as the model writes it appears as it arrives and an exploded model assembles in view.
   * Actions keep the order they arrive in.
   */
  addAction(action: Action): void {
    const i = this.openIndex;
    const step = i === null ? undefined : this.steps[i];
    if (i === null || !step) return;
    let at = Math.max(0, action.at ?? 0);
    if (i === this.index && this.phase === 'running') at = Math.max(at, ((this.clock.now() - this.startedAt) / 1000) * this.speed);
    at = Math.max(at, this.openLastAt);
    this.openLastAt = at;
    const displayed = { ...action, at } as Action;
    this.authoredActions.set(displayed, action);
    const next: Step = { say: step.say, actions: [...step.actions, displayed] };
    this.steps = this.steps.map((s, j) => (j === i ? next : s));
    // The plan of the step in progress is made again with the new action in it; what was already planned keeps its times.
    if (i === this.index && (this.phase === 'running' || this.phase === 'waiting')) this.plan = this.planAuthoredStep(next);
  }

  /** The open step is whole. */
  closeStep(): void {
    this.openIndex = null;
  }

  /** No more steps will come. Once the queued steps have played the scene is done. */
  endTurn(): void {
    if (!this.live) return;
    this.openIndex = null;
    this.live = false;
    if (this.phase === 'idle' && this.index >= this.steps.length) this.finishScene();
  }

  /** Frame-grab mode: shows the scene as it is `t` seconds into step `step`, with no clock and no speech. `view` turns, zooms or opens the model as a person could. */
  seek(scene: Scene, step: number, t: number, view?: { az?: number; el?: number; zoom?: number; explode?: number }): void {
    this.stop();
    this.live = false;
    this.rebase(emptyFrame());
    this.resting = undefined;
    const frame = frameAt(scene.steps, step, t, emptyFrame(), true);
    const camera = view ? movedCamera({ az: view.az ?? frame.camera.az, el: view.el ?? frame.camera.el, zoom: view.zoom ?? frame.camera.zoom }, 0, 0) : frame.camera;
    this.frozen = { ...frame, camera: { ...frame.camera, ...camera } };
    this.explodeValue.jump(view?.explode ?? 0);
    this.phase = 'idle';
  }

  /** Removes everything drawn and stops speaking. */
  clear(): void {
    this.stop();
    this.quiet = false;
    this.explodeValue.reset();
    this.cutValue.reset();
    this.home = undefined;
    this.live = false;
    this.rebase(emptyFrame());
    this.resting = undefined;
    this.frozen = undefined;
  }

  /** A user drag of the 3D panel: moves the camera, and later camera actions start from there. */
  dragCamera(dAz: number, dEl: number): void {
    this.moveCamera(dAz, dEl, 1);
  }

  /** A user zoom of the 3D panel (the wheel): multiplies the zoom, within limits. */
  zoomCamera(factor: number): void {
    if (!(factor > 0) || factor === 1) return;
    this.moveCamera(0, 0, factor);
  }

  /** A double click: the camera goes back to where the scene left it, and the model closes up. */
  resetCamera(): void {
    this.explodeValue.set(false, this.clock.now());
    const home = this.home;
    if (!home) return;
    this.stopIdle();
    const now = this.frameNow().camera;
    this.moveCamera(home.az - now.az, home.el - now.el, home.zoom / Math.max(1e-6, now.zoom));
  }

  /** The Explode control: opens the model, or closes it again. */
  toggleExplode(): void {
    this.explodeValue.toggle(this.clock.now());
  }

  /** Opens (true) or closes the model by the person's control. */
  setExplode(open: boolean): void {
    this.explodeValue.set(open, this.clock.now());
  }

  /** The Cut control: cuts the model open through its middle, or makes it whole again. */
  toggleCut(): void {
    this.cutValue.toggle(this.clock.now());
  }

  /** True when the model is cut or being cut by the person's control. */
  get cut(): boolean {
    return this.cutValue.open;
  }

  /** True when the model is open or opening by the person's control. */
  get exploded(): boolean {
    return this.explodeValue.open;
  }

  /** True once a finished model could be turned, zoomed or exploded (no step is being played or written). */
  get settled(): boolean {
    if (this.frozen) return this.frozen.panel !== null;
    return this.phase === 'idle' && !this.live && this.openIndex === null && this.base.panel !== null;
  }

  private moveCamera(dAz: number, dEl: number, zoomBy: number): void {
    this.stopIdle();
    this.freezeMachine();
    if (this.frozen) {
      this.frozen = { ...this.frozen, camera: { ...this.frozen.camera, ...movedCamera(this.frozen.camera, dAz, dEl, zoomBy) } };
      return;
    }
    const plan = this.plan ?? this.resting;
    if (plan) shiftCamera(plan, dAz, dEl, zoomBy);
    if (!plan || this.phase === 'waiting') {
      this.base = { ...this.base, camera: { ...this.base.camera, ...movedCamera(this.base.camera, dAz, dEl, zoomBy) } };
    }
  }

  /** Advances the state machine and returns what to draw now. */
  update(): Frame {
    const frame = this.frameNow();
    const open = this.explodeValue.value(this.clock.now());
    const cut = this.cutValue.value(this.clock.now());
    if (open <= 0.0005 && cut <= 0.0005) return frame;
    return { ...frame, ...(open > 0.0005 ? { userExplode: open } : {}), ...(cut > 0.0005 ? { userCut: cut } : {}) };
  }

  private frameNow(): Frame {
    if (this.frozen) return this.frozen;
    const now = this.clock.now();
    if (this.phase === 'waiting' && now - this.waitingSince > this.patienceMs) {
      // A voice that never answers must not stall the picture.
      this.speechEnded = true;
      this.startClock(now, undefined);
    }
    if (this.phase === 'running' && this.plan) {
      const t = ((now - this.startedAt) / 1000) * this.speed;
      this.lastT = t;
      if (this.speechEnded && t >= this.plan.duration && this.openIndex !== this.index) {
        this.rebase(settle(this.plan, t));
        this.resting = this.plan;
        this.plan = undefined;
        this.index++;
        if (this.index < this.steps.length) this.beginStep();
        else if (!this.live) this.finishScene();
        else this.phase = 'idle';
        return this.frameNow();
      }
      return evaluate(this.plan, t);
    }
    if (this.phase === 'waiting') return withMotion(this.base, (now - this.restAt) / 1000, this.restMotion);
    const rest = this.restFrame();
    return this.idleAt === undefined ? rest : withIdleTurn(rest, (now - this.idleAt) / 1000);
  }

  private stop(): void {
    this.stopIdle();
    this.openIndex = null;
    this.generation++;
    this.voice.cancel();
    this.captions?.clear();
    if (this.plan) {
      this.rebase(settle(this.plan, this.phase === 'running' ? this.lastT : Infinity));
      this.resting = this.plan;
    } else if (this.resting) {
      this.rebase(this.restFrame());
    }
    this.plan = undefined;
    this.phase = 'idle';
  }

  private finishScene(): void {
    this.phase = 'idle';
    this.plan = undefined;
    if (!this.quiet || !this.home) this.home = { ...this.base.camera };
    if (this.base.panel && !this.quiet) this.idleAt = this.clock.now();
    this.onDone?.();
  }

  private planAuthoredStep(step: Step): StepPlan {
    return planStep(this.base, step, step.actions.map((a) => this.authoredActions.get(a) ?? a));
  }

  private beginStep(): void {
    const step = this.steps[this.index] as Step;
    this.plan = this.planAuthoredStep(step);
    this.phase = 'waiting';
    this.speechStarted = false;
    this.speechEnded = false;
    this.waitingSince = this.clock.now();
    const generation = this.generation;
    const say = this.quiet ? '' : step.say.trim();
    this.captions?.stepStart(say);
    if (!say) {
      this.speechEnded = true;
      this.startClock(this.clock.now(), undefined);
      return;
    }
    this.voice.speak(say, {
      start: (e) => {
        if (generation !== this.generation || this.speechStarted) return;
        this.startClock(this.clock.now(), e.estimatedMs);
        this.captions?.voiceStart(e.estimatedMs);
        this.onSpeechStart?.();
      },
      // Word events only when there are captions to give them to (the streamed voice follows the sound for them, which costs a ticker).
      ...(this.captions
        ? {
          boundary: (e: { charIndex: number }) => {
            if (generation === this.generation) this.captions?.boundary(e.charIndex);
          },
        }
        : {}),
      end: () => {
        if (generation !== this.generation) return;
        this.captions?.voiceEnd();
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
    // A machine kept turning while the step waited for its voice; the step's own plan goes on from where it got to.
    if (isMoving(this.restMotion)) {
      this.rebase(withMotion(this.base, (now - this.restAt) / 1000, this.restMotion));
      this.plan = this.planAuthoredStep(step);
    }
    this.lastT = 0;
    const authored = estimateSpeechSeconds(step.say);
    const actual = estimatedMs && estimatedMs > 0 ? estimatedMs / 1000 : authored;
    this.speed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, authored / actual));
  }
}
