import type { Backend } from '../adapters/backend.ts';
import { ModelError } from '../adapters/model.ts';
import { NO_KEY_MESSAGE } from '../adapters/openai-model.ts';
import type { Model, ModelOutput, ThreadTurn, Usage } from '../adapters/model.ts';
import { SpeechToTextError } from '../adapters/speech-to-text.ts';
import type { SpeechToText } from '../adapters/speech-to-text.ts';
import type { Screenshot } from '../adapters/types.ts';
import { createSceneState, sceneSchemaLean, startTurn, validateEscalate, validateStep } from '../scene/index.ts';
import type { SceneState, Step } from '../scene/index.ts';
import { FADE_AFTER_MS } from '../shared/ipc.ts';
import type { MicResult, Milestone, SceneMessage, Stroke } from '../shared/ipc.ts';
import { isRealStroke } from '../shared/pen.ts';
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
    compose?(grabId: number, strokes: Point[][]): Promise<{ screenshot: Screenshot; crop: Screenshot; box: Box }>;
  };
  /**
   * Turns the pen on for one display (its overlay takes the mouse) or, with null, off everywhere and
   * gives click-through back. The session calls null on every way out of a held chord.
   */
  setPen(displayId: number | null): void;
  /** Null when no speech server is set up. */
  speech: SpeechToText | null;
  model(): Model;
  /** The deeper backend, when the user has set one up (their settings name its address). Absent: none. */
  backend?: Backend;
  send(displayId: number, message: SceneMessage): void;
  log(line: string): void;
  /** Checks only: put the question text in the log. Off by default, so a spoken question never reaches the console. */
  logText?: boolean;
  /** How long Right Ctrl may be held alone before the early microphone and capture are dropped. */
  micWindowMs: number;
  /** Epoch milliseconds. */
  now?(): number;
  /**
   * Keeps an answer (see pins.ts). Absent: pinning is not available. `screenshot` is given only when the
   * person has chosen to keep a picture of the screen with their pins.
   */
  pin?(input: { question: string; thread: readonly ThreadTurn[]; steps: readonly unknown[]; screenshot?: Screenshot }): { file: string };
  /** Whether the person has chosen to keep a picture of the screen with pins. */
  pinScreenshot?(): boolean;
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
  steps: number;
  /** What the model says the question cost, when it says. */
  tokens?: Usage;
  /** The person circled something with the pen and the model was shown it. */
  circled?: boolean;
  escalate?: string;
  error?: string;
};

/** What a screen grab gives: the picture, how long it took, and (if the media page kept it) the id of the full-resolution frame. */
type Grab = { screenshot: Screenshot; ms: number; grabId?: number };

/** After release, how long an unfinished stroke may still be waiting for its last piece. */
const STROKE_TAIL_MS = 150;

/** Shortest recording that counts as a question. */
const MIN_CLIP_MS = 400;
/** A new question within this long of the last answer continues it (the page fades a scene after FADE_AFTER_MS). */
const THREAD_WINDOW_MS = FADE_AFTER_MS + 3000;

type Attempt = {
  id: number;
  displayId: number;
  capture: Promise<Grab>;
  /** The pen strokes of this press, by stroke id, in the 0..1000 scale. */
  strokes: Map<number, Point[]>;
  /** Stroke ids whose last piece (`done`) has not arrived yet. */
  open: Set<number>;
  micStarted: boolean;
  chord: boolean;
  timer: NodeJS.Timeout | null;
};

/** Where an answer's steps come from: the model, or the backend. */
type Source = { kind: 'model' | 'backend'; label: string; stream(): AsyncIterable<ModelOutput>; /** A line to show instead, when the source answered with text only. */ message?(): string | undefined };

export function createSession(deps: SessionDeps) {
  const now = deps.now ?? (() => Date.now());
  const backend = deps.backend;
  let attempt: Attempt | null = null;
  let nextId = 1;
  let asking: AbortController | null = null;
  let thread: ThreadTurn[] = [];
  let state: SceneState = createSceneState();
  let lastActivity = 0;
  let lastAsk: { question: string; screenshot: Screenshot; /** The picture as grabbed, without a pen stroke. */ clean: Screenshot; reason?: string } | null = null;
  let report: QuestionReport | null = null;
  let releasedAt = 0;
  /** The press whose pen strokes still count: the one held now, and for a moment after release. */
  let penFor: Attempt | null = null;

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
    deps.media.abortMic();
    releaseFrame(a); // the frame is simply never used
    deps.log(`early microphone and capture dropped (${why})`);
  }

  function begin(withWindow: boolean): Attempt {
    const displayId = deps.pointerDisplayId();
    const a: Attempt = { id: nextId++, displayId, capture: deps.media.capture(displayId), strokes: new Map(), open: new Set(), micStarted: false, chord: false, timer: null };
    a.capture.catch(() => undefined); // an error is reported when the question is asked
    deps.media.startMic().catch((error: unknown) => deps.log(`microphone: ${error instanceof Error ? error.message : String(error)}`));
    if (withWindow) a.timer = setTimeout(() => dropAttempt('Right Shift did not follow in time'), deps.micWindowMs);
    attempt = a;
    return a;
  }

  /** Right Ctrl went down first: open the microphone and start the screen grab now. */
  function arm(): void {
    if (attempt) dropAttempt('a new press began');
    begin(true);
  }

  function cancel(): void {
    if (attempt && !attempt.chord) dropAttempt('Right Ctrl was released alone');
  }

  /** Both keys are down. */
  function start(): void {
    asking?.abort();
    const a = attempt && !attempt.chord ? attempt : (attempt && dropAttempt('a new press began'), begin(false));
    if (a.timer) clearTimeout(a.timer);
    a.timer = null;
    a.chord = true;
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
  function stop(): void {
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
      const keep = deps.pinScreenshot?.() === true && lastAsk?.clean;
      deps.pin({ question: last.question, thread: [...thread], steps: thread.flatMap((t) => [...t.steps]), ...(keep ? { screenshot: keep } : {}) });
      return { ok: true, text: keep ? 'Pinned, with the screenshot.' : 'Pinned.' };
    } catch (error) {
      deps.log(`pin: ${error instanceof Error ? error.message : String(error)}`);
      return { ok: false, text: "I couldn't save the pin." };
    }
  }

  /** What the backend is told about the scene on screen: the steps drawn in this thread and the ids in use. */
  function sceneOnScreen(): { steps: unknown[]; ids: Record<string, string> } {
    return { steps: thread.flatMap((t) => [...t.steps]), ids: Object.fromEntries(state.ids) };
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
  async function answer(displayId: number, controller: AbortController, r: QuestionReport, since: () => number, question: string, source: Source, keepThread = false): Promise<void> {
    const continuing = thread.length > 0 && (keepThread || now() - lastActivity < THREAD_WINDOW_MS);
    if (!continuing) {
      thread = [];
      state = createSceneState();
    }
    const turn = thread.length + 1;
    startTurn(state);
    deps.log(`question heard (turn ${turn}, ${source.label}${deps.logText ? `): ${JSON.stringify(question)}` : ')'}`);

    const shown: Step[] = [];
    let begun = false;
    const open = () => {
      if (begun) return;
      begun = true;
      deps.send(displayId, { kind: 'begin', turn });
    };
    let escalate: string | undefined;
    let failure: unknown;
    try {
      for await (const out of source.stream()) {
        if (out.type !== 'usage') r.firstPieceMs ??= since();
        if (controller.signal.aborted) break;
        if (out.type === 'step') {
          const checked = validateStep(out.step, state);
          if (checked.issues.length > 0) deps.log(`validator: ${checked.issues.length} notes on step ${shown.length + 1}`);
          if (!checked.step) continue;
          open();
          shown.push(checked.step);
          r.firstStepMs ??= since();
          deps.send(displayId, { kind: 'step', step: checked.step });
        } else if (out.type === 'usage') {
          r.tokens = out.usage;
        } else {
          escalate = validateEscalate(out.reason).escalate;
        }
      }
    } catch (error) {
      failure = error;
    }
    if (controller.signal.aborted) return;
    if (failure) {
      const code = failure instanceof ModelError ? failure.code : 'failed';
      r.error = `${source.kind}: ${code}: ${failure instanceof Error ? failure.message : String(failure)}`;
      if (begun) deps.send(displayId, { kind: 'end' });
      return notice(displayId, failure instanceof ModelError && code === 'auth' && failure.message === NO_KEY_MESSAGE ? 'No API key is set. Open the tray menu and choose API key.' : source.kind === 'backend' ? backendMessage(code) : modelMessage(code), 'error');
    }
    r.steps = shown.length;
    if (escalate) r.escalate = escalate;
    r.endMs = since();
    if (shown.length === 0 && !escalate) {
      const said = source.message?.();
      if (said) return notice(displayId, said);
      r.error = `the ${source.kind} gave nothing to show`;
      return notice(displayId, "I couldn't work out an answer to that. Try asking another way?");
    }
    open();
    deps.send(displayId, { kind: 'end', ...(escalate ? { escalate } : {}) });
    thread.push({ question, steps: shown });
    lastActivity = now();
    if (lastAsk) lastAsk.reason = escalate;
  }

  async function ask(a: Attempt): Promise<void> {
    const controller = new AbortController();
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
      for (let waited = 0; a.open.size > 0 && waited < STROKE_TAIL_MS; waited += 10) await new Promise<void>((resolve) => setTimeout(resolve, 10));
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
      if (parseSpoken(question)?.kind === 'pin') {
        // Not a question: keep what is on screen. No picture is needed, and the model is not asked.
        const said = pinNow();
        r.error = said.ok ? undefined : 'pin failed';
        return notice(a.displayId, said.text, said.ok ? 'info' : 'error');
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
      let focus: { crop: Screenshot; box: Box } | undefined;
      if (composed) {
        try {
          const c = await composed;
          seen = c.screenshot;
          focus = { crop: c.crop, box: c.box };
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

      const source: Source = toBackend
        ? backendSource(a.displayId, 'spoken', asking, seen, undefined, controller.signal)
        : {
          kind: 'model',
          label: model.id,
          stream: () => model.ask({ question, screenshot: seen, ...(focus ? { focus } : {}), thread, schema: sceneSchemaLean, signal: controller.signal }),
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
    /** The tray's "Pin this answer". */
    pin(displayId: number): void {
      const said = pinNow();
      notice(displayId, said.text, said.ok ? 'info' : 'error');
    },
    /** The overlay was cleared by hand: the next question starts a new thread. */
    reset(): void {
      asking?.abort();
      thread = [];
      state = createSceneState();
    },
    dispose(): void {
      asking?.abort();
      if (attempt?.timer) clearTimeout(attempt.timer);
      if (attempt?.chord) penOff(attempt.displayId);
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
