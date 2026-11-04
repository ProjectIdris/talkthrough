import assert from 'node:assert/strict';
import test from 'node:test';
import { createGuide, waitOf } from '../src/main/guide.ts';
import type { Click, Frame, GuideEnd, GuideEvent, GuideListener } from '../src/main/guide.ts';
import type { Step } from '../src/scene/index.ts';
import type { SceneMessage } from '../src/shared/ipc.ts';
import { GRID_COLS, GRID_ROWS } from '../src/shared/screen-diff.ts';
import type { Grid } from '../src/shared/screen-diff.ts';

const flat = (v: number): Grid => ({ cols: GRID_COLS, rows: GRID_ROWS, luma: new Uint8Array(GRID_COLS * GRID_ROWS).fill(v) });
const frame = (v: number): Frame => ({ screenshot: { mime: 'image/png', base64: `f${v}`, width: 10, height: 10 }, grid: flat(v) });
/** The same screen again; a page that turned (every block differs); another page. */
const SAME = frame(235), TURNED = frame(90), OTHER = frame(150);

const guideStep = (say: string, target?: { x: number; y: number; w: number; h: number }): Step => ({
  say,
  actions: [{ op: 'box', id: `b-${say}`, x: 10, y: 10, w: 100, h: 50, color: 'red' }, { op: 'wait', for: 'click', ...(target ?? {}) }],
});
const TARGET = { x: 400, y: 100, w: 100, h: 40 };
const on: Click = { x: 450, y: 120, displayId: 7 };
const away: Click = { x: 800, y: 800, displayId: 7 };

type Replan = (info: { frame: Frame; click: Click; history: readonly GuideEvent[]; shown: readonly Step[] }) => Promise<void>;

/**
 * A guide with a screen that starts as `first` and becomes whatever a click is told to make it (after the
 * button goes down, as it would in an app).
 */
function rig(first: Frame, options: { replan?: Replan } = {}) {
  const sent: SceneMessage[] = [];
  let listener: GuideListener | undefined;
  let listening = 0;
  let stopped = 0;
  let finished = 0;
  const ends: GuideEnd[] = [];
  const idleRuns: Array<() => void> = [];
  let screen = first;
  const g = createGuide({
    displayId: 7,
    send: (m) => void sent.push(m),
    capture: async () => screen,
    listen: (l) => {
      listener = l;
      listening++;
      return () => void stopped++;
    },
    replan: options.replan ?? (async () => undefined),
    finish: () => {
      finished++;
      sent.push({ kind: 'end' });
    },
    onEnd: (why) => void ends.push(why),
    log: () => undefined,
    sleep: async () => undefined,
    after: (_ms, run) => {
      idleRuns.push(run);
      return () => undefined;
    },
  });
  const kinds = () => sent.map((m) => (m.kind === 'status' ? `status:${m.status}` : m.kind === 'notice' ? `notice:${m.level}` : m.kind));
  const click = async (c: Click, makes?: Frame) => {
    listener!.down(c);
    await new Promise((r) => setTimeout(r, 1));
    if (makes) screen = makes;
    listener!.up(c);
    await new Promise((r) => setTimeout(r, 5));
  };
  const says = () => sent.filter((m): m is Extract<SceneMessage, { kind: 'step' }> => m.kind === 'step').map((m) => m.step.say);
  return {
    g, sent, kinds, click, says, ends, idleRuns,
    get listener() { return listener!; },
    get listening() { return listening; },
    get stopped() { return stopped; },
    get finished() { return finished; },
  };
}

test('a step with a wait names its target; one without names nothing', () => {
  assert.deepEqual(waitOf(guideStep('a', TARGET)), { target: TARGET });
  assert.deepEqual(waitOf(guideStep('a')), { target: null });
  assert.equal(waitOf({ say: 'x', actions: [] }), null);
});

test('the first step is shown and the app waits; the next comes only after a click on the target that changes the screen', async () => {
  const r = rig(SAME);
  r.g.push(guideStep('one', TARGET));
  r.g.push(guideStep('two', TARGET));
  assert.deepEqual(r.kinds(), ['step', 'status:waiting'], 'only the first step shows');
  assert.equal(r.listening, 1);
  await r.click(on, TURNED);
  const steps = r.sent.filter((m): m is Extract<SceneMessage, { kind: 'step' }> => m.kind === 'step');
  assert.equal(steps.length, 2);
  assert.deepEqual(steps[1]!.step.actions[0], { op: 'clear', target: 'b-one' }, 'the second step takes the first step marks away');
  assert.equal(steps[0]!.step.actions[0]!.op, 'box', 'the first one does not clear what the answer already drew');
  assert.equal(r.kinds().at(-1), 'status:waiting');
});

test('a click on the target that changes nothing keeps waiting, says so once, and a later try can succeed', async () => {
  const r = rig(SAME);
  r.g.push(guideStep('one', TARGET));
  r.g.push(guideStep('two', TARGET));
  await r.click(on);
  assert.equal(r.says().length, 1);
  assert.equal(r.kinds().filter((k) => k === 'notice:info').length, 1);
  await r.click(on);
  assert.equal(r.kinds().filter((k) => k === 'notice:info').length, 1, 'told only once');
  assert.equal(r.says().length, 1);
  await r.click(on, TURNED);
  assert.equal(r.says().length, 2);
});

test('the guide ends when the last step is done and the model has finished', async () => {
  const r = rig(SAME);
  r.g.push(guideStep('only', TARGET));
  r.g.streamEnded();
  assert.equal(r.finished, 0);
  await r.click(on, TURNED);
  assert.equal(r.finished, 1);
  assert.deepEqual(r.ends, ['finished']);
  assert.equal(r.stopped, 1);
  assert.equal(r.g.active, false);
  r.g.push(guideStep('late'));
  assert.equal(r.says().length, 1, 'nothing more after the end');
});

test('a plain step after a waiting one is shown at once after the click; the guide waits again at the next waiting step', async () => {
  const r = rig(SAME);
  r.g.push(guideStep('one', TARGET));
  r.g.push({ say: 'Nice.', actions: [{ op: 'label', id: 'l', x: 1, y: 1, text: 'ok', color: 'green' }] });
  r.g.push(guideStep('three', TARGET));
  await r.click(on, TURNED);
  assert.deepEqual(r.says(), ['one', 'Nice.', 'three']);
  assert.equal(r.kinds().at(-1), 'status:waiting');
});

test('a click away from the target that changes the screen asks for a new plan from the new screen, with the history', async () => {
  const got: Array<{ frame: Frame; click: Click; history: GuideEvent[]; shown: Step[] }> = [];
  const holder: { g?: ReturnType<typeof rig>['g'] } = {};
  const r = rig(SAME, {
    replan: async (info) => {
      got.push({ ...info, history: [...info.history], shown: [...info.shown] });
      holder.g!.push(guideStep('new one', TARGET));
      holder.g!.streamEnded();
    },
  });
  holder.g = r.g;
  r.g.push(guideStep('one', TARGET));
  r.g.push(guideStep('two', TARGET));
  await r.click(away, OTHER);
  assert.equal(got.length, 1);
  assert.equal(got[0]!.frame, OTHER);
  assert.deepEqual(got[0]!.click, away);
  assert.deepEqual(got[0]!.history.map((h) => [h.say, h.outcome]), [['one', 'elsewhere']]);
  assert.equal(got[0]!.shown.length, 1);
  assert.deepEqual(r.says(), ['one', 'new one'], 'the old plan is dropped and the new first step shows');
  assert.equal(r.kinds().at(-1), 'status:waiting');
});

test('a click elsewhere that changes nothing is ignored: the plan still stands', async () => {
  let replans = 0;
  const r = rig(SAME, { replan: async () => void replans++ });
  r.g.push(guideStep('one', TARGET));
  r.g.push(guideStep('two', TARGET));
  await r.click(away);
  assert.equal(replans, 0);
  assert.equal(r.kinds().at(-1), 'status:waiting');
  assert.equal(r.sent.filter((m) => m.kind === 'notice').length, 0, 'no fuss about a stray click');
});

test('a click on another display counts as elsewhere', async () => {
  let replans = 0;
  const r = rig(SAME, { replan: async () => void replans++ });
  r.g.push(guideStep('one', TARGET));
  await r.click({ ...on, displayId: 9 }, OTHER);
  assert.equal(replans, 1);
});

test('Escape ends the guide, clears the page and stops listening', async () => {
  const r = rig(SAME);
  r.g.push(guideStep('one', TARGET));
  r.listener.escape();
  assert.deepEqual(r.ends, ['escape']);
  assert.deepEqual(r.kinds().slice(-2), ['status:idle', 'clear']);
  assert.equal(r.stopped, 1);
  assert.equal(r.finished, 0);
  await r.click(on);
  assert.equal(r.kinds().at(-1), 'clear', 'a click after the end does nothing');
});

test('the chord (a new question) ends the guide without touching the page', () => {
  const r = rig(SAME);
  r.g.push(guideStep('one', TARGET));
  const before = r.sent.length;
  r.g.end('superseded');
  assert.equal(r.sent.length, before);
  assert.deepEqual(r.ends, ['superseded']);
  assert.equal(r.stopped, 1);
});

test('a guide nobody clicks on gives up after its time and clears the page', () => {
  const r = rig(SAME);
  r.g.push(guideStep('one', TARGET));
  assert.ok(r.idleRuns.length >= 1);
  r.idleRuns.at(-1)!();
  assert.deepEqual(r.ends, ['idle']);
  assert.equal(r.kinds().at(-1), 'clear');
});

test('a plan that cannot be made ends the guide with an error notice', async () => {
  const r = rig(SAME, { replan: async () => { throw new Error('model down'); } });
  r.g.push(guideStep('one', TARGET));
  await r.click(away, OTHER);
  assert.deepEqual(r.ends, ['failed']);
  assert.ok(r.sent.some((m) => m.kind === 'notice' && m.level === 'error'));
  assert.equal(r.kinds().at(-1), 'clear');
});

test('the history handed to a new plan keeps the last eight events only', async () => {
  let seen: GuideEvent[] = [];
  const holder: { g?: ReturnType<typeof rig>['g'] } = {};
  // twelve steps followed (the screen alternates), then a click elsewhere
  const r = rig(SAME, { replan: async (info) => { seen = [...info.history]; holder.g!.streamEnded(); } });
  holder.g = r.g;
  for (let i = 0; i < 14; i++) r.g.push(guideStep(`s${i}`, TARGET));
  for (let i = 0; i < 12; i++) await r.click(on, frame(i % 2 === 0 ? 90 : 235));
  await r.click(away, OTHER);
  assert.ok(r.says().length > 8, 'the walk went on');
  assert.ok(seen.length > 0 && seen.length <= 8, `history was ${seen.length}`);
});

test('the screen could not be looked at: the guide keeps waiting instead of moving on', async () => {
  const sent: SceneMessage[] = [];
  let listener: GuideListener | undefined;
  const g = createGuide({
    displayId: 7,
    send: (m) => void sent.push(m),
    capture: async () => { throw new Error('no capture'); },
    listen: (l) => ((listener = l), () => undefined),
    replan: async () => undefined,
    finish: () => undefined,
    onEnd: () => undefined,
    log: () => undefined,
    sleep: async () => undefined,
    after: () => () => undefined,
  });
  g.push(guideStep('one', TARGET));
  g.push(guideStep('two', TARGET));
  listener!.down(on);
  listener!.up(on);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(sent.filter((m) => m.kind === 'step').length, 1);
});

// The checklist: a steps diagram the model draws in the first step; it stays when marks are cleared and is ticked as steps are followed.
const checklistStep = (say: string, target = TARGET): Step => ({
  say,
  actions: [
    { op: 'box', id: `b-${say}`, x: 10, y: 10, w: 100, h: 50, color: 'red' },
    { op: 'wait', for: 'click', ...target },
    { op: 'diagram', id: 'plan', kind: 'steps', x: 700, y: 100, w: 280, h: 300, title: 'Export' },
    { op: 'node', id: 'n1', of: 'plan', text: 'File menu' },
    { op: 'node', id: 'n2', of: 'plan', text: 'Export' },
    { op: 'node', id: 'n3', of: 'plan', text: 'PDF' },
  ],
});
const stepsSent = (r: ReturnType<typeof rig>) => r.sent.filter((m): m is Extract<SceneMessage, { kind: 'step' }> => m.kind === 'step').map((m) => m.step);

test('the checklist stays while each step takes away the last step marks, and a followed step is ticked on the next one', async () => {
  const r = rig(SAME);
  r.g.push(checklistStep('one'));
  r.g.push(guideStep('two', TARGET));
  r.g.push({ say: 'three', actions: [{ op: 'card', id: 'done', x: 300, y: 300, w: 300, title: 'Done', rows: ['ok'] }] });
  r.g.streamEnded();
  await r.click(on, TURNED);
  const two = stepsSent(r)[1]!.actions;
  assert.deepEqual(two.slice(0, 2), [{ op: 'clear', target: 'b-one' }, { op: 'tick', id: 'n1' }], 'its own box goes, the plan does not, and the first node is ticked');
  assert.ok(!two.some((a) => a.op === 'clear' && (a.target === 'marks' || a.target === 'plan')));
  assert.deepEqual(two.at(-1), { op: 'highlight', id: 'n2', at: 0.5 }, 'the next node is pointed at');
  await r.click(on, OTHER);
  const three = stepsSent(r)[2]!.actions;
  assert.deepEqual(three.slice(0, 2), [{ op: 'clear', target: 'b-two' }, { op: 'tick', id: 'n2' }]);
  assert.equal(r.finished, 1, 'a step with no wait ends the walk');
});

test('the last step followed is ticked on a step of its own, and a click that changed nothing ticks nothing', async () => {
  const r = rig(SAME);
  r.g.push(checklistStep('one'));
  r.g.streamEnded();
  await r.click(on);
  assert.ok(!stepsSent(r).some((s) => s.actions.some((a) => a.op === 'tick')), 'nothing changed: not ticked');
  await r.click(on, TURNED);
  const last = stepsSent(r).at(-1)!;
  assert.deepEqual(last, { say: '', actions: [{ op: 'tick', id: 'n1' }] });
  assert.equal(r.finished, 1);
});

test('a click elsewhere that changes the screen takes the old checklist away and ticks nothing; the new plan draws its own', async () => {
  let r!: ReturnType<typeof rig>;
  r = rig(SAME, { replan: async () => { r.g.push(checklistStep('again')); r.g.streamEnded(); } });
  r.g.push(checklistStep('one'));
  await r.click(away, TURNED);
  const again = stepsSent(r)[1]!.actions;
  assert.deepEqual(again.slice(0, 2), [{ op: 'clear', target: 'b-one' }, { op: 'clear', target: 'plan' }], 'the old marks and the old plan go first');
  assert.ok(!again.some((a) => a.op === 'tick'), 'a click elsewhere followed no step');
  assert.ok(again.some((a) => a.op === 'diagram'), 'and the new plan comes after');
});
