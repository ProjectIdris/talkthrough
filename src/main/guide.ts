// Guide mode: the answer to "how do I do this in that app" is a walk through the steps, one at a time.
// A step carries a `wait` action (see docs/scene-language.md). When such a step has been drawn and
// spoken, the guide waits for the person's own click, takes a fresh screenshot, and goes on to the next
// step only once the screen has really changed. A click somewhere else that changes the screen means the
// plan no longer fits, so the guide asks for a new plan from the screen as it is now. Escape, or the
// chord, ends it. The app never clicks for the person; the one exception is navigation, when the person has allowed
// it: a step may also carry a `go`, and the app then opens that tab or menu, follows that link or scrolls that page
// itself (main/nav.ts, guarded by shared/nav-guard.ts), after saying so aloud and giving the person a moment to stop it.
//
// This is the logic only: the screen, the clicks, the model and the page are all handed in, so the whole
// of it can be tried without a window. A short history of what happened lives here while the guide runs
// and is dropped when it ends.

import type { Screenshot } from '../adapters/types.ts';
import { VARIANTS } from '../scene/spec.ts';
import type { Action, Step } from '../scene/index.ts';
import type { NavDir, NavKind } from '../shared/nav-guard.ts';
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
  outcome: 'followed' | 'elsewhere' | 'unchanged' | 'navigated';
  /** For a move the app made for them: what it was. */
  nav?: NavKind;
  navDir?: NavDir;
};

/** A navigation move a step asks for: a point on the 0..1000 scale of the display, and what to do there. */
export type GoRequest = { kind: NavKind; x: number; y: number; dir?: NavDir };

/** What looking at the control under a `go` found: do it (after saying `announce`), or not (and why, for the log only). */
export type NavPlan = { verdict: 'do'; announce: string; handle: unknown } | { verdict: 'show' | 'refuse'; why: string };

/** The app's own hands, handed in by main (Windows only, and only when the person has turned navigation on). */
export type GuideNavigation = {
  /** Looks at what is under the point and asks the guard. Never throws; changes nothing. */
  plan(go: GoRequest, displayId: number): Promise<NavPlan>;
  /** Looks again, requires the same control, and does the one thing. True when it did. Never throws. */
  act(plan: NavPlan): Promise<boolean>;
  /** Where the pointer is now (screen pixels), so that moving it stops the move. */
  pointer?(): { x: number; y: number } | null;
};

export type GuideEnd = 'finished' | 'escape' | 'superseded' | 'idle' | 'failed';

export type GuideListener = { down(click: Click): void; up(click: Click): void; escape(): void; /** Any other key: while the app is about to act for the person, typing stops it. */ key?(): void };

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
  /** Absent: the app never acts for the person, and a `go` is ignored. */
  navigation?: GuideNavigation;
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
  /** Navigation: how long after the step's words the app waits before acting (the words and the announcement are spoken first), and how much more for each character said. */
  navBeatMs: number;
  navMsPerChar: number;
  /** The first move of a walk gets this much longer to be stopped in. */
  navFirstExtraMs: number;
  navPollMs: number;
  /** How far the pointer may move (screen pixels) before it counts as the person stopping the move. */
  navPointerPx: number;
  /** At most this many moves for the person in one walk. */
  navMax: number;
};

export const GUIDE_OPTIONS: GuideOptions = {
  onTargetChecks: [250, 650, 1100, 1700, 2500, 3700, 5200],
  elsewhereChecks: [300, 700, 1200],
  settleMs: 350,
  idleMs: 10 * 60_000,
  historyMax: 8,
  navBeatMs: 2400,
  navMsPerChar: 70,
  navFirstExtraMs: 1500,
  navPollMs: 50,
  navPointerPx: 60,
  navMax: 8,
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
        : e.outcome === 'navigated' ? `${navWords(e)} for them (they had allowed it) and the screen changed`
          : e.nav ? `${navWords(e)} for them (they had allowed it) and nothing changed`
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

/** What the app did, in words for the model: "the app opened the tab". */
function navWords(e: { nav?: NavKind; navDir?: NavDir }): string {
  switch (e.nav) {
    case 'tab': return 'the app opened the tab';
    case 'open': return 'the app opened the menu';
    case 'scroll': return `the app scrolled the page ${e.navDir ?? 'down'}`;
    default: return 'the app acted';
  }
}

/** The navigation move a step asks for (the first, when it asks for more), or null. */
export function goOf(step: Step): GoRequest | null {
  for (const a of step.actions) {
    if (a.op !== 'go') continue;
    return { kind: a.kind, x: a.x, y: a.y, ...(a.dir ? { dir: a.dir } : {}) };
  }
  return null;
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
type Phase = 'idle' | 'waiting' | 'checking' | 'navigating' | 'ended';

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
  // Navigation: how many moves the app has made for the person in this walk, why the one being prepared was stopped, and a
  // click the person finished (button up) while the app was still deciding.
  let navCount = 0;
  let navStop: string | null = null;
  let pendingUp: Click | null = null;
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
      const go = goOf(step);
      if (go && mayNavigate()) {
        void navigate(step, go);
        break;
      }
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
    stopListening ??= deps.listen(listener);
    armIdle();
  }

  const listener: GuideListener = {
    down: (click) => onDown(click),
    up: (click) => onUp(click),
    // Escape while the app is about to act stops that move only; the walk goes on, waiting for the person. Escape again ends it.
    escape: () => {
      if (phase === 'navigating') navStop = 'escape';
      else end('escape');
    },
    // Typing, or any other key, while the app is about to act stops it.
    key: () => {
      if (phase === 'navigating') navStop = 'key';
    },
  };

  function onDown(click: Click): void {
    if (phase === 'navigating') {
      // The person clicked for themselves: the app steps back, and their click is taken as any click would be.
      navStop = 'click';
      if (click.displayId === deps.displayId) baseline = safeCapture();
      return;
    }
    if (phase !== 'waiting' || click.displayId !== deps.displayId) return;
    baseline = safeCapture();
  }

  function onUp(click: Click): void {
    if (phase === 'navigating' && navStop === 'click') {
      pendingUp = click;
      return;
    }
    if (phase !== 'waiting' || !current) return;
    void checkClick(click, current, baseline ?? current.start);
  }

  async function checkClick(click: Click, now: NonNullable<typeof current>, before: Promise<Frame | null>, via?: GoRequest): Promise<void> {
    phase = 'checking';
    cancelIdle?.();
    deps.send({ kind: 'status', status: 'checking' });
    // A scroll moves the whole page, so what the next steps point at is gone whatever the target was.
    const onTarget = click.displayId === deps.displayId && inTarget(click, now.target) && via?.kind !== 'scroll';
    const checks = onTarget || via ? o.onTargetChecks : o.elsewhereChecks;
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
    const event = { say: now.step.say, expect: now.target, click: { x: Math.round(click.x), y: Math.round(click.y) }, ...(via ? { nav: via.kind, ...(via.dir ? { navDir: via.dir } : {}) } : {}) };
    if (!seen) {
      remember({ ...event, outcome: 'unchanged' });
      if (via && !waitOf(now.step)) {
        // The app tried and nothing changed, and the step asked for no click: carry on with the steps after it.
        current = null;
        baseline = null;
        phase = 'idle';
        pump();
        return;
      }
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
      remember({ ...event, outcome: via ? 'navigated' : 'followed' });
      tickFollowed();
      current = null;
      baseline = null;
      phase = 'idle';
      pump();
      return;
    }
    // The click was elsewhere and the screen moved on: the plan was made for a screen that is gone.
    remember({ ...event, outcome: via ? 'navigated' : 'elsewhere' });
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

  /** The app may act for the person: it has hands, and the walk has not used its share. */
  function mayNavigate(): boolean {
    return deps.navigation !== undefined && navCount < o.navMax;
  }

  /** What the app says it did, after it has done it. */
  function doneWords(go: GoRequest): string {
    switch (go.kind) {
      case 'tab': return 'Opened that tab for you.';
      case 'open': return 'Opened that menu for you.';
      case 'scroll': return `Scrolled ${go.dir ?? 'down'} for you.`;
    }
  }

  /** The app steps back: the step goes on as a plain guide step, waiting for the person's own click (or, with no wait, carrying on). */
  function stepBack(why: string): void {
    const c = current;
    deps.log(`guide: not acting for them (${why})`);
    if (!c) return;
    if (waitOf(c.step)) {
      phase = 'waiting';
      deps.send({ kind: 'status', status: 'waiting' });
      armIdle();
      const up = pendingUp;
      pendingUp = null;
      if (up) void checkClick(up, c, baseline ?? c.start);
      return;
    }
    current = null;
    phase = 'idle';
    pump();
  }

  /**
   * A step that carries a `go`: look at what is there and ask the guard; if it says yes, say so aloud, give the person a
   * moment to stop it (a key, a click, Escape, moving the pointer), check that the screen is still the one the step was made for,
   * and do it. Whatever goes wrong, the step falls back to what it always was: marks and a wait for the person's own click.
   */
  async function navigate(step: Step, go: GoRequest): Promise<void> {
    const nav = deps.navigation;
    if (!nav) return;
    phase = 'navigating';
    navStop = null;
    pendingUp = null;
    baseline = null;
    current = { step, target: waitOf(step)?.target ?? null, start: safeCapture() };
    deps.send({ kind: 'status', status: 'waiting' });
    stopListening ??= deps.listen(listener);
    armIdle();
    let plan: NavPlan;
    try {
      plan = await nav.plan(go, deps.displayId);
    } catch {
      plan = { verdict: 'show', why: 'it failed' };
    }
    if (phase !== 'navigating') return;
    if (navStop) return stepBack(`stopped (${navStop})`);
    if (plan.verdict !== 'do') return stepBack(plan.why);
    // Say it, and give them time to hear the step's words and this, and to stop it.
    deps.send({ kind: 'step', step: { say: plan.announce, actions: [] } });
    const first = navCount === 0;
    const beat = o.navBeatMs + o.navMsPerChar * Math.min(step.say.length, 160) + (first ? o.navFirstExtraMs : 0);
    const from = nav.pointer?.() ?? null;
    for (let waited = 0; waited < beat; waited += o.navPollMs) {
      await sleep(o.navPollMs);
      if (phase !== 'navigating') return;
      if (navStop) return stepBack(`stopped (${navStop})`);
      const at = nav.pointer?.() ?? null;
      if (from && at && Math.hypot(at.x - from.x, at.y - from.y) > o.navPointerPx) {
        navStop = 'pointer';
        return stepBack('the pointer moved');
      }
    }
    // The screen must still be the one this step was made for (a window opened, a page turned: the plan no longer fits).
    const start = current ? await current.start : null;
    const before = await safeCapture();
    if (phase !== 'navigating') return;
    if (navStop) return stepBack(`stopped (${navStop})`);
    if (start && before && screenChanged(start.grid, before.grid, null).changed) return stepBack('the screen changed meanwhile');
    navCount++;
    let did = false;
    try {
      did = await nav.act(plan);
    } catch {
      did = false;
    }
    if (phase !== 'navigating') return;
    if (!did) return stepBack('it did not act');
    deps.send({ kind: 'notice', text: doneWords(go), level: 'info' });
    deps.log(`guide: acted for them (${go.kind})`);
    const now = current;
    if (!now) return;
    // Did the screen change? The same check as after the person's own click, with the point the move was aimed at.
    await checkClick({ x: go.x, y: go.y, displayId: deps.displayId }, now, Promise.resolve(before), go);
  }

  return {
    /** True from the first step until the guide ends. */
    get active(): boolean {
      return phase !== 'ended';
    },
    /** True while a step is waiting for the person (or being checked after their click). */
    get waiting(): boolean {
      return phase === 'waiting' || phase === 'checking' || phase === 'navigating';
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
      const go = goOf(step);
      if (go && mayNavigate()) void navigate(step, go);
      else if (wait) startWaiting(step, wait.target);
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
