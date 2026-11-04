import assert from 'node:assert/strict';
import test from 'node:test';
import { createGuide, goOf, guideQuestion } from '../src/main/guide.ts';
import { createNavConsent } from '../src/main/nav-consent.ts';
import type { NavConsent } from '../src/main/nav-consent.ts';
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

function rig(first: Frame, navigation: GuideNavigation | undefined, extra: { reference?: () => Frame | null; after?: (ms: number, run: () => void) => () => void; sleep?: (ms: number) => Promise<void>; replan?: Parameters<typeof createGuide>[0]['replan']; screenRef?: { screen: Frame } } = {}) {
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
    after: extra.after ?? (() => () => undefined),
    ...(extra.reference ? { reference: extra.reference } : {}),
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

// ---- the person's say-so: a yes before the first move, a pause any time ----------------------------------------------

function consented(options: { given?: boolean } = {}) {
  const consent = createNavConsent({ after: () => () => undefined });
  if (options.given) { void consent.ask(); consent.answer(true); }
  const f = fakeNav();
  f.nav.consent = consent;
  return { consent, ...f };
}
const consentTexts = (r: ReturnType<typeof rig>) => r.sent.filter((m): m is Extract<SceneMessage, { kind: 'consent' }> => m.kind === 'consent').map((m) => m.text);
const flipOnAct = (c: ReturnType<typeof consented>, r: ReturnType<typeof rig>) => {
  c.nav.act = async (plan) => {
    c.acted.push(plan);
    r.screenRef.screen = r.screenRef.screen === TURNED ? SAME : TURNED;
    return true;
  };
};

test('the first move in a session is asked about and waits for a yes; a yes lets it announce and act, and the next move is not asked about', async () => {
  const c = consented();
  const r = rig(SAME, c.nav);
  flipOnAct(c, r);
  r.g.push(goStep('first'));
  r.g.push(goStep('second'));
  await r.settle();
  assert.equal(c.acted.length, 0, 'nothing is done before the yes');
  assert.equal(c.consent.pending(), true);
  assert.match(r.says().at(-1)!, /Say yes, or click Yes/);
  assert.equal(consentTexts(r).length, 1, 'the overlay is asked to show a Yes');
  assert.match(consentTexts(r)[0]!, /open that tab/);
  c.consent.answer(true);
  await r.settle();
  await new Promise((res) => setTimeout(res, 60));
  assert.equal(c.acted.length, 2, 'both moves were done once the yes was given');
  assert.equal(consentTexts(r).filter((t) => t !== null).length, 1, 'asked once only');
  assert.equal(consentTexts(r)[1], null, 'the card went away with the answer');
  assert.ok(r.says().includes("I'll open that tab for you."), 'and the announcement was still made');
});

test('a no, a timeout, Escape, or nobody answering: no move, a plain wait, and the card goes away', async () => {
  for (const how of ['no', 'timeout', 'escape'] as const) {
    const c = consented();
    const r = rig(SAME, c.nav);
    r.g.push(goStep('open the tab'));
    await r.settle();
    if (how === 'no') c.consent.answer(false);
    else if (how === 'escape') r.listener.escape();
    else c.consent.cancel(); // what the 30 s timeout does is tested with the consent itself
    await r.settle();
    assert.equal(c.acted.length, 0, how);
    assert.equal(r.g.active, true, `${how}: the walk goes on`);
    assert.equal(consentTexts(r).at(-1), null, `${how}: the card is gone`);
    assert.equal((r.sent.at(-1) as { status: string }).status, 'waiting', how);
    assert.equal(c.consent.given(), false, `${how}: and no yes is remembered`);
  }
});

test('keys during the question do not stop it (the keys are how they say yes), a press on the pointed spot does, a press elsewhere does not', async () => {
  const c = consented();
  const r = rig(SAME, c.nav, { after: (ms, run) => { if (ms === 400) setTimeout(run, 5); return () => undefined; } });
  r.g.push(goStep('open the tab'));
  await r.settle();
  r.listener.key?.();
  r.listener.down({ x: 800, y: 800, displayId: 7 });
  r.listener.up({ x: 800, y: 800, displayId: 7 });
  await r.settle();
  assert.equal(c.consent.pending(), true, 'still asking');
  // the person clicks the tab themselves
  r.listener.down(on);
  r.screenRef.screen = TURNED;
  r.listener.up(on);
  await r.settle();
  await new Promise((res) => setTimeout(res, 30));
  assert.equal(c.consent.pending(), false);
  assert.equal(c.acted.length, 0, 'the app did not act');
  assert.equal(r.g.active, true);
});

test('the Yes card sitting over the pointed spot: a yes that comes at once beats the click reading', async () => {
  const c = consented();
  let fire: (() => void) | undefined;
  const r = rig(SAME, c.nav, { after: (ms, run) => { if (ms !== 400) return () => undefined; fire = run; return () => { fire = undefined; }; } });
  flipOnAct(c, r);
  r.g.push(goStep('open the tab'));
  await r.settle();
  r.listener.down(on);
  r.listener.up(on);
  c.consent.answer(true); // the card's button
  await r.settle();
  fire?.(); // the timer would have fired later: it was cancelled by the answer
  await r.settle();
  assert.equal(c.acted.length, 1);
});

test('a pause stops the move: no question, no act; a pause during the question is a no; a pause during the beat drops the move', async () => {
  const p = consented({ given: true });
  p.consent.setPaused(true);
  const r1 = rig(SAME, p.nav);
  r1.g.push(goStep('open the tab'));
  await r1.settle();
  assert.equal(p.acted.length, 0, 'paused: nothing');
  assert.equal(consentTexts(r1).length, 0, 'and no question');
  // paused while it waits for the yes
  const c = consented();
  const r2 = rig(SAME, c.nav);
  r2.g.push(goStep('open the tab'));
  await r2.settle();
  c.consent.setPaused(true);
  await r2.settle();
  assert.equal(c.acted.length, 0);
  assert.equal(c.consent.pending(), false);
  // paused during the beat
  const b = consented({ given: true });
  let ticks = 0;
  const r3 = rig(SAME, b.nav, { sleep: async () => void (++ticks === 3 && b.consent.setPaused(true)) });
  r3.g.push(goStep('open the tab'));
  await r3.settle();
  assert.equal(b.acted.length, 0, 'paused during the beat');
  assert.equal(r3.g.active, true);
});

test('the walk ending while the question is open closes it', async () => {
  const c = consented();
  const r = rig(SAME, c.nav);
  r.g.push(goStep('open the tab'));
  await r.settle();
  r.g.end('superseded');
  assert.equal(c.consent.pending(), false);
  assert.equal(consentTexts(r).at(-1), null);
});

test('a yes is remembered for the session, a pause is not a no, and without a yes the guard is never reached by an act', async () => {
  const c = consented();
  const r = rig(SAME, c.nav);
  r.g.push(goStep('open the tab'));
  await r.settle();
  assert.equal(c.acted.length, 0);
  const consent: NavConsent = c.consent;
  consent.setPaused(true);
  consent.setPaused(false);
  assert.equal(consent.given(), false);
});

// ---- the screen must still be the one the model was shown ---------------------------------------------------------------

/** The same screen with a block of it (a box on the 0..1000 scale) in another brightness. */
function patched(base: Frame, box: { x: number; y: number; w: number; h: number }, value: number): Frame {
  const luma = new Uint8Array(base.grid.luma);
  for (let r = Math.floor((box.y / 1000) * GRID_ROWS); r < Math.ceil(((box.y + box.h) / 1000) * GRID_ROWS); r++) {
    for (let c = Math.floor((box.x / 1000) * GRID_COLS); c < Math.ceil(((box.x + box.w) / 1000) * GRID_COLS); c++) luma[r * GRID_COLS + c] = value;
  }
  return { screenshot: { ...base.screenshot, base64: `p${value}` }, grid: { ...base.grid, luma } };
}
const NEAR = { x: 380, y: 60, w: 160, h: 120 }; // round the go point (450, 120)
const FAR = { x: 900, y: 900, w: 40, h: 30 };

async function goWith(opts: { reference: Frame | null | 'throws'; screen: Frame }) {
  const c = consented({ given: true });
  const r = rig(opts.screen, c.nav, {
    reference: () => {
      if (opts.reference === 'throws') throw new Error('no grid');
      return opts.reference;
    },
  });
  flipOnAct(c, r);
  r.g.push(goStep('open the tab'));
  await r.settle();
  await new Promise((res) => setTimeout(res, 30));
  return { acted: c.acted.length, r };
}

test('the move is made only if the screen near it still looks like the picture the model was given', async () => {
  assert.equal((await goWith({ reference: SAME, screen: SAME })).acted, 1, 'the same screen: done');
  // A tab was changed while the model was thinking: the screen at the point is not what it saw. The step came up after that,
  // so the screen then and the screen now agree with each other, and only the model's picture shows the difference.
  const moved = patched(SAME, NEAR, 40);
  const stale = await goWith({ reference: SAME, screen: moved });
  assert.equal(stale.acted, 0, 'the screen near the target is not what the model saw: refused');
  assert.equal(stale.r.g.active, true, 'and the walk goes on as a plain wait');
});

test('a change far from the target that is small does not refuse the move; a big one anywhere does', async () => {
  assert.equal((await goWith({ reference: SAME, screen: patched(SAME, FAR, 40) })).acted, 1, 'a clock in a corner');
  assert.equal((await goWith({ reference: SAME, screen: TURNED })).acted, 0, 'a different page');
});

test('without a picture of what the model saw the screen when the step came up is the reference; a reference that fails is the same', async () => {
  assert.equal((await goWith({ reference: null, screen: SAME })).acted, 1);
  assert.equal((await goWith({ reference: 'throws', screen: SAME })).acted, 1);
});

test('after a step the person followed, the reference is the screen they reached, not the first picture the model was given', async () => {
  const c = consented({ given: true });
  const r = rig(SAME, c.nav, { reference: () => SAME });
  flipOnAct(c, r);
  r.g.push(plainStep('first'));
  r.g.push(goStep('then open the tab'));
  await r.settle();
  r.listener.down(on);
  r.screenRef.screen = TURNED; // their click turned the page; the next step is for that page
  r.listener.up(on);
  await r.settle();
  await new Promise((res) => setTimeout(res, 60));
  assert.equal(c.acted.length, 1, 'the move for the new page is allowed');
});
