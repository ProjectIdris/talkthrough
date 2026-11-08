import type { Backend } from '../adapters/backend.ts';
import { ModelError } from '../adapters/model.ts';
import { NO_KEY_MESSAGE } from '../adapters/openai-model.ts';
import type { FocusCrop, Model, ModelOutput, ModelRequest, ThreadTurn, Usage } from '../adapters/model.ts';
import { SpeechToTextError } from '../adapters/speech-to-text.ts';
import type { SpeechToText } from '../adapters/speech-to-text.ts';
import type { Screenshot } from '../adapters/types.ts';
import { applyClear, beginLiveStep, createDetailState, createSceneState, orderScore, sceneSchemaLean, startAnswer, startTurn, validateEscalate, validateStep } from '../scene/index.ts';
import type { Action, Issue, LiveStep, SceneState, Step } from '../scene/index.ts';
import { FADE_AFTER_MS, PEN_FLUSH_GRACE_MS } from '../shared/ipc.ts';
import type { MicResult, Milestone, SceneMessage, Stroke } from '../shared/ipc.ts';
import { isRealStroke } from '../shared/pen.ts';
import { createGuide, guideQuestion, waitOf } from './guide.ts';
import { parseConsent } from './nav-consent.ts';
import type { Frame, GuideListener, GuideNavigation, GuideOptions } from './guide.ts';
import type { Grid } from '../shared/screen-diff.ts';
import type { SkipVerdict } from './skip-list.ts';
import { parseSpoken } from './phrases.ts';
import type { Box, Point } from '../shared/pen.ts';
import type { QuestionRecord } from './record.ts';

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
    /** A part of the frame (a 0..1000 box) at full resolution, nothing drawn on it; null when the frame is gone. */
    crop?(grabId: number, box: Box): Promise<(Screenshot & { grid?: { cols: number; rows: number } }) | null>;
  };
  /**
   * Turns the pen on for one display (its overlay takes the mouse) or, with null, off everywhere and
   * gives click-through back. The session calls null on every way out of a held chord.
   */
  setPen(displayId: number | null): void;
  /** Renderer supports attempt-tagged pen pieces and an ordered flush acknowledgement. */
  penFlush?: boolean;
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
  /** Wakes the voice server when the keys first go down (see voice-bridge.ts); absent: no voice server, or one woken with the recogniser. */
  wakeVoice?(): Promise<void>;
  /** The record of each question (the person's setting, off by default): what was sent, heard and drawn goes to a folder of its own. Absent: nothing is kept. */
  record?: QuestionRecord;
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
  /** The answer broke after some steps had been shown: what broke it. The scene stays with an incomplete warning; tracked separately from failures with nothing to show. */
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
  drain?: { done: boolean; promise: Promise<void>; finish(): void };
  micStarted: boolean;
  chord: boolean;
  followup?: boolean;
  keepThread?: boolean;
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
  /** Everything the page is told goes through here, so the record of the question has it too. */
  const send: SessionDeps['send'] = (displayId, message) => {
    deps.record?.message(message);
    deps.send(displayId, message);
  };
  /** The figures of a question go to the check run's report and to the record of the question (which keeps the question's words, as the log does not); an error or a cut-short answer is noted once. */
  const errored = new WeakSet<object>();
  const reportOut = (r: QuestionReport): void => {
    if ((r.error || r.cutShort) && !errored.has(r)) {
      errored.add(r);
      if (r.error) deps.record?.error(r.error);
      if (r.cutShort) deps.record?.error(`answer cut short: ${r.cutShort}`);
    }
    deps.record?.report({ ...r });
    deps.onReport?.(r);
  };
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const backend = deps.backend;
  let attempt: Attempt | null = null;
  let nextId = 1;
  let asking: AbortController | null = null;
  const visibleAnswers = new Set<number>();
  let thread: ThreadTurn[] = [];
  /** The picture each kept turn was asked about (as grabbed, no pen stroke), so a pin saves the right one. */
  const pictures = new WeakMap<ThreadTurn, Screenshot>();
  let state: SceneState = createSceneState();
  let lastActivity = 0;
  let lastAsk: { question: string; screenshot: Screenshot; /** The picture as grabbed, without a pen stroke. */ clean: Screenshot; reason?: string } | null = null;
  let report: QuestionReport | null = null;
  /** The guide walk in progress, if any, and the controller of the model call making its latest plan. */
  let walking: { guide: Guide; controller: AbortController } | null = null;
  let guideChecking: SceneState | undefined;
  // A queued guide step belongs to the answer that produced it, but contributes
  // to visible history only once the guide actually shows it.
  const queuedGuideOwners = new WeakMap<Step, { shown: Step[]; inputs: Action[] }>();
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
  function penOff(displayId: number, attemptId?: number): void {
    try {
      send(displayId, { kind: 'pen', on: false, ...(attemptId !== undefined ? { attemptId } : {}) });
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

  const notice = (displayId: number, text: string, level: 'info' | 'error' | 'warning' = 'info', action?: 'hearing' | 'settings') => {
    send(displayId, { kind: 'status', status: 'idle' });
    send(displayId, { kind: 'notice', text, level, ...(action ? { action } : {}) });
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
      void Promise.resolve(deps.wakeVoice?.()).catch(() => undefined);
    } catch {
      // a wake-up that throws at once is no matter
    }
    deps.media.startMic().catch((error: unknown) => deps.log(`microphone: ${error instanceof Error ? error.message : String(error)}`));
    if (withWindow) a.timer = setTimeout(() => dropAttempt('Right Shift did not follow in time'), deps.micWindowMs);
    attempt = a;
    return a;
  }

  /** Start the visible Ask more route: speech only, with the current answer kept for its follow-up. */
  function startFollowup(): boolean {
    if (attempt || asking !== null || walking !== null) return false;
    const a = begin(false);
    a.followup = true;
    a.keepThread = thread.length > 0;
    send(a.displayId, { kind: 'status', status: 'hush' });
    send(a.displayId, { kind: 'status', status: 'listening' });
    return true;
  }

  function sendFollowup(): boolean {
    const a = attempt;
    if (!a || (!a.followup && !a.chord)) return false;
    if (a.chord) {
      stopNow();
      return true;
    }
    attempt = null;
    releasedAt = now();
    void ask(a, a.keepThread === true);
    return true;
  }

  /** The recording Cancel control discards this unsent question and retains the explanation. */
  function cancelFollowup(): boolean {
    const a = attempt;
    if (!a || (!a.followup && !a.chord)) return false;
    const displayId = a.displayId;
    dropAttempt('the follow-up recording was cancelled');
    if (a.chord) {
      penFor = null;
      penOff(displayId);
    }
    send(displayId, { kind: 'status', status: 'idle' });
    return true;
  }

  /** A true outside dismiss cancels any unsent attempt and clears the explanation's retained thread. */
  function dismiss(): void {
    const a = attempt;
    if (a) {
      dropAttempt('the explanation was dismissed');
      if (a.chord) {
        penFor = null;
        penOff(a.displayId);
      }
    }
    resetThread();
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
    notice(deps.pointerDisplayId(), refusal(why), 'warning');
  });
  const stop = (): void => gated(stopNow, (why) => {
    const a = attempt;
    if (!a || !a.chord) return;
    // The person moved to a window that is refused while holding the keys: what was grabbed before is thrown away.
    dropAttempt('a press was refused');
    penOff(a.displayId);
    notice(a.displayId, refusal(why), 'warning');
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
    const visibleFollowup = thread.length > 0 && visibleAnswers.has(a.displayId);
    const following = thread.length > 0 && (visibleFollowup || now() - lastActivity < THREAD_WINDOW_MS);
    a.keepThread = visibleFollowup;
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
      send(a.displayId, { kind: 'pen', on: true, ...(deps.penFlush ? { attemptId: a.id } : {}) });
    } catch (error) {
      penOff(a.displayId);
      deps.log(`pen: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (supersedes) send(a.displayId, { kind: 'status', status: 'idle' });
    send(a.displayId, { kind: 'status', status: 'hush' });
    if (a.micStarted) send(a.displayId, { kind: 'status', status: 'listening' });
  }

  /** The device is open and the recorder running. */
  function micStarted(): void {
    if (!attempt) return;
    attempt.micStarted = true;
    if (attempt.chord) send(attempt.displayId, { kind: 'status', status: 'listening' });
  }

  /** Either key came up after the chord was made. */
  function stopNow(): void {
    const a = attempt;
    if (!a || !a.chord) return;
    attempt = null;
    releasedAt = now();
    if (deps.penFlush) {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => { resolve = done; });
      const drain = { done: false, promise, finish: () => { if (drain.done) return; drain.done = true; clearTimeout(timer); resolve(); } };
      const timer = setTimeout(drain.finish, PEN_FLUSH_GRACE_MS);
      a.drain = drain;
    }
    penOff(a.displayId, deps.penFlush ? a.id : undefined);
    deps.log('chord released');
    void ask(a, a.keepThread === true);
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
        send(displayId, { kind: 'status', status: 'backend' });
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
    let checking: SceneState = detail ? createDetailState(state) : walkIn ? structuredClone(state) : state;
    if (walkIn) guideChecking = checking;
    const turn = detail ? Math.max(1, thread.length) : thread.length + 1;
    const picture = lastAsk?.clean;
    const known = [...state.ids.keys()];
    // A detail pass replaces what it was shown by design; any other answer may write an id on screen again and replace it, with a note.
    if (detail) startTurn(checking); else startAnswer(checking);
    deps.log(`question heard (turn ${turn}, ${source.label}${deps.logText ? `): ${JSON.stringify(question)}` : ')'}`);

    const shown: Step[] = [];
    let accepted = 0;
    // A guide walk (an answer with `wait` steps) holds its later steps back: they are given to it, not drawn.
    let walk: Guide | undefined = walkIn;
    let held = false;
    let begun = walkIn !== undefined;
    const open = () => {
      if (begun) return;
      begun = true;
      send(displayId, detail ? { kind: 'begin', turn, detail: true } : { kind: 'begin', turn, ...(question.trim() ? { question: question.trim().slice(0, 160) } : {}) });
    };
    let escalate: string | undefined;
    let failure: unknown;
    // A step written piece by piece (the model's own stream) is drawn as it arrives: its words open it on the
    // page, each action is checked against the scene on arrival and sent at once, and the step is closed when
    // the whole step comes. A step that arrives whole (the backend, a replay) is checked and sent in one go.
    let live: LiveStep | null = null;
    let liveInputs: Action[] = [];
    // Only what the live validator has actually emitted to the page belongs in
    // an interrupted step; unresolved actions must not be recovered on error.
    let visiblePartial: Step | undefined;
    // The answer as the model wrote it, to score the order it built in.
    const written: Array<{ actions: unknown[] }> = [];
    let writing: unknown[] | null = null;
    const newLive = (): LiveStep => {
      held = walk !== undefined;
      visiblePartial = undefined;
      liveInputs = [];
      return beginLiveStep(checking, {
        open: (say) => {
          if (held) return;
          visiblePartial = { say, actions: [] };
          open();
          r.firstStepMs ??= since();
          send(displayId, { kind: 'step-open', say });
        },
        action: (action, derived) => {
          if (!derived) liveInputs.push(action);
          if (!held) {
            visiblePartial?.actions.push(action);
            send(displayId, { kind: 'action', action });
          }
        },
      });
    };
    /** A step that asks for the person's click starts a walk; the steps after it are the walk's to show. */
    const modelPicture = lastAsk?.clean;
    const startWalk = (): Guide => {
      const g: Guide = createGuide({
        displayId,
        onShow: (step, shaped) => {
          const owner = queuedGuideOwners.get(step);
          if (!owner) return;
          queuedGuideOwners.delete(step);
          // Guide-inserted clears occur before this already validated step.
          const modelActions = new Set(step.actions);
          const visible = structuredClone(state);
          for (const action of shaped.actions) if (!modelActions.has(action) && action.op === 'clear') applyClear(visible, action.target);
          // Replay the validated inputs, not the expanded renderer output:
          // the validator recreates its derived follow-ons without counting them
          // a second time against the untrusted-input action cap.
          startTurn(visible);
          validateStep({ say: step.say, actions: owner.inputs }, visible);
          state = visible;
          owner.shown.push(shaped);
        },
        send: (message) => {
          // The guide clears the page by id between steps: the scene the answers are checked against forgets those ids too.
          if (message.kind === 'step' && guideChecking) for (const a of message.step.actions) if (a.op === 'clear') applyClear(guideChecking, a.target);
          send(displayId, message);
        },
        capture: () => deps.guide!.capture(displayId),
        // The picture the model was given: a move for the person is made only if the screen near it still looks like this.
        ...(deps.guide?.gridOf && modelPicture ? { reference: () => ({ screenshot: modelPicture, grid: deps.guide!.gridOf!(modelPicture) }) } : {}),
        listen: (listener) => deps.guide!.listen(displayId, listener),
        replan: (info) => replanWalk(displayId, g, question, info),
        finish: () => send(displayId, { kind: 'end', ...(escalate ? { escalate } : {}) }),
        onEnd: (why) => {
          if (walking?.guide === g) {
            walking.controller.abort();
            walking = null;
            guideChecking = undefined;
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
      // The initial answer is already producing this walk; a replacement
      // replan must be able to cancel that producer as well as later ones.
      walking = { guide: g, controller };
      return g;
    };
    const handOver = (step: Step, wasHeld: boolean, inputs: Action[]): void => {
      if (wasHeld && walk) { queuedGuideOwners.set(step, {shown, inputs}); walk.push(step); }
      else if (!walk && !detail && deps.guide && waitOf(step)) {
        walk = startWalk();
        checking = structuredClone(state);
        guideChecking = checking;
        walk.adopt(step); // already on the page: the guide waits for its click
      }
    };
    const closeLive = (): void => {
      if (!live) return;
      const done = live.finish();
      live = null;
      visiblePartial = undefined;
      if (done.issues.length > 0) {
        deps.log(validatorNotes(done.issues, shown.length + 1));
        deps.record?.issues(shown.length + 1, done.issues);
      }
      if (!held) send(displayId, { kind: 'step-close' });
      if (done.step) {
        accepted++;
        if (!held) shown.push(done.step);
        handOver(done.step, held, liveInputs);
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
          const inputs: Action[] = [];
          const checked = validateStep(out.step, checking, undefined, (action) => inputs.push(action));
          if (checked.issues.length > 0) {
            deps.log(validatorNotes(checked.issues, shown.length + 1));
            deps.record?.issues(shown.length + 1, checked.issues);
          }
          if (!checked.step) continue;
          const wasHeld = walk !== undefined;
          if (!wasHeld) open();
          accepted++;
          if (!wasHeld) shown.push(checked.step);
          r.firstStepMs ??= since();
          if (!wasHeld) send(displayId, { kind: 'step', step: checked.step });
          handOver(checked.step, wasHeld, inputs);
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
        if (!held) send(displayId, { kind: 'step-close' });
        if (visiblePartial && (visiblePartial.say || visiblePartial.actions.length)) shown.push(visiblePartial);
        visiblePartial = undefined;
      } else closeLive();
    }
    const incomplete = Boolean(failure && shown.length > 0);
    if (incomplete) {
      // Retain useful steps, but mark the answer incomplete both on screen and in follow-up history.
      const code = failure instanceof ModelError ? failure.code : 'failed';
      r.cutShort = `${source.kind}: ${code}: ${failure instanceof Error ? failure.message : String(failure)}`;
      deps.log(`answer cut short after ${shown.length} step${shown.length === 1 ? '' : 's'} (${r.cutShort}); what was shown stays`);
      failure = undefined;
    }
    if (failure) {
      const code = failure instanceof ModelError ? failure.code : 'failed';
      r.error = `${source.kind}: ${code}: ${failure instanceof Error ? failure.message : String(failure)}`;
      if (walk) walk.streamEnded();
      else if (begun) send(displayId, { kind: 'end' });
      return notice(displayId, failure instanceof ModelError && code === 'auth' && failure.message === NO_KEY_MESSAGE ? 'No API key is set.' : source.kind === 'backend' ? backendMessage(code) : modelMessage(code), 'error', source.kind !== 'backend' && (code === 'unavailable' || code === 'auth') ? 'settings' : undefined);
    }
    r.steps = shown.length;
    if (written.length > 0) {
      const o = orderScore(written, known);
      r.order = { score: Math.round(o.score * 100) / 100, refs: o.refs, early: o.early, missing: o.missing, wrong: o.wrong };
      if (o.examples.length > 0) deps.log(`order: ${o.examples.join('; ')}`);
    }
    if (escalate) r.escalate = escalate;
    r.endMs = since();
    if (shown.length === 0 && accepted === 0 && !escalate) {
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
      send(displayId, { kind: 'end', ...(escalate ? { escalate } : {}) });
    }
    if (incomplete) send(displayId, {
      kind: 'notice', level: 'warning', persistent: true,
      text: 'Answer interrupted. What is shown is incomplete. Ask a follow-up to continue, or ask again to retry.',
    });
    const kept: ThreadTurn = { question, steps: shown, ...(incomplete ? { incomplete: true as const } : {}), ...(detail ? { detail: true as const } : {}) };
    if (picture) pictures.set(kept, picture);
    if (detail) {
      // The scene on screen is now the richer one: the ids it did not write again are still there and still known.
      delete checking.replaceable;
      state = checking;
      send(displayId, { kind: 'status', status: 'idle' });
    }
    thread.push(kept);
    lastActivity = now();
    if (lastAsk) lastAsk.reason = detail ? undefined : escalate;
  }

  /** The page is given the screen as it is now, and its controls are read again (the screen changed under the person's click). */
  function lookAgain(displayId: number, question: string, picture: Screenshot, signal: AbortSignal, why: string): void {
    lastAsk = { question, screenshot: picture, clean: picture };
    send(displayId, { kind: 'screenshot', url: `data:${picture.mime};base64,${picture.base64}` });
    if (deps.controls) {
      // Late is fine, see begin.
      void deps.controls.read(displayId, signal).then((read) => {
        deps.log(`controls: ${read.boxes.length} read in ${read.ms} ms${read.why ? ` (${read.why})` : ''} (${why})`);
        if (!signal.aborted && read.boxes.length > 0) send(displayId, { kind: 'controls', boxes: read.boxes });
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
    // A previous streamed plan may still be waiting for its next step. Its
    // output must not reach this guide after a newer replan owns it.
    w.controller.abort();
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
    send(displayId, { kind: 'status', status: 'detail' });
    const scene = sceneSteps();
    const source: Source = {
      kind: 'model',
      label: model.id,
      stream: () => model.ask({ question: base.question, screenshot: base.clean, thread: [], schema: sceneSchemaLean, pieces: true, ...rawLog(), detail: { steps: scene }, signal: controller.signal }),
    };
    await answer(displayId, controller, r, since, base.question, source, true, true);
  }

  async function ask(a: Attempt, keepThread = false): Promise<void> {
    const controller = new AbortController();
    if (a.drain) controller.signal.addEventListener('abort', a.drain.finish, { once: true });
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
    deps.record?.begin('question');
    send(a.displayId, { kind: 'status', status: 'working' });
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
      if (a.drain) await a.drain.promise;
      else for (let waited = 0; a.open.size > 0 && waited < STROKE_TAIL_MS; waited += STROKE_TAIL_STEP_MS) await sleep(STROKE_TAIL_STEP_MS);
      if (controller.signal.aborted) return;
      const strokes = [...a.strokes.values()];
      deps.record?.strokes(strokes);
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
        return notice(a.displayId, "I can't hear you yet: no way to hear questions is set up.", 'error', 'hearing');
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
        if (code === 'unavailable') return notice(a.displayId, "I can't hear you yet: the speech recogniser isn't available.", 'error', 'hearing');
        return notice(a.displayId, 'Speech recognition failed. Try again.', 'error');
      }
      if (controller.signal.aborted) return;
      r.question = question;
      r.transcriptMs = since();
      deps.record?.transcript(question, r.speech);
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
      if (deps.record) {
        deps.record.picture('screenshot-sent', seen);
        if (seen !== shot.screenshot) deps.record.picture('screenshot-clean', shot.screenshot);
        focus?.forEach((f, k) => deps.record!.picture(`crop-${k + 1}-${f.kind}`, f.crop));
      }
      send(a.displayId, { kind: 'screenshot', url: `data:${shot.screenshot.mime};base64,${shot.screenshot.base64}` });
      if (a.controls && !toBackend) {
        // Not waited for: the page gets them when they come, after the screenshot they belong to.
        const sentAt = since();
        void a.controls.done.then((read) => {
          r.controlsMs = read.ms;
          r.controlsCount = read.boxes.length;
          deps.log(`controls: ${read.boxes.length} read in ${read.ms} ms${read.why ? ` (${read.why})` : ''}, the first mark could have been at ${sentAt} ms`);
          // Not for a screen that a newer press has since replaced.
          if (controller.signal.aborted || a.id !== nextId - 1 || read.boxes.length === 0) return;
          send(a.displayId, { kind: 'controls', boxes: read.boxes });
        });
      }

      // The step after an enlargement is shown a sharp picture of what was enlarged, from the frame this press grabbed.
      const grabId = shot.grabId;
      const cropOf = grabId !== undefined && deps.media.crop ? (box: Box) => deps.media.crop!(grabId, box) : undefined;
      const hold = walkHold(a.displayId, asking, 0);
      const source: Source = toBackend
        ? backendSource(a.displayId, 'spoken', asking, seen, undefined, controller.signal)
        : {
          kind: 'model',
          label: model.id,
          stream: () => model.ask({ question, screenshot: seen, ...(focus ? { focus } : {}), ...(cropOf ? { cropOf } : {}), thread, schema: sceneSchemaLean, pieces: true, ...rawLog(), afterStep: hold.afterStep, signal: controller.signal }),
          superseded: hold.superseded,
        };
      asked = !toBackend;
      await answer(a.displayId, controller, r, since, asking, source, keepThread);
    } finally {
      if (a.drain) {
        controller.signal.removeEventListener('abort', a.drain.finish);
        a.drain.finish();
      }
      if (penFor === a) penFor = null;
      if (!asked) model.unprime?.(); // the chord came to nothing: the spare thread is let go (and counted)
      releaseFrame(a);
      if (asking === controller) asking = null;
      deps.log(`report ${JSON.stringify(deps.logText ? r : { ...r, question: r.question ? '(not logged)' : '' })}`);
      reportOut(r);
    }
  }

  function resetThread(): void {
    walking?.guide.end('superseded');
    asking?.abort();
    thread = [];
    state = createSceneState();
  }

  return {
    arm,
    cancel,
    start,
    stop,
    startFollowup,
    sendFollowup,
    cancelFollowup,
    dismiss,
    setVisible(displayId: number, on: boolean): void {
      if (on) visibleAnswers.add(displayId);
      else visibleAnswers.delete(displayId);
    },
    micStarted,
    /** A piece of a pen stroke from the page on `displayId`; only the press being held (or just released) takes it. */
    stroke(displayId: number, piece: Stroke): void {
      const a = penFor;
      if (!a || a.displayId !== displayId || !Number.isFinite(piece.id) || (deps.penFlush && piece.attemptId !== a.id) || a.drain?.done) return;
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
    penFlushed(displayId: number, attemptId: number): void {
      const a = penFor;
      if (a?.displayId === displayId && a.id === attemptId) a.drain?.finish();
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
      reportOut(report);
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
      deps.record?.begin('offer');
      try {
        await answer(displayId, controller, r, () => now() - releasedAt, lastAsk.question, backendSource(displayId, 'offer', lastAsk.question, lastAsk.screenshot, lastAsk.reason, controller.signal), true);
      } finally {
        if (asking === controller) asking = null;
        deps.log(`report ${JSON.stringify(deps.logText ? r : { ...r, question: r.question ? '(not logged)' : '' })}`);
        reportOut(r);
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
      deps.record?.begin('detail');
      try {
        await runDetail(displayId, controller, r, () => now() - releasedAt);
      } finally {
        if (asking === controller) asking = null;
        deps.log(`report ${JSON.stringify(deps.logText ? r : { ...r, question: r.question ? '(not logged)' : '' })}`);
        reportOut(r);
      }
    },
    /** The tray's "Pin this answer". */
    pin(displayId: number): void {
      const said = pinNow();
      notice(displayId, said.text, said.ok ? 'info' : 'error');
    },
    /** The overlay was cleared by hand: the next question starts a new thread. */
    reset: resetThread,
    /** True while a question is being asked (keys held), answered or walked through: Escape is ours for as long (see escape.ts). */
    busy(): boolean {
      return attempt !== null || asking !== null || walking !== null;
    },
    /**
     * Escape. While the keys are held it cancels the question as a right click does (nothing is captured or heard, the strokes go, the person is told).
     * Otherwise it stops the answer: the model call is aborted, so no more steps are written or sent, and a walk through the page ends.
     * Says which it did; only the second leaves the drawing to be faded away.
     */
    escape(): 'cancelled' | 'stopped' | 'nothing' {
      const a = attempt;
      if (a && !a.chord) {
        dropAttempt('the follow-up recording was cancelled with Escape');
        send(a.displayId, { kind: 'status', status: 'idle' });
        return 'cancelled';
      }
      if (a?.chord) {
        dropAttempt('the question was cancelled with Escape');
        penFor = null;
        penOff(a.displayId);
        deps.log('question cancelled with Escape');
        notice(a.displayId, 'Cancelled.');
        return 'cancelled';
      }
      if (asking === null && walking === null) return 'nothing';
      deps.log('answer stopped with Escape');
      resetThread();
      return 'stopped';
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

/** The log line for what the validator changed or dropped in a step: how many, and the first few in words (a repaired part, a dropped action). */
export function validatorNotes(issues: readonly Issue[], stepNumber: number): string {
  // What was dropped comes first: an action that vanished must always have its reason in the log.
  const ordered = [...issues.filter((i) => i.kind === 'dropped'), ...issues.filter((i) => i.kind !== 'dropped')];
  const dropped = ordered.filter((i) => i.kind === 'dropped');
  const other = ordered.filter((i) => i.kind !== 'dropped');
  const shown = [...dropped, ...other.slice(0, 3)];
  const first = shown.map((i) => `${i.path} ${i.message}`.slice(0, 160)).join('; ');
  return `validator: ${issues.length} notes on step ${stepNumber}: ${first}${other.length > 3 ? '; ...' : ''}`;
}

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
