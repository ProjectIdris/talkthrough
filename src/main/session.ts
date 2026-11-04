import type { Backend } from '../adapters/backend.ts';
import { ModelError } from '../adapters/model.ts';
import { NO_KEY_MESSAGE } from '../adapters/openai-model.ts';
import type { FocusCrop, Model, ModelOutput, ModelRequest, ThreadTurn, Usage } from '../adapters/model.ts';
import { SpeechToTextError } from '../adapters/speech-to-text.ts';
import type { SpeechToText } from '../adapters/speech-to-text.ts';
import type { Screenshot } from '../adapters/types.ts';
import { applyClear, beginLiveStep, createDetailState, createSceneState, orderScore, sceneSchemaLean, startTurn, validateEscalate, validateStep } from '../scene/index.ts';
import type { LiveStep, SceneState, Step } from '../scene/index.ts';
import { FADE_AFTER_MS } from '../shared/ipc.ts';
import type { MicResult, Milestone, SceneMessage, Stroke } from '../shared/ipc.ts';
import { isRealStroke } from '../shared/pen.ts';
import { createGuide, guideQuestion, waitOf } from './guide.ts';
import { parseConsent } from './nav-consent.ts';
import type { Frame, GuideListener, GuideNavigation, GuideOptions } from './guide.ts';
import type { Grid } from '../shared/screen-diff.ts';
import type { SkipVerdict } from './skip-list.ts';
import { parseSpoken } from './phrases.ts';
import type { Box, Point } from '../shared/pen.ts';

/** Everything the question loop needs from the outside, so it can be tested without a window or a microphone. */
export type SessionDeps = {
  /** Which display the pointer is on now. */
  pointerDisplayId(): number;
  media: {
    startMic(): Promise<void>;
    stopMic(): Promise<MicResult>;
    abortMic(): void;
    capture(displayId: number): Promise<Grab>;
    /**
     * Draws the strokes onto the frame grabbed under `grabId` and crops around them from the
     * full-resolution frame. Absent when this build cannot (then the plain screenshot is used).
     */
    release?(grabId: number): void;
    compose?(grabId: number, strokes: Point[][]): Promise<{ screenshot: Screenshot; focus: FocusCrop[] }>;
  };
  /**
   * Turns the pen on for one display (its overlay takes the mouse) or, with null, off everywhere and
   * gives click-through back. The session calls null on every way out of a held chord.
   */
  setPen(displayId: number | null): void;
  /** Null when no speech server is set up. */
  speech: SpeechToText | null;
  model(): Model;
  /**
   * The detail model, when the person has set one up (the settings name its route). Absent: there is no detail pass,
   * and nothing offers it. It is asked only when the person asks for more detail, never by itself.
   */
  detailModel?(): Model | undefined;
  /** The deeper backend, when the user has set one up (their settings name its address). Absent: none. */
  backend?: Backend;
  send(displayId: number, message: SceneMessage): void;
  log(line: string): void;
  /** Checks only: put the question text in the log. Off by default, so a spoken question never reaches the console. */
  logText?: boolean;
  /** How long the first key of the chord may be held alone before the early microphone and capture are dropped. */
  micWindowMs: number;
  /**
   * Whether the person's list of windows to skip forbids a press now (the window in front is on it, or could not be told, which counts
   * the same): null when it is allowed. A forbidden press does nothing: no microphone, no screen grab. Absent: no list. Asked at each
   * key event, and presses are then handled in order, each after its answer; without it everything is immediate, as before.
   */
  skipped?(): Promise<SkipVerdict | null>;
  /** Epoch milliseconds. */
  now?(): number;
  /** Waits this long (default: a timer). Checks give it a clock of their own so a wait cannot race the test. */
  sleep?(ms: number): Promise<void>;
  /**
   * Keeps an answer (see pins.ts). Absent: pinning is not available. `screenshot` is given only when the
   * person has chosen to keep a picture of the screen with their pins.
   */
  pin?(input: { question: string; thread: readonly ThreadTurn[]; steps: readonly unknown[]; screenshot?: Screenshot }): { file: string };
  /** Whether the person has chosen to keep a picture of the screen with pins. */
  pinScreenshot?(): boolean;
  /**
   * Guide mode (see guide.ts): a fresh look at a display, and the person's clicks and Escape while a step waits for them.
   * Absent: a `wait` in an answer is ignored and the steps all play at once.
   */
  guide?: {
    capture(displayId: number): Promise<Frame>;
    /** The coarse brightness grid of a screenshot (so the guide can compare the screen with the picture the model was given). */
    gridOf?(shot: Screenshot): Grid;
    listen(displayId: number, listener: GuideListener): () => void;
    /** Timings of the walk (when to look at the screen after a click, how long to wait); the defaults are in guide.ts. */
    options?: Partial<GuideOptions>;
    /** The app's own hands (open a tab or menu, scroll), when the person has allowed them (see guide-nav.ts). Absent: it only points. */
    navigation?: GuideNavigation;
  };
  /**
   * The real controls of the window in front (see uia.ts), on the 0..1000 scale of the display. Started when the key goes
   * down and never waited for: a read that is late, fails or finds nothing just leaves marks snapping to the picture.
   * Absent: no such reading (another system, or the person turned it off).
   */
  controls?: {
    read(displayId: number, signal?: AbortSignal): Promise<{ boxes: { x: number; y: number; w: number; h: number; kind: string }[]; ms: number; why?: string }>;
  };
  /** Called with the figures of a question when it ends, and again as the page reports its milestones. */
  onReport?(report: QuestionReport): void;
};

export type QuestionReport = {
  model: string;
  question: string;
  /** Milliseconds after the keys were released. */
  transcriptMs?: number;
  /** Which recogniser answered and how long it says it took (no text). */
  speech?: string;
  captureMs?: number;
  firstPieceMs?: number;
  firstStepMs?: number;
  endMs?: number;
  firstMarkMs?: number;
  firstWordMs?: number;
  /** The read of the screen's real controls: how long it took (milliseconds after the keys went down) and how many it found. */
  controlsMs?: number;
  controlsCount?: number;
  steps: number;
  /** What the model says the question cost, when it says. */
  tokens?: Usage;
  /** The person circled something with the pen and the model was shown it. */
  circled?: boolean;
  /** How well the answer built in order (1: everything came after what it refers to); see orderScore. */
  order?: { score: number; refs: number; early: number; missing: number; wrong: number };
  escalate?: string;
  /** This was a detail pass (a richer version of the scene on screen), not a question. */
  detail?: boolean;
  /** The answer broke after some steps had been shown (what the page had stays; see answer): what broke it. Not an error. */
  cutShort?: string;
  error?: string;
};

/** What a screen grab gives: the picture, how long it took, and (if the media page kept it) the id of the full-resolution frame. */
type Grab = { screenshot: Screenshot; ms: number; grabId?: number };

/**
 * After release, how long an unfinished stroke may still be waiting for its last piece, counted in the steps of `STROKE_TAIL_STEP_MS` the wait is
 * made of (not by the clock): a machine that is busy or has a coarse timer waits longer and never less, so it cannot cut a tail it would have caught.
 */
export const STROKE_TAIL_MS = 150;
export const STROKE_TAIL_STEP_MS = 10;

/** Shortest recording that counts as a question. */
const MIN_CLIP_MS = 400;
/** A new question within this long of the last answer continues it (the page fades a scene after FADE_AFTER_MS). */
const THREAD_WINDOW_MS = FADE_AFTER_MS + 3000;

type Attempt = {
  id: number;
  displayId: number;
  capture: Promise<Grab>;
  /** The read of the real controls, started with the capture and ended with it if the press is dropped. */
  controls?: { done: Promise<{ boxes: { x: number; y: number; w: number; h: number; kind: string }[]; ms: number; why?: string }>; abort: AbortController };
  /** The pen strokes of this press, by stroke id, in the 0..1000 scale. */
  strokes: Map<number, Point[]>;
  /** Stroke ids whose last piece (`done`) has not arrived yet. */
  open: Set<number>;
  micStarted: boolean;
  chord: boolean;
  timer: NodeJS.Timeout | null;
};

/** Where an answer's steps come from: the model, or the backend. */
type Guide = ReturnType<typeof createGuide>;

type Source = {
  kind: 'model' | 'backend';
  label: string;
  stream(): AsyncIterable<ModelOutput>;
  /** A line to show instead, when the source answered with text only. */
  message?(): string | undefined;
  /** True when the walk's plan was replaced while this source's answer was held for a click: it must not tell the guide that its steps are over. */
  superseded?(): boolean;
};

export function createSession(deps: SessionDeps) {
  /** Checks only (logText): each answer's raw text goes in the log, so a garbled one can be read afterwards. Otherwise nothing is asked for. */
  const rawLog = (): { onRaw?: (text: string) => void } => (deps.logText ? { onRaw: (text) => deps.log(`answer-raw ${JSON.stringify(text)}`) } : {});
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const backend = deps.backend;
  let attempt: Attempt | null = null;
  let nextId = 1;
  let asking: AbortController | null = null;
  let thread: ThreadTurn[] = [];
  /** The picture each kept turn was asked about (as grabbed, no pen stroke), so a pin saves the right one. */
  const pictures = new WeakMap<ThreadTurn, Screenshot>();
  let state: SceneState = createSceneState();
  let lastActivity = 0;
  let lastAsk: { question: string; screenshot: Screenshot; /** The picture as grabbed, without a pen stroke. */ clean: Screenshot; reason?: string } | null = null;
  let report: QuestionReport | null = null;
  /** The guide walk in progress, if any, and the controller of the model call making its latest plan. */
  let walking: { guide: Guide; controller: AbortController } | null = null;
  let releasedAt = 0;
  /** The press whose pen strokes still count: the one held now, and for a moment after release. */
  let penFor: Attempt | null = null;
  /**
   * After a right click cancelled the question: the pen's window keeps the mouse until the button comes up (or this long has passed), so
   * the release never reaches the window underneath, where it could open a menu.
   */
  let cancelHold: { displayId: number; timer: ReturnType<typeof setTimeout> } | null = null;
  const CANCEL_HOLD_MS = 2000;
  const endCancelHold = (): void => {
    if (!cancelHold) return;
    clearTimeout(cancelHold.timer);
    const { displayId } = cancelHold;
    cancelHold = null;
    penOff(displayId);
  };

  /** The full-resolution frame of a press is not needed once its question is over. */
  function releaseFrame(a: Attempt): void {
    a.capture.then((grab) => {
      if (grab.grabId !== undefined) deps.media.release?.(grab.grabId);
    }, () => undefined);
  }

  /** Click-through back and the page told, whatever fails on the way. */
  function penOff(displayId: number): void {
    try {
      deps.send(displayId, { kind: 'pen', on: false });
    } catch (error) {
      deps.log(`pen: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      try {
        deps.setPen(null);
      } catch (error) {
        deps.log(`pen: could not give the mouse back: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const notice = (displayId: number, text: string, level: 'info' | 'error' = 'info') => {
    deps.send(displayId, { kind: 'status', status: 'idle' });
    deps.send(displayId, { kind: 'notice', text, level });
  };

  function dropAttempt(why: string): void {
    const a = attempt;
    if (!a) return;
    attempt = null;
    if (a.timer) clearTimeout(a.timer);
    a.controls?.abort.abort();
    deps.media.abortMic();
    releaseFrame(a); // the frame is simply never used
    deps.log(`early microphone and capture dropped (${why})`);
  }

  /**
   * The real controls of the window in front (see uia.ts), read once the chord is complete (not on Right Ctrl alone: a lone
   * key is no question) and never waited for. The press keeps the read so it can be stopped if the press is dropped.
   */
  function startControls(a: Attempt): void {
    if (!deps.controls || a.controls) return;
    const abort = new AbortController();
    const none = (why: string) => ({ boxes: [], ms: 0, why });
    let done: Promise<{ boxes: { x: number; y: number; w: number; h: number; kind: string }[]; ms: number; why?: string }>;
    try {
      done = deps.controls.read(a.displayId, abort.signal).catch(() => none('failed'));
    } catch {
      done = Promise.resolve(none('failed'));
    }
    a.controls = { done, abort };
  }

  function begin(withWindow: boolean): Attempt {
    const displayId = deps.pointerDisplayId();
    const a: Attempt = { id: nextId++, displayId, capture: deps.media.capture(displayId), strokes: new Map(), open: new Set(), micStarted: false, chord: false, timer: null };
    a.capture.catch(() => undefined); // an error is reported when the question is asked
    // A speech or voice server that sleeps starts waking now, while the person is still speaking; whatever it does, the press goes on.
    try {
      void Promise.resolve(deps.speech?.wake?.()).catch(() => undefined);
    } catch {
      // a wake-up that throws at once is no matter
    }
    deps.media.startMic().catch((error: unknown) => deps.log(`microphone: ${error instanceof Error ? error.message : String(error)}`));
    if (withWindow) a.timer = setTimeout(() => dropAttempt('Right Shift did not follow in time'), deps.micWindowMs);
    attempt = a;
    return a;
  }

  /** Right Ctrl went down first: open the microphone and start the screen grab now. */
  function armNow(): void {
    if (attempt) dropAttempt('a new press began');
    begin(true);
  }

  function cancelNow(): void {
    if (attempt && !attempt.chord) dropAttempt('Right Ctrl was released alone');
  }

  /** What the person is told when a press is refused (and nothing else about why, so the window's name is never said). */
  const refusal = (v: SkipVerdict): string => (v.kind === 'listed'
    ? 'Not looking at this window: it is on your list of windows to skip.'
    : 'Could not tell which window is in front, so nothing was looked at. Clear the list of windows to skip in Settings to stop this check.');

  // With a list of windows to skip, key events are handled in order, each after the check of the window in front (which is given a short
  // deadline and counts a failure as a refusal, see skip-list.ts). Without one they run at once, as before.
  let chain: Promise<void> = Promise.resolve();
  const failed = (error: unknown): void => deps.log(`press: ${error instanceof Error ? error.message : String(error)}`);
  function ordered(run: () => void): void {
    if (!deps.skipped) return run();
    chain = chain.then(run).catch(failed);
  }
  function gated(run: () => void, refuse: (why: SkipVerdict) => void): void {
    const check = deps.skipped;
    if (!check) return run();
    chain = chain
      .then(async () => {
        const verdict = await check().catch((): SkipVerdict => ({ kind: 'blind', why: 'the check failed' }));
        if (verdict) refuse(verdict);
        else run();
      })
      .catch(failed);
  }
  const arm = (): void => gated(armNow, () => {
    if (attempt) dropAttempt('a new press began');
  });
  const cancel = (): void => ordered(cancelNow);
  const start = (): void => gated(startNow, (why) => {
    // The window in front is one the person asked us not to look at (or cannot be told): nothing is recorded or captured, and they are told.
    if (attempt) dropAttempt('a press was refused');
    deps.log(`press ignored: ${why.kind === 'listed' ? 'the window in front is on the list of windows to skip' : `the window in front could not be told (${why.why})`}`);
    notice(deps.pointerDisplayId(), refusal(why));
  });
  const stop = (): void => gated(stopNow, (why) => {
    const a = attempt;
    if (!a || !a.chord) return;
    // The person moved to a window that is refused while holding the keys: what was grabbed before is thrown away.
    dropAttempt('a press was refused');
    penOff(a.displayId);
    notice(a.displayId, refusal(why));
  });

  /** Both keys are down. */
  function startNow(): void {
    // A request still running is let go: its status (working, with the backend) must not outlive the press.
    const supersedes = asking !== null;
    asking?.abort();
    const a = attempt && !attempt.chord ? attempt : (attempt && dropAttempt('a new press began'), begin(false));
    if (cancelHold) {
      clearTimeout(cancelHold.timer);
      cancelHold = null;
    }
    if (a.timer) clearTimeout(a.timer);
    a.timer = null;
    a.chord = true;
    startControls(a);
    // The chord is complete, so a question is on its way: let the model load its instructions while it is
    // spoken. Not for a follow-up, which continues a thread that already holds them.
    const following = thread.length > 0 && now() - lastActivity < THREAD_WINDOW_MS;
    if (!following) {
      try {
        deps.model().prime?.();
      } catch (error) {
        deps.log(`prime: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    penFor = a;
    try {
      deps.setPen(a.displayId);
      deps.send(a.displayId, { kind: 'pen', on: true });
    } catch (error) {
      penOff(a.displayId);
      deps.log(`pen: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (supersedes) deps.send(a.displayId, { kind: 'status', status: 'idle' });
    deps.send(a.displayId, { kind: 'status', status: 'hush' });
    if (a.micStarted) deps.send(a.displayId, { kind: 'status', status: 'listening' });
  }

  /** The device is open and the recorder running. */
  function micStarted(): void {
    if (!attempt) return;
    attempt.micStarted = true;
    if (attempt.chord) deps.send(attempt.displayId, { kind: 'status', status: 'listening' });
  }

  /** Either key came up after the chord was made. */
  function stopNow(): void {
    const a = attempt;
    if (!a || !a.chord) return;
    attempt = null;
    releasedAt = now();
    penOff(a.displayId);
    deps.log('chord released');
    void ask(a);
  }

  /** Pins the answer in the thread (the last one, if it is still in memory). */
  function pinNow(): { ok: boolean; text: string } {
    if (!deps.pin) return { ok: false, text: 'Pinning is not available.' };
    const last = thread[thread.length - 1];
    if (!last) return { ok: false, text: 'There is nothing to pin yet. Ask something first.' };
    try {
      const keep = deps.pinScreenshot?.() === true && pictures.get(last);
      deps.pin({ question: last.question, thread: [...thread], steps: sceneSteps(), ...(keep ? { screenshot: keep } : {}) });
      return { ok: true, text: keep ? 'Pinned, with the screenshot.' : 'Pinned.' };
    } catch (error) {
      deps.log(`pin: ${error instanceof Error ? error.message : String(error)}`);
      return { ok: false, text: "I couldn't save the pin." };
    }
  }

  /**
   * The steps that draw what is on screen now: the turns from the last detail pass on (a detail pass writes the whole
   * scene again, richer), or all of them when there has been none.
   */
  function sceneSteps(): unknown[] {
    const from = thread.findLastIndex((t) => t.detail === true);
    return thread.slice(Math.max(0, from)).flatMap((t) => [...t.steps]);
  }

  /** What the backend is told about the scene on screen: the steps drawn in this thread and the ids in use. */
  function sceneOnScreen(): { steps: unknown[]; ids: Record<string, string> } {
    return { steps: sceneSteps(), ids: Object.fromEntries(state.ids) };
  }

  /** The backend as a source of steps: the overlay says it is with the backend while it waits. */
  function backendSource(displayId: number, trigger: 'offer' | 'spoken', question: string, screenshot: Screenshot, reason: string | undefined, signal: AbortSignal): Source {
    let said: string | undefined;
    return {
      kind: 'backend',
      label: 'backend',
      message: () => said,
      async *stream(): AsyncGenerator<ModelOutput> {
        deps.send(displayId, { kind: 'status', status: 'backend' });
        const reply = await backend!.ask({ question, screenshot, thread: [...thread], scene: sceneOnScreen(), trigger, ...(reason ? { reason } : {}), signal });
        said = reply.message;
        const scene = reply.scene;
        if (scene === undefined) return;
        const steps = scene && typeof scene === 'object' ? (scene as { steps?: unknown }).steps : undefined;
        if (!Array.isArray(steps)) throw new ModelError('bad-output', 'the backend sent a scene without steps');
        // The backend is where an escalation ends: an `escalate` in its scene is ignored, so it never offers itself again.
        for (const step of steps) yield { type: 'step', step };
      },
    };
  }

  /** The question is on its way to its answer: the thread, the validator, begin/step/end and every way it can end. */
  async function answer(displayId: number, controller: AbortController, r: QuestionReport, since: () => number, question: string, source: Source, keepThread = false, detail = false, walkIn?: Guide): Promise<void> {
    const continuing = thread.length > 0 && (keepThread || now() - lastActivity < THREAD_WINDOW_MS);
    if (!continuing) {
      thread = [];
      state = createSceneState();
    }
    // A detail pass knows the ids on screen: it may name one it does not write again (a pin on it, a part under it) and
    // may write any of them again, richer; the page swaps each one in place as it arrives.
    const checking: SceneState = detail ? createDetailState(state) : state;
    const turn = detail ? Math.max(1, thread.length) : thread.length + 1;
    const picture = lastAsk?.clean;
    const known = [...state.ids.keys()];
    startTurn(checking);
    deps.log(`question heard (turn ${turn}, ${source.label}${deps.logText ? `): ${JSON.stringify(question)}` : ')'}`);

    const shown: Step[] = [];
    // A guide walk (an answer with `wait` steps) holds its later steps back: they are given to it, not drawn.
    let walk: Guide | undefined = walkIn;
    let held = false;
    let begun = walkIn !== undefined;
    const open = () => {
      if (begun) return;
      begun = true;
      deps.send(displayId, detail ? { kind: 'begin', turn, detail: true } : { kind: 'begin', turn });
    };
    let escalate: string | undefined;
    let failure: unknown;
    // A step written piece by piece (the model's own stream) is drawn as it arrives: its words open it on the
    // page, each action is checked against the scene on arrival and sent at once, and the step is closed when
    // the whole step comes. A step that arrives whole (the backend, a replay) is checked and sent in one go.
    let live: LiveStep | null = null;
    // The answer as the model wrote it, to score the order it built in.
    const written: Array<{ actions: unknown[] }> = [];
    let writing: unknown[] | null = null;
    const newLive = (): LiveStep => {
      held = walk !== undefined;
      return beginLiveStep(checking, {
        open: (say) => {
          if (held) return;
          open();
          r.firstStepMs ??= since();
          deps.send(displayId, { kind: 'step-open', say });
        },
        action: (action) => {
          if (!held) deps.send(displayId, { kind: 'action', action });
        },
      });
    };
    /** A step that asks for the person's click starts a walk; the steps after it are the walk's to show. */
    const modelPicture = lastAsk?.clean;
    const startWalk = (): Guide => {
      const g: Guide = createGuide({
        displayId,
        send: (message) => {
          // The guide clears the page by id between steps: the scene the answers are checked against forgets those ids too.
          if (message.kind === 'step') for (const a of message.step.actions) if (a.op === 'clear') applyClear(checking, a.target);
          deps.send(displayId, message);
        },
        capture: () => deps.guide!.capture(displayId),
        // The picture the model was given: a move for the person is made only if the screen near it still looks like this.
        ...(deps.guide?.gridOf && modelPicture ? { reference: () => ({ screenshot: modelPicture, grid: deps.guide!.gridOf!(modelPicture) }) } : {}),
        listen: (listener) => deps.guide!.listen(displayId, listener),
        replan: (info) => replanWalk(displayId, g, question, info),
        finish: () => deps.send(displayId, { kind: 'end', ...(escalate ? { escalate } : {}) }),
        onEnd: (why) => {
          if (walking?.guide === g) {
            walking.controller.abort();
            walking = null;
          }
          // Escape, a long silence or a failure leave a cleared page: the next question starts afresh.
          if (why === 'escape' || why === 'idle' || why === 'failed') {
            thread = [];
            state = createSceneState();
          }
        },
        log: deps.log,
        ...(deps.guide?.options ? { options: deps.guide.options } : {}),
        ...(deps.guide?.navigation ? { navigation: deps.guide.navigation } : {}),
      });
      walking = { guide: g, controller: new AbortController() };
      return g;
    };
    const handOver = (step: Step, wasHeld: boolean): void => {
      if (wasHeld && walk) walk.push(step);
      else if (!walk && !detail && deps.guide && waitOf(step)) {
        walk = startWalk();
        walk.adopt(step); // already on the page: the guide waits for its click
      }
    };
    const closeLive = (): void => {
      if (!live) return;
      const done = live.finish();
      live = null;
      if (done.issues.length > 0) deps.log(`validator: ${done.issues.length} notes on step ${shown.length + 1}`);
      if (!held) deps.send(displayId, { kind: 'step-close' });
      if (done.step) {
        shown.push(done.step);
        handOver(done.step, held);
      }
    };
    try {
      for await (const out of source.stream()) {
        if (out.type !== 'usage') r.firstPieceMs ??= since();
        if (controller.signal.aborted) break;
        if (out.type === 'say') {
          live ??= newLive();
          live.say(out.say);
          if (!writing) written.push({ actions: (writing = []) });
        } else if (out.type === 'action') {
          live ??= newLive();
          live.action(out.action);
          if (!writing) written.push({ actions: (writing = []) });
          writing.push(out.action);
        } else if (out.type === 'step') {
          if (live) {
            writing = null;
            closeLive();
            continue;
          }
          written.push(out.step as { actions: unknown[] });
          const checked = validateStep(out.step, checking);
          if (checked.issues.length > 0) deps.log(`validator: ${checked.issues.length} notes on step ${shown.length + 1}`);
          if (!checked.step) continue;
          const wasHeld = walk !== undefined;
          if (!wasHeld) open();
          shown.push(checked.step);
          r.firstStepMs ??= since();
          if (!wasHeld) deps.send(displayId, { kind: 'step', step: checked.step });
          handOver(checked.step, wasHeld);
        } else if (out.type === 'usage') {
          r.tokens = out.usage;
        } else if (out.type === 'escalate') {
          if (!detail) escalate = validateEscalate(out.reason).escalate; // a detail pass never offers anything
        }
      }
    } catch (error) {
      failure = error;
    }
    if (controller.signal.aborted) return;
    if (live) {
      // The stream ended or broke in the middle of a step: close it on the page so nothing hangs half drawn.
      if (failure) {
        live = null;
        if (!held) deps.send(displayId, { kind: 'step-close' });
      } else closeLive();
    }
    if (failure && shown.length > 0) {
      // Steps have already played: they stay, and the answer ends where it broke, with a line in the log, not a wiped page and an error.
      const code = failure instanceof ModelError ? failure.code : 'failed';
      r.cutShort = `${source.kind}: ${code}: ${failure instanceof Error ? failure.message : String(failure)}`;
      deps.log(`answer cut short after ${shown.length} step${shown.length === 1 ? '' : 's'} (${r.cutShort}); what was shown stays`);
      failure = undefined;
    }
    if (failure) {
      const code = failure instanceof ModelError ? failure.code : 'failed';
      r.error = `${source.kind}: ${code}: ${failure instanceof Error ? failure.message : String(failure)}`;
      if (walk) walk.streamEnded();
      else if (begun) deps.send(displayId, { kind: 'end' });
      return notice(displayId, failure instanceof ModelError && code === 'auth' && failure.message === NO_KEY_MESSAGE ? 'No API key is set. Open the tray menu and choose API key.' : source.kind === 'backend' ? backendMessage(code) : modelMessage(code), 'error');
    }
    r.steps = shown.length;
    if (written.length > 0) {
      const o = orderScore(written, known);
      r.order = { score: Math.round(o.score * 100) / 100, refs: o.refs, early: o.early, missing: o.missing, wrong: o.wrong };
      if (o.examples.length > 0) deps.log(`order: ${o.examples.join('; ')}`);
    }
    if (escalate) r.escalate = escalate;
    r.endMs = since();
    if (shown.length === 0 && !escalate) {
      const said = source.message?.();
      if (said) return notice(displayId, said);
      r.error = `the ${source.kind} gave nothing to show`;
      return notice(displayId, detail ? "I couldn't add more detail this time." : "I couldn't work out an answer to that. Try asking another way?");
    }
    if (walk) {
      if (!source.superseded?.()) walk.streamEnded(); // the walk sends the end when its last step has been shown
    }
    else {
      open();
      deps.send(displayId, { kind: 'end', ...(escalate ? { escalate } : {}) });
    }
    const kept: ThreadTurn = { question, steps: shown, ...(detail ? { detail: true as const } : {}) };
    if (picture) pictures.set(kept, picture);
    if (detail) {
      // The scene on screen is now the richer one: the ids it did not write again are still there and still known.
      delete checking.replaceable;
      state = checking;
      deps.send(displayId, { kind: 'status', status: 'idle' });
    }
    thread.push(kept);
    lastActivity = now();
    if (lastAsk) lastAsk.reason = detail ? undefined : escalate;
  }

  /** The page is given the screen as it is now, and its controls are read again (the screen changed under the person's click). */
  function lookAgain(displayId: number, question: string, picture: Screenshot, signal: AbortSignal, why: string): void {
    lastAsk = { question, screenshot: picture, clean: picture };
    deps.send(displayId, { kind: 'screenshot', url: `data:${picture.mime};base64,${picture.base64}` });
    if (deps.controls) {
      // Late is fine, see begin.
      void deps.controls.read(displayId, signal).then((read) => {
        deps.log(`controls: ${read.boxes.length} read in ${read.ms} ms${read.why ? ` (${read.why})` : ''} (${why})`);
        if (!signal.aborted && read.boxes.length > 0) deps.send(displayId, { kind: 'controls', boxes: read.boxes });
      }, () => undefined);
    }
  }

  /**
   * For an answer written one step to a call: after a step that waits for the person's click, the next step is asked for only once they
   * have followed it and the screen has changed, from the screen as it is then. Whether the step kept its wait is the guide's to say, not the
   * model's text: a wait the validator dropped makes a plain step, and the chain goes straight on. `taken` is how many waits the guide had taken
   * up when this answer began. If the walk ends or its plan is replaced first, the answer stops.
   */
  function walkHold(displayId: number, question: string, taken: number): { afterStep: NonNullable<ModelRequest['afterStep']>; superseded(): boolean } {
    let replaced = false;
    const afterStep: NonNullable<ModelRequest['afterStep']> = async ({ signal }) => {
      const g = walking?.guide;
      if (!g || !deps.guide) return 'go';
      if (g.waitsTaken === taken) return 'go'; // this step has no wait the guide kept
      taken = g.waitsTaken;
      const frame = await g.whenFollowed(taken, signal);
      if (!frame) {
        if (g.active && !signal.aborted) replaced = true;
        return 'stop';
      }
      lookAgain(displayId, question, frame.screenshot, signal, 'next step');
      return { screenshot: frame.screenshot };
    };
    return { afterStep, superseded: () => replaced };
  }

  /**
   * The person clicked away from where a guide step pointed and the screen changed: the plan was made for a screen that is
   * gone. The model is asked again from the screen as it is now, told what has happened so far; its steps go to the walk.
   */
  async function replanWalk(displayId: number, g: Guide, question: string, info: Parameters<Parameters<typeof createGuide>[0]['replan']>[0]): Promise<void> {
    const w = walking;
    if (!w || w.guide !== g) return;
    // The old marks and checklist are about to go from the page; the new plan may write the same ids again.
    for (const id of info.clears) applyClear(state, id);
    const controller = new AbortController();
    w.controller = controller;
    const model = deps.model();
    const r: QuestionReport = { model: model.id, question: '', steps: 0 };
    const started = now();
    const picture = info.frame.screenshot;
    lookAgain(displayId, question, picture, controller.signal, 'new plan');
    const before = thread.length;
    const hold = walkHold(displayId, question, g.waitsTaken);
    const source: Source = {
      kind: 'model',
      label: model.id,
      stream: () => model.ask({ question: guideQuestion(question, info), screenshot: picture, thread, schema: sceneSchemaLean, pieces: true, afterStep: hold.afterStep, signal: controller.signal }),
      superseded: hold.superseded,
    };
    await answer(displayId, controller, r, () => now() - started, question, source, true, false, g);
    deps.log(`guide: new plan ${JSON.stringify(deps.logText ? r : { ...r, question: '(not logged)' })}`);
    if (controller.signal.aborted) return;
    if (thread.length === before) throw new Error('the model gave no steps');
  }

  /**
   * The detail pass: the detail model is asked for a much richer version of the scene on screen (same language, same
   * ids), and what it writes upgrades the picture in place as it arrives. Only ever started by the person (the page's
   * button, or "show me in detail"); a new question cancels it like any other answer.
   */
  async function runDetail(displayId: number, controller: AbortController, r: QuestionReport, since: () => number): Promise<void> {
    const model = deps.detailModel?.();
    if (!model) {
      r.error = 'no detail model';
      return notice(displayId, 'No detail model is set up. Name one in the settings to use this.', 'error');
    }
    const base = lastAsk;
    if (!base || thread.length === 0) {
      r.error = 'nothing to add detail to';
      return notice(displayId, 'Ask a question first, then ask for more detail.');
    }
    r.model = model.id;
    r.question = base.question;
    r.detail = true;
    deps.send(displayId, { kind: 'status', status: 'detail' });
    const scene = sceneSteps();
    const source: Source = {
      kind: 'model',
      label: model.id,
      stream: () => model.ask({ question: base.question, screenshot: base.clean, thread: [], schema: sceneSchemaLean, pieces: true, ...rawLog(), detail: { steps: scene }, signal: controller.signal }),
    };
    await answer(displayId, controller, r, since, base.question, source, true, true);
  }

  async function ask(a: Attempt): Promise<void> {
    const controller = new AbortController();
    // A new question ends the walk, unless the app is waiting for a yes: a short answer is then the answer, not a question, so the
    // walk stays until the words are known.
    const consent = deps.guide?.navigation?.consent;
    const answering = consent?.pending() === true;
    if (!answering) walking?.guide.end('superseded');
    asking?.abort();
    asking = controller;
    const model = deps.model();
    let asked = false;
    const r: QuestionReport = { model: model.id, question: '', steps: 0 };
    report = r;
    const since = () => now() - releasedAt;
    deps.send(a.displayId, { kind: 'status', status: 'working' });
    try {
      let clip: MicResult;
      try {
        clip = await deps.media.stopMic();
      } catch (error) {
        r.error = `microphone: ${error instanceof Error ? error.message : String(error)}`;
        return notice(a.displayId, "I couldn't use the microphone.", 'error');
      }
      if (controller.signal.aborted) return;
      // The strokes are final by now. Draw them onto the frame while the speech is being recognised.
      for (let waited = 0; a.open.size > 0 && waited < STROKE_TAIL_MS; waited += STROKE_TAIL_STEP_MS) await sleep(STROKE_TAIL_STEP_MS);
      const strokes = [...a.strokes.values()];
      if (penFor === a) penFor = null;
      const circled = isRealStroke(strokes) && deps.media.compose !== undefined;
      const composed = circled
        ? a.capture.then((grab) => {
          if (grab.grabId === undefined) throw new Error('the frame was not kept');
          return deps.media.compose!(grab.grabId, strokes);
        })
        : null;
      composed?.catch(() => undefined); // reported where it is used
      if (clip.durationMs < MIN_CLIP_MS) {
        r.error = 'no question heard';
        return notice(a.displayId, "I didn't hear a question. Hold both keys while you speak.");
      }
      if (!deps.speech) {
        r.error = 'no speech server';
        return notice(a.displayId, "No speech server is set up, so I can't hear questions yet. Add its address to the settings.", 'error');
      }
      let question: string;
      try {
        const heard = await deps.speech.transcribe({ samples: clip.samples, sampleRate: clip.sampleRate });
        question = heard.text.trim();
        r.speech = `${heard.engine ?? deps.speech.id}${heard.seconds === undefined ? '' : ` ${heard.seconds.toFixed(2)} s`}`;
      } catch (error) {
        const code = error instanceof SpeechToTextError ? error.code : 'failed';
        r.error = `speech: ${code}`;
        if (code === 'aborted') return;
        if (code === 'empty') return notice(a.displayId, "I didn't catch that. Try again?");
        if (code === 'unavailable') return notice(a.displayId, "The speech server isn't running, so I couldn't hear you. Start it and try again.", 'error');
        return notice(a.displayId, 'Speech recognition failed. Try again.', 'error');
      }
      if (controller.signal.aborted) return;
      r.question = question;
      r.transcriptMs = since();
      if (!question) {
        r.error = 'empty transcript';
        return notice(a.displayId, "I didn't catch that. Try again?");
      }
      if (answering) {
        const said = parseConsent(question);
        if (said) {
          consent!.answer(said === 'yes'); // false when it just timed out: a late yes is still not a question
          deps.log(`navigation: they said ${said}`);
          r.question = '(an answer to the app)';
          return;
        }
        walking?.guide.end('superseded'); // it was a question after all
      }
      if (parseSpoken(question)?.kind === 'pin') {
        // Not a question: keep what is on screen. No picture is needed, and the model is not asked.
        const said = pinNow();
        r.error = said.ok ? undefined : 'pin failed';
        return notice(a.displayId, said.text, said.ok ? 'info' : 'error');
      }
      if (parseSpoken(question)?.kind === 'detail') {
        // Not a new question: the detail model adds to what is on screen. The frame grabbed for this press is not needed.
        return await runDetail(a.displayId, controller, r, since);
      }
      let shot: Grab;
      try {
        shot = await a.capture;
      } catch (error) {
        r.error = `capture: ${error instanceof Error ? error.message : String(error)}`;
        return notice(a.displayId, "I couldn't look at the screen.", 'error');
      }
      if (controller.signal.aborted) return;
      r.captureMs = shot.ms;
      // With a stroke, the model gets the screenshot with the stroke drawn on it plus a closer crop; the
      // page keeps the clean frame, and every mark stays on the scale of the whole screenshot.
      let seen: Screenshot = shot.screenshot;
      let focus: FocusCrop[] | undefined;
      if (composed) {
        try {
          const c = await composed;
          seen = c.screenshot;
          focus = c.focus;
          r.circled = true;
        } catch (error) {
          deps.log(`pen: the stroke could not be drawn, using the plain screenshot (${error instanceof Error ? error.message : String(error)})`);
        }
        if (controller.signal.aborted) return;
      }
      const previous = lastAsk;
      const spoken = parseSpoken(question);
      // "Ask the backend" hands the question over by voice; with nothing after it, the last question goes again.
      const toBackend = spoken?.kind === 'backend';
      const asking = toBackend ? (spoken.rest || previous?.question || '') : question;
      if (toBackend) r.model = 'backend';
      if (toBackend && !backend) {
        r.error = 'no backend';
        return notice(a.displayId, NO_BACKEND_MESSAGE, 'error');
      }
      if (toBackend && !asking) {
        r.error = 'nothing to ask the backend';
        return notice(a.displayId, 'Ask your question first, or say it after "ask the backend".');
      }
      lastAsk = { question: asking, screenshot: seen, clean: shot.screenshot };
      deps.send(a.displayId, { kind: 'screenshot', url: `data:${shot.screenshot.mime};base64,${shot.screenshot.base64}` });
      if (a.controls && !toBackend) {
        // Not waited for: the page gets them when they come, after the screenshot they belong to.
        const sentAt = since();
        void a.controls.done.then((read) => {
          r.controlsMs = read.ms;
          r.controlsCount = read.boxes.length;
          deps.log(`controls: ${read.boxes.length} read in ${read.ms} ms${read.why ? ` (${read.why})` : ''}, the first mark could have been at ${sentAt} ms`);
          // Not for a screen that a newer press has since replaced.
          if (controller.signal.aborted || a.id !== nextId - 1 || read.boxes.length === 0) return;
          deps.send(a.displayId, { kind: 'controls', boxes: read.boxes });
        });
      }

      const hold = walkHold(a.displayId, asking, 0);
      const source: Source = toBackend
        ? backendSource(a.displayId, 'spoken', asking, seen, undefined, controller.signal)
        : {
          kind: 'model',
          label: model.id,
          stream: () => model.ask({ question, screenshot: seen, ...(focus ? { focus } : {}), thread, schema: sceneSchemaLean, pieces: true, ...rawLog(), afterStep: hold.afterStep, signal: controller.signal }),
          superseded: hold.superseded,
        };
      asked = !toBackend;
      await answer(a.displayId, controller, r, since, asking, source, false);
    } finally {
      if (penFor === a) penFor = null;
      if (!asked) model.unprime?.(); // the chord came to nothing: the spare thread is let go (and counted)
      releaseFrame(a);
      if (asking === controller) asking = null;
      deps.log(`report ${JSON.stringify(deps.logText ? r : { ...r, question: r.question ? '(not logged)' : '' })}`);
      deps.onReport?.(r);
    }
  }

  return {
    arm,
    cancel,
    start,
    stop,
    micStarted,
    /** A piece of a pen stroke from the page on `displayId`; only the press being held (or just released) takes it. */
    stroke(displayId: number, piece: Stroke): void {
      const a = penFor;
      if (!a || a.displayId !== displayId || !Number.isFinite(piece.id)) return;
      // A circle taken back (undo): it is not part of the question any more, so not of the picture, the crop or the numbering.
      if (piece.removed === true) {
        a.strokes.delete(piece.id);
        a.open.delete(piece.id);
        return;
      }
      let points = a.strokes.get(piece.id);
      if (!points) {
        if (a.strokes.size >= 20) return;
        points = [];
        a.strokes.set(piece.id, points);
      }
      if (piece.done) a.open.delete(piece.id);
      else a.open.add(piece.id);
      for (const p of piece.points) {
        if (points.length >= 5000) break;
        points.push([p[0], p[1]]);
      }
    },
    /**
     * A right click while the chord is held (`released` false) cancels the question: nothing is captured or heard, the strokes go, and
     * the person is told. The pen's window keeps the mouse until the button comes up (`released` true), so the click never reaches the app beneath.
     */
    cancelQuestion(displayId: number, released: boolean): void {
      if (released) {
        if (cancelHold?.displayId === displayId) endCancelHold();
        return;
      }
      const a = attempt;
      if (!a || !a.chord || a.displayId !== displayId) return;
      dropAttempt('the question was cancelled with a right click');
      penFor = null;
      deps.log('question cancelled with a right click');
      notice(displayId, 'Cancelled.');
      cancelHold = { displayId, timer: setTimeout(endCancelHold, CANCEL_HOLD_MS) };
    },
    /** The page finished playing a scene. */
    done(): void {
      lastActivity = now();
    },
    /** The page reports the first mark or word of a live turn. */
    milestone(m: Milestone): void {
      if (!report) return;
      const ms = m.at - releasedAt;
      if (m.what === 'first-mark') report.firstMarkMs ??= ms;
      else report.firstWordMs ??= ms;
      deps.log(`milestone ${m.what} ${ms} ms after release`);
      deps.onReport?.(report);
    },
    /** The user clicked the escalation offer: the question goes to the backend, with the thread and the scene on screen. */
    async offer(displayId: number): Promise<void> {
      if (!lastAsk) return;
      if (!backend) return notice(displayId, NO_BACKEND_MESSAGE, 'error');
      const controller = new AbortController();
      asking?.abort();
      asking = controller;
      releasedAt = now();
      const r: QuestionReport = { model: 'backend', question: lastAsk.question, steps: 0 };
      report = r;
      try {
        await answer(displayId, controller, r, () => now() - releasedAt, lastAsk.question, backendSource(displayId, 'offer', lastAsk.question, lastAsk.screenshot, lastAsk.reason, controller.signal), true);
      } finally {
        if (asking === controller) asking = null;
        deps.log(`report ${JSON.stringify(deps.logText ? r : { ...r, question: r.question ? '(not logged)' : '' })}`);
        deps.onReport?.(r);
      }
    },
    /** The user clicked "More detail" beside the model. Ignored while an answer is being written or heard. */
    async detail(displayId: number): Promise<void> {
      if (asking !== null || attempt !== null || walking !== null) return;
      const controller = new AbortController();
      asking = controller;
      releasedAt = now();
      const r: QuestionReport = { model: 'detail', question: '', steps: 0 };
      report = r;
      try {
        await runDetail(displayId, controller, r, () => now() - releasedAt);
      } finally {
        if (asking === controller) asking = null;
        deps.log(`report ${JSON.stringify(deps.logText ? r : { ...r, question: r.question ? '(not logged)' : '' })}`);
        deps.onReport?.(r);
      }
    },
    /** The tray's "Pin this answer". */
    pin(displayId: number): void {
      const said = pinNow();
      notice(displayId, said.text, said.ok ? 'info' : 'error');
    },
    /** The overlay was cleared by hand: the next question starts a new thread. */
    reset(): void {
      walking?.guide.end('superseded');
      asking?.abort();
      thread = [];
      state = createSceneState();
    },
    dispose(): void {
      walking?.guide.end('superseded');
      asking?.abort();
      if (attempt?.timer) clearTimeout(attempt.timer);
      if (attempt?.chord) penOff(attempt.displayId);
      endCancelHold();
      attempt = null;
    },
  };
}

const NO_BACKEND_MESSAGE = 'No backend is set up. Add its address to the settings.';

function backendMessage(code: string): string {
  switch (code) {
    case 'unavailable': return "I couldn't reach the backend.";
    case 'auth': return 'The backend did not accept the request.';
    case 'rate-limited': return 'The backend is busy. Try again in a moment.';
    case 'bad-output': return "The backend's answer was garbled.";
    default: return 'The backend could not answer.';
  }
}

function modelMessage(code: string): string {
  switch (code) {
    case 'unavailable': return "I couldn't reach the model. Is it installed and signed in?";
    case 'auth': return 'The model needs you to sign in again.';
    case 'rate-limited': return "The model's usage limit has been reached for now.";
    case 'refused': return 'I stopped: the model tried to do something it is not allowed to.';
    case 'bad-output': return "The model's answer was garbled. Try again?";
    default: return 'Something went wrong while I was thinking. Try again?';
  }
}
