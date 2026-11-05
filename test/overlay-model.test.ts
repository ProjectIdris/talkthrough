import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, InstancedMesh, Mesh, Vector3 } from 'three';
import type { Object3D } from 'three';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { drawFraction, samplePath, tubeGeometry } from '../src/overlay/geometry.ts';
import { AutoFade, FADE_MS, HOLD_MS, fadeFrame } from '../src/overlay/fade.ts';
import { HudState, NOTICE_FADE_MS, NOTICE_MS } from '../src/overlay/hud.ts';
import { drawMarks } from '../src/overlay/marks.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';
import type { Step } from '../src/scene/index.ts';

const step = (...actions: unknown[]): Step => ({ say: 'x', actions }) as Step;
const settled = (...actions: unknown[]): Frame => frameAt([step({ op: 'panel', x: 100, y: 100, w: 600, h: 500 }, ...actions)], 0, 99);
const keyOf = (f: Frame, id: string) => f.objects.find((o) => o.id === id)?.key ?? -1;
const meshes = (o: Object3D | undefined): Array<Mesh | InstancedMesh> => {
  const out: Array<Mesh | InstancedMesh> = [];
  o?.traverse((c) => { if (c instanceof Mesh || c instanceof InstancedMesh) out.push(c as Mesh); });
  return out;
};

test('every shape of the modelling vocabulary builds, and parts build as many pieces as they say', () => {
  const frame = settled(
    { op: 'add', shape: 'box', id: 'box', size: [2, 1, 3], bevel: 0.2 },
    { op: 'add', shape: 'extrude', id: 'wing', outline: [[0, 0], [4, 0], [3, 2], [0, 1]], depth: 0.4, bevel: 0.05 },
    { op: 'add', shape: 'lathe', id: 'vase', profile: [[0, 0], [1, 0], [1.2, 2], [0.5, 3]], sides: 12 },
    { op: 'add', shape: 'tube', id: 'cable', pts: [[0, 0, 0], [1, 1, 0], [2, 1, 1]], radius: 0.2, flat: 0.1 },
    { op: 'add', shape: 'arrow', id: 'arrow', pts: [[0, 0, 0], [0, 3, 0]] },
    { op: 'add', shape: 'part', id: 'header', part: 'header', size: [4, 1, 0.5], n: 10 },
    { op: 'add', shape: 'part', id: 'fan', part: 'fan', size: [2, 0.4, 2], n: 7 },
    { op: 'add', shape: 'part', id: 'eth', part: 'port', variant: 'ethernet', size: [2, 1.5, 2] },
  );
  const scene = new PanelScene();
  scene.sync(frame, 1);
  assert.equal(scene.count(), 8);
  for (const o of frame.objects) {
    const node = scene.nodeOf(o.key);
    assert.ok(node, o.id);
    assert.ok(meshes(node).length > 0, `${o.id} has something to draw`);
  }
  const header = meshes(scene.nodeOf(keyOf(frame, 'header')));
  const pins = header.find((m): m is InstancedMesh => m instanceof InstancedMesh);
  assert.equal(pins?.count, 20, 'ten pins in each of two rows, in one draw');
  const fan = meshes(scene.nodeOf(keyOf(frame, 'fan')));
  assert.ok(fan.length >= 7 + 2, 'a hub, seven blades and a ring');
});

test('a part fits the box it is given', () => {
  const frame = settled(
    { op: 'add', shape: 'part', id: 'chip', part: 'chip', size: [2, 0.4, 3] },
    { op: 'add', shape: 'part', id: 'port', part: 'port', variant: 'usb3', size: [2, 1.5, 2.5] },
    { op: 'add', shape: 'part', id: 'wheel', part: 'wheel', size: [4, 4, 1] },
  );
  const scene = new PanelScene();
  scene.sync(frame, 1);
  for (const [id, size] of [['chip', [2, 0.4, 3]], ['port', [2, 1.5, 2.5]], ['wheel', [4, 4, 1]]] as const) {
    const box = new Box3().setFromObject(scene.nodeOf(keyOf(frame, id)) as Object3D);
    const got = box.getSize(new Vector3()).toArray();
    for (let i = 0; i < 3; i++) assert.ok(Math.abs((got[i] as number) - (size[i] as number)) < 0.2 * (size[i] as number) + 0.05, `${id} axis ${i}: ${got[i]} vs ${size[i]}`);
  }
});

test('exploding pushes the parts out from the group origin; assembled they sit at their own places', () => {
  const build = (to: number) => settled(
    { op: 'add', shape: 'group', id: 'g' },
    { op: 'add', shape: 'box', id: 'a', parent: 'g', pos: [2, 1, 0], size: [1, 1, 1] },
    { op: 'explode', id: 'g', to, dur: 0 },
  );
  const at = (f: Frame) => {
    const scene = new PanelScene();
    scene.sync(f, 1);
    return (scene.nodeOf(keyOf(f, 'a')) as Object3D).getWorldPosition(new Vector3()).toArray();
  };
  assert.deepEqual(at(build(0)), [2, 1, 0]);
  assert.deepEqual(at(build(1)), [4, 2, 0]);
  assert.deepEqual(at(build(0.5)).map((n) => Math.round(n * 100) / 100), [3, 1.5, 0]);
});

test('a tube is drawn on from its start, a ring at a time', () => {
  const path = samplePath([[0, 0, 0], [0, 2, 0], [2, 2, 0]], true, 10);
  assert.ok(path.length > 20 && path[0]?.join() === '0,0,0' && path[path.length - 1]?.join() === '2,2,0');
  const geo = tubeGeometry(path, 0.2, 1, 8);
  const all = geo.index?.count ?? 0;
  drawFraction(geo, 1);
  assert.equal(geo.drawRange.count, all);
  drawFraction(geo, 0.5);
  assert.ok(Math.abs(geo.drawRange.count - all / 2) <= all / path.length + 6, `${geo.drawRange.count} of ${all}`);
  drawFraction(geo, 0);
  assert.equal(geo.drawRange.count, 0);
});

test('a flat tube is a ribbon: wide across the path, thin the other way', () => {
  const path = samplePath([[0, 0, 0], [0, 4, 0]], false, 4);
  const geo = tubeGeometry(path, 1, 0.1, 16);
  geo.computeBoundingBox();
  const size = (geo.boundingBox as Box3).getSize(new Vector3());
  assert.ok(Math.abs(size.x - 2) < 0.01 && Math.abs(size.z - 0.2) < 0.01, `${size.x} x ${size.z}`);
});

test('a point on an object lands where the camera sees it, and follows the object when it moves', () => {
  // A big fixed box keeps the camera where it is while the small one moves inside it.
  const frame = (x: number) => settled({ op: 'add', shape: 'box', id: 'floor', size: [20, 20, 20], opacity: 0.2 }, { op: 'add', shape: 'box', id: 'a', size: [1, 1, 1] }, { op: 'move', id: 'a', to: [x, 0, 0], dur: 0 }, { op: 'orbit', az: 0, el: 0, dur: 0 });
  const scene = new PanelScene();
  const f0 = frame(0);
  scene.sync(f0, 1, { rect: { x: 100, y: 100, w: 400, h: 400 }, width: 1200, height: 800 });
  const centre = scene.project(keyOf(f0, 'a'), undefined, 1200, 800);
  assert.ok(centre && Math.abs(centre.x - 300) < 2 && Math.abs(centre.y - 300) < 2, `${centre?.x},${centre?.y}: the middle of the stage`);
  const f1 = frame(8);
  scene.sync(f1, 1, { rect: { x: 100, y: 100, w: 400, h: 400 }, width: 1200, height: 800 });
  const moved = scene.project(keyOf(f1, 'a'), undefined, 1200, 800);
  assert.ok(moved && moved.x > 300 + 40, 'moved right on screen');
  const local = scene.project(keyOf(f1, 'a'), [0, 1, 0], 1200, 800);
  assert.ok(local && local.y < moved.y, 'a point above the object is higher on screen');
  assert.equal(scene.project(9999, undefined, 1200, 800), undefined);
});

test('the model may reach past the stage: nothing is clipped to its rectangle', () => {
  const frame = settled({ op: 'add', shape: 'box', id: 'a', size: [3, 3, 3] }, { op: 'orbit', az: 0, el: 0, dur: 0 });
  const scene = new PanelScene();
  const small = { rect: { x: 200, y: 150, w: 80, h: 80 }, width: 1200, height: 800 };
  scene.sync(frame, 1, small);
  const bounds = scene.screenBounds(1200, 800);
  assert.ok(bounds, 'there is a model to bound');
  assert.ok(bounds.model.w > 0 && bounds.model.h > 0);
  const cx = bounds.model.x + bounds.model.w / 2;
  assert.ok(Math.abs(cx - 240) < 3, 'centred on the stage, which is not the middle of the window');
  const wide = settled({ op: 'add', shape: 'box', id: 'a', size: [9, 3, 3] }, { op: 'orbit', az: 0, el: 0, dur: 0 });
  const scene2 = new PanelScene();
  scene2.sync(wide, 1, small);
  const b2 = scene2.screenBounds(1200, 800);
  assert.ok(b2 && b2.drawn.w >= b2.model.w && b2.drawn.h >= b2.model.h, 'what is drawn includes the model');
});

test('whatever size and place a model is written at, it fits its stage and fills most of it', () => {
  const stage = { x: 300, y: 100, w: 420, h: 420 };
  const models: Array<[string, unknown[]]> = [
    ['tiny', [{ op: 'add', shape: 'box', id: 'a', size: [0.5, 0.5, 0.5] }]],
    ['ordinary', [{ op: 'add', shape: 'box', id: 'a', size: [6, 4, 5] }]],
    ['huge', [{ op: 'add', shape: 'box', id: 'a', size: [80, 50, 60] }]],
    ['long and thin', [{ op: 'add', shape: 'box', id: 'a', size: [40, 2, 2] }]],
    ['far from the origin', [{ op: 'add', shape: 'sphere', id: 'a', size: [5, 5, 5], pos: [60, -30, 10] }, { op: 'add', shape: 'sphere', id: 'b', size: [5, 5, 5], pos: [70, -20, 0] }]],
  ];
  for (const [name, actions] of models) {
    const frame = settled(...(actions as never[]), { op: 'orbit', az: 20, el: 10, dur: 0 });
    const scene = new PanelScene();
    scene.sync(frame, 1, { rect: stage, width: 1200, height: 800 });
    const b = scene.screenBounds(1200, 800)!.model;
    const slack = 4;
    assert.ok(b.x >= stage.x - slack && b.y >= stage.y - slack && b.x + b.w <= stage.x + stage.w + slack && b.y + b.h <= stage.y + stage.h + slack, `${name}: inside the stage (${JSON.stringify(b)})`);
    assert.ok(Math.max(b.w / stage.w, b.h / stage.h) > 0.6, `${name}: fills the stage (${Math.round(Math.max(b.w / stage.w, b.h / stage.h) * 100)}%)`);
  }
});

test('with no model there is nothing to bound', () => {
  const scene = new PanelScene();
  scene.sync(settled(), 1);
  assert.equal(scene.screenBounds(100, 100), undefined);
});

// ---- the screen annotations --------------------------------------------------------------------

function recorder() {
  const calls: string[] = [];
  const target = { canvas: {}, createLinearGradient: () => ({ addColorStop: () => {} }), measureText: (t: string) => ({ width: t.length * 8 }) } as Record<string, unknown>;
  const ctx = new Proxy(target, {
    get(t, key: string) {
      if (key in t) return t[key];
      return (...args: unknown[]) => { calls.push(`${key}(${args.map((a) => (typeof a === 'number' ? Math.round(a) : typeof a === 'string' ? a : '')).join(',')})`); };
    },
    set(t, key: string, v) { if (key === 'fillStyle' || key === 'font') calls.push(`${key}=${String(v)}`); t[key] = v; return true; },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

test('a pin is drawn at the part, with its text, and not at all when its part is out of sight', () => {
  const frame = settled({ op: 'add', shape: 'box', id: 'a', size: [1, 1, 1] }, { op: 'pin', id: 'p', on: 'a', text: 'Processor' });
  const view = { width: 1200, height: 800, dpr: 1 };
  const annot = (visible: boolean) => ({ view, project: () => ({ x: 300, y: 500, visible }) });
  const shown = recorder();
  drawMarks(shown.ctx, frame.marks, view, annot(true));
  assert.ok(shown.calls.some((c) => c.startsWith('fillText(Processor')), shown.calls.join(' '));
  assert.ok(shown.calls.some((c) => c.startsWith('arc(300,500')), 'the dot sits on the part');
  const hidden = recorder();
  drawMarks(hidden.ctx, frame.marks, view, annot(false));
  assert.ok(!hidden.calls.some((c) => c.startsWith('fillText')), 'behind the camera: nothing');
  const bare = recorder();
  drawMarks(bare.ctx, frame.marks, view);
  assert.ok(!bare.calls.some((c) => c.startsWith('fillText')), 'with no annotator pins are left out, not drawn in the wrong place');
});

test('a pin keeps its tag on the screen even when its part is at the edge', () => {
  const frame = settled({ op: 'add', shape: 'box', id: 'a', size: [1, 1, 1] }, { op: 'pin', id: 'p', on: 'a', text: 'Edge', off: [400, -400] });
  const view = { width: 1000, height: 600, dpr: 1 };
  const r = recorder();
  drawMarks(r.ctx, frame.marks, view, { view, project: () => ({ x: 980, y: 10, visible: true }) });
  const text = r.calls.find((c) => c.startsWith('fillText(Edge'));
  assert.ok(text, 'drawn');
  const [x, y] = text.slice('fillText(Edge,'.length, -1).split(',').map(Number);
  assert.ok((x ?? 0) >= 0 && (x ?? 0) < 1000 && (y ?? 0) >= 0 && (y ?? 0) < 600, `${x},${y}`);
});

test('a card shows its title and every row, in any layout', () => {
  const view = { width: 1600, height: 900, dpr: 1 };
  for (const layout of ['list', 'timeline', 'stat']) {
    {
      const frame = frameAt([step({ op: 'card', id: 'c', x: 100, y: 100, w: 400, title: 'A dynasty', rows: ['2013 | Debut', '2016 | More', '2023 | Back'], layout, to: [900, 500] })], 0, 99);
      const r = recorder();
      drawMarks(r.ctx, frame.marks, view, { view, project: () => undefined });
      const texts = r.calls.filter((c) => c.startsWith('fillText(')).join(' ');
      assert.ok(/A dynasty|A DYNASTY/.test(texts), `${layout}: the title`);
      assert.ok(/Debut|DEBUT/.test(texts) && /Back|BACK/.test(texts), `${layout}: the rows`);
    }
  }
});

test('an image card draws the chosen region of the screenshot, and nothing without one', () => {
  const frame = frameAt([step({ op: 'image', id: 'i', sx: 200, sy: 300, sw: 100, sh: 50, dx: 600, dy: 100, dw: 300, caption: 'Zoomed' })], 0, 99);
  const view = { width: 1000, height: 500, dpr: 1 };
  const withSource = recorder();
  drawMarks(withSource.ctx, frame.marks, view, { view, project: () => undefined, source: { image: {} as CanvasImageSource, width: 2000, height: 1000 } });
  const draw = withSource.calls.find((c) => c.startsWith('drawImage('));
  assert.ok(draw, 'drawn');
  assert.ok(draw.startsWith('drawImage(,400,300,200,50'), `the source rectangle is the region in image pixels: ${draw}`);
  assert.ok(withSource.calls.some((c) => c.startsWith('fillText(Zoomed')));
  const without = recorder();
  drawMarks(without.ctx, frame.marks, view, { view, project: () => undefined });
  assert.ok(!without.calls.some((c) => c.startsWith('drawImage(')));
});

// ---- fading and the app's own words ------------------------------------------------------------

test('a finished scene holds, then fades out, and the pointer on it starts the count again', () => {
  const fade = new AutoFade();
  assert.equal(fade.alpha(0), 1);
  assert.equal(fade.untilChange(0), undefined, 'nothing counting while a scene is running');
  fade.arm(1000);
  assert.equal(fade.alpha(1000 + HOLD_MS - 1), 1);
  assert.equal(fade.untilChange(1000), HOLD_MS);
  const half = fade.alpha(1000 + HOLD_MS + FADE_MS / 2);
  assert.ok(Math.abs(half - 0.5) < 1e-9);
  assert.equal(fade.untilChange(1000 + HOLD_MS + 10), 0, 'changing now');
  assert.equal(fade.alpha(1000 + HOLD_MS + FADE_MS), 0);
  assert.equal(fade.untilChange(1000 + HOLD_MS + FADE_MS + 5), undefined, 'all gone: nothing more to wake for');
  fade.touch(1000 + HOLD_MS + FADE_MS / 2);
  assert.equal(fade.alpha(1000 + HOLD_MS + FADE_MS / 2), 1, 'a scene already fading comes back under the pointer');
  fade.disarm();
  assert.equal(fade.armed, false);
  fade.touch(5);
  assert.equal(fade.armed, false, 'touching a scene that is not counting does not start a count');
  assert.equal(new AutoFade(500).alpha(499), 1);
  assert.ok(new AutoFade(500).alpha(2000) === 1, 'not armed, not fading');
  const short = new AutoFade(500);
  short.arm(0);
  assert.ok(short.alpha(1000) < 1, 'a shorter hold fades sooner');
});

test('follow-up pause preserves the old fade deadline and cancel can resume its remaining time', () => {
  const fade = new AutoFade(4000);
  fade.arm(1000);
  fade.pause(2500);
  assert.equal(fade.alpha(9000), 1, 'the explanation stays fully visible while recording/responding');
  assert.equal(fade.untilChange(9000), undefined, 'no fade timer runs while paused');
  fade.resume(9000);
  assert.equal(fade.untilChange(9000), 2500, 'resume keeps the original remaining hold');
  assert.equal(fade.alpha(9000 + 2500 + FADE_MS), 0, 'the original end time is retained');
  assert.equal(fade.alpha(9000 + 2500 + FADE_MS / 2), 0.5);
});

test('a faded frame dims marks, objects and the stage together, and a faded stage takes no clicks', async () => {
  const frame = settled({ op: 'add', shape: 'box', id: 'a', size: [1, 1, 1] }, { op: 'label', id: 'l', x: 1, y: 1, text: 'hi', color: 'red' });
  const half = fadeFrame(frame, 0.5);
  assert.equal(half.marks[0]?.fade, 0.5);
  assert.equal(half.objects[0]?.fade, 0.5);
  assert.equal(half.panel?.fade, 0.5);
  assert.equal(fadeFrame(frame, 1), frame, 'full strength leaves the frame alone');
  const { panelRect } = await import('../src/overlay/layout.ts');
  const view = { width: 1000, height: 600, dpr: 1 };
  assert.ok(panelRect(fadeFrame(frame, 0.5).panel, view), 'half faded still takes the pointer');
  assert.equal(panelRect(fadeFrame(frame, 0).panel, view), undefined, 'gone');
  assert.equal(fadeFrame(frame, 0).marks[0]?.fade, 0);
  assert.equal(frame.marks[0]?.fade, 1, 'the frame itself is not changed');
});

test('the thinking indicator, the offer and the notice come and go as they should', () => {
  const hud = new HudState();
  assert.deepEqual(hud.view(0), { status: 'idle', offer: null, notice: null });
  hud.setStatus('listening');
  assert.equal(hud.view(0).status, 'listening');
  hud.newTurn();
  assert.equal(hud.view(0).status, 'idle', 'a new question ends the listening cue');
  hud.setStatus('working');
  hud.newTurn();
  assert.equal(hud.view(0).status, 'working', 'but not the thinking indicator, which waits for the first step');
  hud.stopWorking();
  assert.equal(hud.view(0).status, 'idle');
  hud.setStatus('listening');
  hud.stopWorking();
  assert.equal(hud.view(0).status, 'listening', 'a step arriving does not end a listening cue');
  hud.setStatus('backend');
  hud.newTurn();
  assert.equal(hud.view(0).status, 'backend', 'the "with the backend" indicator waits for the first step too');
  hud.stopWorking();
  assert.equal(hud.view(0).status, 'idle');

  hud.offer('long research');
  assert.equal(hud.view(0).offer, 'long research');
  hud.newTurn();
  assert.equal(hud.view(0).offer, null, 'the offer stays until the next question');
  hud.offer('again');
  hud.dismissOffer();
  assert.equal(hud.view(0).offer, null);

  hud.showNotice('No speech server', 'info', 100);
  assert.equal(hud.view(100 + NOTICE_MS.info - 1).notice?.alpha, 1);
  const fading = hud.view(100 + NOTICE_MS.info + NOTICE_FADE_MS / 2).notice;
  assert.ok(fading && Math.abs(fading.alpha - 0.5) < 1e-9);
  assert.equal(hud.untilChange(100), NOTICE_MS.info);
  assert.equal(hud.view(100 + NOTICE_MS.info + NOTICE_FADE_MS).notice, null);
  assert.equal(hud.untilChange(100 + NOTICE_MS.info + NOTICE_FADE_MS + 1), undefined);
  hud.showNotice('Could not reach the model', 'error', 0);
  assert.ok(NOTICE_MS.error > NOTICE_MS.info && hud.view(NOTICE_MS.info + 100).notice, 'an error stays longer');
  hud.reset();
  assert.deepEqual(hud.view(0), { status: 'idle', offer: null, notice: null });
});

test('the cue follows a question: listening while held, thinking from release until the first step, then nothing', () => {
  const hud = new HudState();
  hud.setStatus('listening'); // chord held (a hush does not touch the cue)
  hud.setStatus('working'); // released, the question is on its way
  assert.equal(hud.view(0).status, 'working');
  hud.newTurn(); // begin of the turn arrives
  assert.equal(hud.view(0).status, 'working', 'still thinking until a step is on screen');
  hud.stopWorking(); // first step
  assert.equal(hud.view(0).status, 'idle');
  hud.stopWorking(); // end of turn
  assert.equal(hud.view(0).status, 'idle');
});

test('a part can carry other parts: the child follows its parent when the parent is moved', () => {
  const at = (px: number) => {
    const f = settled(
      { op: 'add', shape: 'box', id: 'plug', pos: [px, 0, 0], size: [2, 2, 2] },
      { op: 'add', shape: 'cylinder', id: 'pin', parent: 'plug', pos: [0, 2, 0], size: [1, 1, 1] },
    );
    const scene = new PanelScene();
    scene.sync(f, 1);
    const child = scene.nodeOf(keyOf(f, 'pin')) as Object3D;
    assert.ok(child.parent === scene.nodeOf(keyOf(f, 'plug')), 'a box holds a child like a group does'); // never assert.equal on three.js objects: a failing one prints the whole scene graph
    return child.getWorldPosition(new Vector3()).toArray();
  };
  assert.deepEqual(at(0), [0, 2, 0]);
  assert.deepEqual(at(3), [3, 2, 0]);
});

test('a tube is closed with a rounded cap at each free end that follows its taper, and a flat ribbon is left as cut', () => {
  const path = samplePath([[0, 0, 0], [0, 1, 0], [0, 2, 0], [0, 3, 0], [0, 4, 0]], false, 20);
  const round = tubeGeometry(path, 0.5, 1, 12, [[0, 1], [1, 0.4]]);
  round.computeBoundingBox();
  const box = round.boundingBox as Box3;
  assert.ok(Math.abs(box.max.y - (4 + 0.2)) < 0.01 && Math.abs(box.min.y + 0.5) < 0.01, `capped past both ends by the end radius: ${box.min.y}..${box.max.y}`);
  // The cap closes to a point on the axis: no vertex of the tip ring is off it.
  const p = round.attributes.position!;
  let tipOff = 0;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 4.1995) tipOff = Math.max(tipOff, Math.hypot(p.getX(i), p.getZ(i)));
  assert.ok(tipOff < 0.02, `the cap comes to a point (${tipOff})`);
  // Drawn on, the head is not capped until the tube is whole.
  const all = round.index!.count;
  drawFraction(round, 1);
  assert.equal(round.drawRange.count, all);
  drawFraction(round, 0.5);
  assert.ok(round.drawRange.count < all - (round.userData.endCap as number), 'a half-drawn tube has no end cap');
  drawFraction(round, 0);
  assert.equal(round.drawRange.count, 0);
  const ribbon = tubeGeometry(path, 0.5, 0.1, 12);
  ribbon.computeBoundingBox();
  assert.ok(Math.abs((ribbon.boundingBox as Box3).max.y - 4) < 0.01, 'a ribbon ends where its path does');
});
