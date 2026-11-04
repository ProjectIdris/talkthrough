// Guide mode: the answer to "how do I do this in that app" is a walk through the steps, one at a time.
// A step carries a `wait` action (see docs/scene-language.md). When such a step has been drawn and
// spoken, the guide waits for the person's own click, takes a fresh screenshot, and goes on to the next
// step only once the screen has really changed. A click somewhere else that changes the screen means the
// plan no longer fits, so the guide asks for a new plan from the screen as it is now. Escape, or the
// chord, ends it. The app never clicks for the person.
//
// This is the logic only: the screen, the clicks, the model and the page are all handed in, so the whole
// of it can be tried without a window. A short history of what happened lives here while the guide runs
// and is dropped when it ends.

import type { Screenshot } from '../adapters/types.ts';
import { VARIANTS } from '../scene/spec.ts';
import type { Action, Step } from '../scene/index.ts';
import type { SceneMessage } from '../shared/ipc.ts';
import { inTarget, screenChanged } from '../shared/screen-diff.ts';
import type { Box, Grid } from '../shared/screen-diff.ts';

/** A click, on the 0..1000 scale of the display it landed on. */
export type Click = { x: number; y: number; displayId: number };

/** The screen at one moment: the picture the model would be shown, and its brightness grid. */
export type Frame = { screenshot: Screenshot; grid: Grid };

export type GuideEvent = {
  /** The words of the step. */
  say: string;
  /** Where the step said to click, if it said. */
  expect: Box | null;
  click: { x: number; y: number } | null;
  /** followed: the click was on the target and the screen changed; elsewhere: the screen changed after a click away from the target; unchanged: nothing changed. */
  outcome: 'followed' | 'elsewhere' | 'unchanged';
};

export type GuideEnd = 'finished' | 'escape' | 'superseded' | 'idle' | 'failed';

export type GuideListener = { down(click: Click): void; up(click: Click): void; escape(): void };

export type GuideDeps = {
  displayId: number;
  /** How many steps of this answer are already on the page before the guide's first (so its first gets a clear page too). */
  prior?: number;
  send(message: SceneMessage): void;
  /** A fresh screenshot of the display (and its grid). May throw. */
  capture(): Promise<Frame>;
  /** Starts listening for clicks and Escape; returns how to stop. Called when the first waiting step is shown. */
  listen(listener: GuideListener): () => void;
  /**
   * The click landed away from where the step pointed and the screen changed: make a new plan from `frame`.
   * Its steps come back through push(), and streamEnded() ends them. Rejecting ends the guide.
   */
  replan(info: { frame: Frame; click: Click; history: readonly GuideEvent[]; shown: readonly Step[]; clears: readonly string[] }): Promise<void>;
  /** What to send when the guide has run its course (the end of the turn, with anything the model asked for). */
  finish(): void;
  /** The guide is over, however it ended. */
  onEnd(why: GuideEnd): void;
  log(line: string): void;
  /** Test seams. */
  sleep?(ms: number): Promise<void>;
  after?(ms: number, run: () => void): () => void;
  options?: Partial<GuideOptions>;
};

export type GuideOptions = {
  /** When to look at the screen after a click on the target (ms after the click). */
  onTargetChecks: readonly number[];
  /** The same after a click elsewhere, where a quiet screen means nothing happened. */
  elsewhereChecks: readonly number[];
  /** After a change is seen, how long to let the screen settle before the picture the next step is made from. */
  settleMs: number;
  /** How long a guide may wait for a click before it gives up. */
  idleMs: number;
  /** How many events the history keeps. */
  historyMax: number;
};

export const GUIDE_OPTIONS: GuideOptions = {
  onTargetChecks: [250, 650, 1100, 1700, 2500, 3700, 5200],
  elsewhereChecks: [300, 700, 1200],
  settleMs: 350,
  idleMs: 10 * 60_000,
  historyMax: 8,
};

/**
 * The question for a new plan made partway through a walk: the original question, and what has happened so far, so the
 * model carries on from the screen it is shown now instead of starting again.
 */
export function guideQuestion(question: string, info: { history: readonly GuideEvent[]; click: Click }): string {
  const lines = info.history.map((e) => {
    const said = e.say.length > 140 ? `${e.say.slice(0, 137)}...` : e.say;
    const how = e.outcome === 'followed' ? 'they clicked where it said and the screen changed'
      : e.outcome === 'elsewhere' ? `they clicked elsewhere (at ${e.click?.x ?? '?'}, ${e.click?.y ?? '?'}) and the screen changed`
        : 'they clicked and nothing changed';
    return `- "${said}": ${how}.`;
  });
  return [
    question,
    '',
    'This is a guided walk and the person is partway through it. What has happened so far:',
    ...lines,
    'The picture is the screen as it is now. Give the next steps from this screen: one move to a step, each ending with wait. The old checklist is gone: draw a new one in the first step for the moves still to do.',
  ].join('\n');
}

/** The wait a step asks for, or null when it asks for none. */
export function waitOf(step: Step): { target: Box | null } | null {
  for (const a of step.actions) {
    if (a.op !== 'wait') continue;
    const target = a.x !== undefined && a.y !== undefined && a.w !== undefined && a.h !== undefined ? { x: a.x, y: a.y, w: a.w, h: a.h } : null;
    return { target };
  }
  return null;
}

/** The ops that draw a mark or a pin on the page (what the next guide step takes away; the checklist is not one). */
const MARK_OPS: ReadonlySet<string> = new Set(VARIANTS.filter((v) => v.creates === 'mark' || v.creates === 'pin').map((v) => v.op));
const isMark = (a: Action): a is Action & { id: string } => MARK_OPS.has(a.op) && typeof (a as { id?: unknown }).id === 'string';

/** idle: between steps (or while a new plan is being made); waiting: a step has asked for a click; checking: the click came and the screen is being looked at. */
type Phase = 'idle' | 'waiting' | 'checking' | 'ended';

export function createGuide(deps: GuideDeps) {
  const o: GuideOptions = { ...GUIDE_OPTIONS, ...deps.options };
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const after = deps.after ?? ((ms: number, run: () => void) => {
    const t = setTimeout(run, ms);
    t.unref();
    return () => clearTimeout(t);
  });

  let phase: Phase = 'idle';
  const queue: Step[] = [];
  const shown: Step[] = [];
  let history: GuideEvent[] = [];
  let current: { step: Step; target: Box | null; start: Promise<Frame | null> } | null = null;
  let baseline: Promise<Frame | null> | null = null;
  let streamDone = false;
  let stopListening: (() => void) | null = null;
  let cancelIdle: (() => void) | null = null;
  let told = false;
  // The checklist (a steps diagram the model drew) and the marks of the steps shown so far: each step takes away the
  // last one's marks by id and leaves the checklist, which gets a tick as each step is followed.
  let live: string[] = [];
  let checklist: { id: string; nodes: string[] } | null = null;
  const ticked = new Set<string>();
  let pendingTicks: string[] = [];
  let pendingClears: string[] = [];

  /** Takes note of what a step draws: its marks (to be cleared by the next step) and the checklist and its nodes. */
  function scan(step: Step): void {
    for (const a of step.actions) {
      if (a.op === 'diagram' && a.kind === 'steps') {
        if (checklist && checklist.id !== a.id) pendingClears.push(checklist.id);
        if (checklist?.id !== a.id) ticked.clear();
        checklist = { id: a.id, nodes: [] };
      } else if (a.op === 'node' && checklist && a.of === checklist.id) {
        if (!checklist.nodes.includes(a.id)) checklist.nodes.push(a.id);
      } else if (isMark(a) && !live.includes(a.id)) {
        live.push(a.id);
      }
    }
  }

  /** The step as it goes to the page: the last step's marks cleared (not the checklist), the step just followed ticked off. */
  function shape(step: Step, first: boolean): Step {
    const clears: Action[] = first && (deps.prior ?? 0) === 0 ? []
      : first ? [{ op: 'clear', target: 'marks' }]
        : [...live, ...pendingClears].map((id) => ({ op: 'clear', target: id }) as Action);
    live = [];
    pendingClears = [];
    scan(step);
    const ticks: Action[] = pendingTicks.map((id) => ({ op: 'tick', id }) as Action);
    pendingTicks = [];
    const next = checklist?.nodes.find((id) => !ticked.has(id));
    const nudge: Action[] = ticks.length && next && !step.actions.some((a) => a.op === 'highlight' && a.id === next)
      ? [{ op: 'highlight', id: next, at: 0.5 } as Action] : [];
    return { ...step, actions: [...clears, ...ticks, ...step.actions, ...nudge] };
  }

  /** The step just followed is ticked off the checklist (on the page with the next step). */
  function tickFollowed(): void {
    const id = checklist?.nodes.find((n) => !ticked.has(n));
    if (!id) return;
    ticked.add(id);
    pendingTicks.push(id);
  }

  const safeCapture = (): Promise<Frame | null> => deps.capture().then((f) => f, (error: unknown) => {
    deps.log(`guide: could not look at the screen (${error instanceof Error ? error.message : String(error)})`);
    return null;
  });

  function armIdle(): void {
    cancelIdle?.();
    cancelIdle = after(o.idleMs, () => end('idle'));
  }

  function end(why: GuideEnd): void {
    if (phase === 'ended') return;
    phase = 'ended';
    cancelIdle?.();
    stopListening?.();
    stopListening = null;
    const ticks = pendingTicks;
    pendingTicks = [];
    pendingClears = [];
    live = [];
    checklist = null;
    ticked.clear();
    queue.length = 0;
    current = null;
    baseline = null;
    history = [];
    shown.length = 0;
    deps.log(`guide ended (${why})`);
    if (why === 'finished') {
      // The last step followed has no step after it to carry its tick: it goes alone.
      if (ticks.length) deps.send({ kind: 'step', step: { say: '', actions: ticks.map((id) => ({ op: 'tick', id }) as Action) } });
      deps.finish();
      deps.send({ kind: 'status', status: 'idle' });
    } else if (why === 'escape' || why === 'idle' || why === 'failed') {
      deps.send({ kind: 'status', status: 'idle' });
      deps.send({ kind: 'clear' });
    }
    deps.onEnd(why);
  }

  function remember(event: GuideEvent): void {
    history.push(event);
    if (history.length > o.historyMax) history = history.slice(history.length - o.historyMax);
  }

  /** Shows the next waiting step, or the plain steps before it, when nothing is being waited for. */
  function pump(): void {
    while (phase === 'idle') {
      const step = queue.shift();
      if (!step) break;
      // Each guide step starts from a clear page (the checklist stays); the first one keeps whatever the answer already drew.
      const out: Step = shape(step, shown.length === 0);
      shown.push(step);
      deps.send({ kind: 'step', step: out });
      const wait = waitOf(step);
      if (!wait) continue;
      startWaiting(step, wait.target);
    }
    if (phase === 'idle' && queue.length === 0) {
      if (streamDone) end('finished');
      else if (shown.length > 0) deps.send({ kind: 'status', status: 'working' });
    }
  }

  /** A step has been drawn and spoken and asks for a click: wait for it. */
  function startWaiting(step: Step, target: Box | null): void {
    current = { step, target, start: safeCapture() };
    phase = 'waiting';
    deps.send({ kind: 'status', status: 'waiting' });
    stopListening ??= deps.listen({ down: onDown, up: onUp, escape: () => end('escape') });
    armIdle();
  }

  function onDown(click: Click): void {
    if (phase !== 'waiting' || click.displayId !== deps.displayId) return;
    baseline = safeCapture();
  }

  function onUp(click: Click): void {
    if (phase !== 'waiting' || !current) return;
    void checkClick(click, current, baseline ?? current.start);
  }

  async function checkClick(click: Click, now: NonNullable<typeof current>, before: Promise<Frame | null>): Promise<void> {
    phase = 'checking';
    cancelIdle?.();
    deps.send({ kind: 'status', status: 'checking' });
    const onTarget = click.displayId === deps.displayId && inTarget(click, now.target);
    const checks = onTarget ? o.onTargetChecks : o.elsewhereChecks;
    const start = await before;
    let seen: Frame | null = null;
    if (start) {
      let last = 0;
      for (const at of checks) {
        await sleep(at - last);
        last = at;
        if (phase !== 'checking') return;
        const frame = await safeCapture();
        if (phase !== 'checking') return;
        if (frame && screenChanged(start.grid, frame.grid, now.target).changed) {
          await sleep(o.settleMs);
          if (phase !== 'checking') return;
          seen = (await safeCapture()) ?? frame;
          break;
        }
      }
    }
    if (phase !== 'checking') return;
    const event = { say: now.step.say, expect: now.target, click: { x: Math.round(click.x), y: Math.round(click.y) } };
    if (!seen) {
      remember({ ...event, outcome: 'unchanged' });
      // Nothing happened: keep waiting for another try, and say so once.
      phase = 'waiting';
      deps.send({ kind: 'status', status: 'waiting' });
      if (onTarget && !told) {
        told = true;
        deps.send({ kind: 'notice', text: "Nothing changed on the screen yet. Click again, or hold the keys and ask me.", level: 'info' });
      }
      armIdle();
      return;
    }
    if (onTarget) {
      remember({ ...event, outcome: 'followed' });
      tickFollowed();
      current = null;
      baseline = null;
      phase = 'idle';
      pump();
      return;
    }
    // The click was elsewhere and the screen moved on: the plan was made for a screen that is gone.
    remember({ ...event, outcome: 'elsewhere' });
    // The old checklist belongs to a plan for a screen that is gone: it goes with the old marks, and the new plan draws its own.
    if (checklist) pendingClears.push(checklist.id);
    checklist = null;
    ticked.clear();
    pendingTicks = [];
    current = null;
    baseline = null;
    queue.length = 0;
    streamDone = false;
    phase = 'idle';
    deps.send({ kind: 'status', status: 'working' });
    try {
      await deps.replan({ frame: seen, click, history: [...history], shown: [...shown], clears: [...live, ...pendingClears] });
    } catch (error) {
      deps.log(`guide: could not make a new plan (${error instanceof Error ? error.message : String(error)})`);
      deps.send({ kind: 'notice', text: "I couldn't work out the next step. Hold the keys and ask me again.", level: 'error' });
      end('failed');
      return;
    }
  }

  return {
    /** True from the first step until the guide ends. */
    get active(): boolean {
      return phase !== 'ended';
    },
    /** True while a step is waiting for the person (or being checked after their click). */
    get waiting(): boolean {
      return phase === 'waiting' || phase === 'checking';
    },
    /** A step from the model, already checked by the validator. */
    push(step: Step): void {
      if (phase === 'ended') return;
      queue.push(step);
      pump();
    },
    /**
     * A step that is already on the page (it was drawn as it streamed in): the guide takes it as the step in
     * hand, waiting for its click if it asks for one.
     */
    adopt(step: Step): void {
      if (phase !== 'idle') {
        queue.push(step); // not the step in hand: it is drawn in its turn like any other
        return;
      }
      scan(step);
      shown.push(step);
      const wait = waitOf(step);
      if (wait) startWaiting(step, wait.target);
      else pump();
    },
    /** The model has given all of its steps. */
    streamEnded(): void {
      streamDone = true;
      pump();
    },
    /** The steps shown so far, oldest first (for the thread). */
    get steps(): readonly Step[] {
      return shown;
    },
    end,
  };
}
