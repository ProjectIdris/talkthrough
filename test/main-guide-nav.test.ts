import assert from 'node:assert/strict';
import test from 'node:test';
import { createGuide, goOf, guideQuestion } from '../src/main/guide.ts';
import type { Click, Frame, GuideEnd, GuideEvent, GuideListener, GuideNavigation, GoRequest, NavPlan } from '../src/main/guide.ts';
import type { Step } from '../src/scene/index.ts';
import type { SceneMessage } from '../src/shared/ipc.ts';
import { GRID_COLS, GRID_ROWS } from '../src/shared/screen-diff.ts';
import type { Grid } from '../src/shared/screen-diff.ts';

const flat = (v: number): Grid => ({ cols: GRID_COLS, rows: GRID_ROWS, luma: new Uint8Array(GRID_COLS * GRID_ROWS).fill(v) });
const frame = (v: number): Frame => ({ screenshot: { mime: 'image/png', base64: `f${v}`, width: 10, height: 10 }, grid: flat(v) });
const SAME = frame(235), TURNED = frame(90);

const TARGET = { x: 400, y: 100, w: 100, h: 40 };
/** A step that asks the app to open the tab at the target, and waits for the person if the app does not. */
const goStep = (say: string, kind: GoRequest['kind'] = 'tab', dir?: 'up' | 'down'): Step => ({
  say,
  actions: [
    { op: 'box', id: `b-${say}`, x: 10, y: 10, w: 100, h: 50, color: 'red' },
    { op: 'go', kind, x: 450, y: 120, ...(dir ? { dir } : {}) },
    { op: 'wait', for: 'click', ...TARGET },
  ],
});
const plainStep = (say: string): Step => ({
  say,
  actions: [{ op: 'box', id: `p-${say}`, x: 10, y: 10, w: 100, h: 50, color: 'red' }, { op: 'wait', for: 'click', ...TARGET }],
});
const on: Click = { x: 450, y: 120, displayId: 7 };

type Fake = {
  nav: GuideNavigation;
  planned: GoRequest[];
  acted: NavPlan[];
  /** What happens to the screen when the app acts. */
  onAct: { screen?: Frame };
};

function fakeNav(options: { plan?: NavPlan; acts?: boolean; pointer?: () => { x: number; y: number } | null; onActed?: () => void } = {}): Fake {
  const planned: GoRequest[] = [];
  const acted: NavPlan[] = [];
  const onAct: { screen?: Frame } = {};
  const nav: GuideNavigation = {
    plan: async (go) => {
      planned.push(go);
      return options.plan ?? { verdict: 'do', announce: "I'll open that tab for you.", handle: 'h' };
    },
    act: async (plan) => {
      acted.push(plan);
      options.onActed?.();
      return options.acts ?? true;
    },
    ...(options.pointer ? { pointer: options.pointer } : {}),
  };
  return { nav, planned, acted, onAct };
}

function rig(first: Frame, navigation: GuideNavigation | undefined, extra: { sleep?: (ms: number) => Promise<void>; replan?: Parameters<typeof createGuide>[0]['replan']; screenRef?: { screen: Frame } } = {}) {
  const sent: SceneMessage[] = [];
  let listener: GuideListener | undefined;
  const ends: GuideEnd[] = [];
  const screenRef = extra.screenRef ?? { screen: first };
  const g = createGuide({
    displayId: 7,
    send: (m) => void sent.push(m),
    capture: async () => screenRef.screen,
    listen: (l) => ((listener = l), () => undefined),
    replan: extra.replan ?? (async () => undefined),
    finish: () => void sent.push({ kind: 'end' }),
    onEnd: (why) => void ends.push(why),
    log: () => undefined,
    sleep: extra.sleep ?? (async () => undefined),
    after: () => () => undefined,
    ...(navigation ? { navigation } : {}),
  });
  const says = () => sent.filter((m): m is Extract<SceneMessage, { kind: 'step' }> => m.kind === 'step').map((m) => m.step.say);
  const settle = () => new Promise((r) => setTimeout(r, 20));
  return { g, sent, says, ends, screenRef, settle, get listener() { return listener!; } };
}

test('a step with a go is read out of its actions', () => {
  assert.deepEqual(goOf(goStep('a', 'scroll', 'down')), { kind: 'scroll', x: 450, y: 120, dir: 'down' });
  assert.equal(goOf(plainStep('a')), null);
});

test('the guard says yes: the app says so first, acts, sees the screen change and moves on to the next step', async () => {
  const f = fakeNav();
  const r = rig(SAME, f.nav, { sleep: async () => undefined });
  f.nav.act = async (plan) => {
    f.acted.push(plan);
    r.screenRef.screen = TURNED;
    return true;
  };
  r.g.push(goStep('open the tab'));
  r.g.push(plainStep('then this'));
  await r.settle();
  assert.deepEqual(f.planned, [{ kind: 'tab', x: 450, y: 120 }]);
  assert.equal(f.acted.length, 1);
  assert.deepEqual(r.says(), ["open the tab", "I'll open that tab for you.", 'then this'], 'the announcement comes before the act, and the next step after');
  assert.ok(r.sent.some((m) => m.kind === 'notice' && m.text === 'Opened that tab for you.'));
});

test('the guard says show or refuse: no announcement, no act; the step stays a plain wait for the person', async () => {
  for (const verdict of ['show', 'refuse'] as const) {
    const f = fakeNav({ plan: { verdict, why: 'a button, not a tab' } });
    const r = rig(SAME, f.nav);
    r.g.push(goStep('open the tab'));
    await r.settle();
    assert.equal(f.acted.length, 0, `${verdict}: nothing was done`);
    assert.deepEqual(r.says(), ['open the tab'], `${verdict}: nothing was announced`);
    assert.equal(r.sent.at(-1)?.kind, 'status');
    assert.deepEqual((r.sent.at(-1) as { status: string }).status, 'waiting');
  }
});

test('without a navigation the go is ignored and the step is a plain wait', async () => {
  const r = rig(SAME, undefined);
  r.g.push(goStep('open the tab'));
  await r.settle();
  assert.deepEqual(r.says(), ['open the tab']);
  assert.equal((r.sent.at(-1) as { status: string }).status, 'waiting');
});

test('a key, Escape, a click or the pointer moving during the beat stops the move; the step goes on as a plain wait', async () => {
  const cases: Array<[string, (l: GuideListener) => void, boolean]> = [
    ['a key', (l) => l.key?.(), false],
    ['Escape', (l) => l.escape(), false],
    ['a click', (l) => l.down({ x: 800, y: 800, displayId: 7 }), false],
  ];
  for (const [name, stop] of cases) {
    const f = fakeNav();
    let ticks = 0;
    const holder: { l?: GuideListener } = {};
    const r = rig(SAME, f.nav, {
      sleep: async () => {
        if (++ticks === 3) stop(holder.l!);
      },
    });
    Object.defineProperty(holder, 'l', { get: () => r.listener });
    r.g.push(goStep('open the tab'));
    await r.settle();
    assert.equal(f.acted.length, 0, `${name}: the app did not act`);
    assert.equal(r.g.active, true, `${name}: the walk goes on`);
    assert.equal((r.sent.at(-1) as { status: string }).status, 'waiting', `${name}: waiting for the person`);
  }
  // the pointer
  let at = { x: 100, y: 100 };
  let ticks = 0;
  const f = fakeNav({ pointer: () => at });
  const r = rig(SAME, f.nav, { sleep: async () => void (++ticks === 3 && (at = { x: 400, y: 400 })) });
  r.g.push(goStep('open the tab'));
  await r.settle();
  assert.equal(f.acted.length, 0, 'the pointer moved: the app did not act');
  assert.equal(r.g.active, true);
});

test('Escape a second time, with the app only waiting, ends the walk', async () => {
  const f = fakeNav({ plan: { verdict: 'show', why: 'x' } });
  const r = rig(SAME, f.nav);
  r.g.push(goStep('open the tab'));
  await r.settle();
  r.listener.escape();
  assert.deepEqual(r.ends, ['escape']);
});

test('the screen changed while the app was deciding: it does not act', async () => {
  const f = fakeNav();
  const r = rig(SAME, f.nav);
  let calls = 0;
  const realPlan = f.nav.plan;
  f.nav.plan = async (go, id) => {
    calls++;
    r.screenRef.screen = TURNED;
    return realPlan(go, id);
  };
  r.g.push(goStep('open the tab'));
  await r.settle();
  assert.equal(calls, 1);
  assert.equal(f.acted.length, 0);
});

test('an act that did not happen falls back to a plain wait and the person can click for themselves', async () => {
  const f = fakeNav({ acts: false });
  const r = rig(SAME, f.nav);
  r.g.push(goStep('open the tab'));
  r.g.push(plainStep('then this'));
  await r.settle();
  assert.equal(f.acted.length, 1);
  assert.deepEqual(r.says(), ['open the tab', "I'll open that tab for you."]);
  assert.equal((r.sent.at(-1) as { status: string }).status, 'waiting');
  r.listener.down(on);
  await r.settle();
  r.screenRef.screen = TURNED;
  r.listener.up(on);
  await r.settle();
  assert.deepEqual(r.says().at(-1), 'then this');
});

test('a scroll asks for a new plan, with the app move in the history', async () => {
  const f = fakeNav({ plan: { verdict: 'do', announce: "I'll scroll down for you.", handle: 'h' } });
  const got: GuideEvent[][] = [];
  const r = rig(SAME, f.nav, { replan: async (info) => void got.push([...info.history]) });
  f.nav.act = async (plan) => {
    f.acted.push(plan);
    r.screenRef.screen = TURNED;
    return true;
  };
  r.g.push(goStep('scroll down', 'scroll', 'down'));
  await r.settle();
  assert.equal(got.length, 1, 'the screen moved on: a new plan');
  assert.equal(got[0]![0]!.outcome, 'navigated');
  assert.equal(got[0]![0]!.nav, 'scroll');
  assert.match(guideQuestion('help me', { history: got[0]!, click: { x: 450, y: 120, displayId: 7 } }), /the app scrolled the page down/);
});

test('the app acts for the person only so many times in a walk; then it only points', async () => {
  const f = fakeNav();
  const r = rig(SAME, f.nav);
  let flip = false;
  f.nav.act = async (plan) => {
    f.acted.push(plan);
    flip = !flip;
    r.screenRef.screen = flip ? TURNED : SAME;
    return true;
  };
  for (let i = 0; i < 12; i++) r.g.push(goStep(`s${i}`));
  await r.settle();
  await new Promise((res) => setTimeout(res, 100));
  assert.equal(f.acted.length, 8, 'eight and no more');
  assert.equal(f.planned.length, 8);
});

test('the first move has a longer beat than the later ones', async () => {
  const f = fakeNav();
  const slept: number[] = [];
  const r = rig(SAME, f.nav, { sleep: async (ms) => void slept.push(ms) });
  const beats: number[] = [];
  let at = 0;
  f.nav.act = async (plan) => {
    f.acted.push(plan);
    beats.push(slept.length - at);
    at = slept.length;
    r.screenRef.screen = r.screenRef.screen === TURNED ? SAME : TURNED;
    return true;
  };
  r.g.push(goStep('first one'));
  r.g.push(goStep('first two'));
  await r.settle();
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(beats.length, 2);
  assert.ok(beats[0]! > beats[1]!, `the first beat (${beats[0]} polls) is longer than the second (${beats[1]})`);
});
