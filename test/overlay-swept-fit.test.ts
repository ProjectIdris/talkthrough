import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, Vector3 } from 'three';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import { validateScene } from '../src/scene/index.ts';
import type { Frame } from '../src/overlay/timeline.ts';

// The camera fits the stage to what the model does, not only to how it stands at rest: a model that swings out of its rest shape stays inside the screen the
// whole time (a wing built toward the viewer and flapped off the top and the foot of the screen, 4.4 times as tall as its stage).

const ASPECT = 883 / 322; // the stage the wing answer was given on a 21:9 screen
const steps = (...stepActions: unknown[][]) => {
  const checked = validateScene({ v: 1, steps: stepActions.map((actions, i) => ({ say: `Step ${i}.`, actions })) });
  assert.deepEqual(checked.issues, []);
  assert.ok(checked.scene);
  return checked.scene.steps;
};
const tube = (id: string, parent: string, length: number) => ({ op: 'add', shape: 'tube', id, parent, pts: [[0, 0, 0], [0, 0, length]], radius: 0.18, at: 0 });
const wing = [
  { op: 'panel', x: 520, y: 120, w: 460, h: 400 },
  { op: 'orbit', az: 0, el: 0, dur: 0 },
  { op: 'add', shape: 'box', id: 'torso', size: [3, 1.2, 1.2], at: 0 },
  { op: 'add', shape: 'group', id: 'upper', parent: 'torso', pos: [0, 0, 1.2], at: 0 },
  tube('humerus', 'upper', 2),
  { op: 'add', shape: 'group', id: 'fore', parent: 'upper', pos: [0, 0, 2], at: 0 },
  tube('ulna', 'fore', 2),
  { op: 'add', shape: 'group', id: 'hand', parent: 'fore', pos: [0, 0, 2], at: 0 },
  tube('carpus', 'hand', 1.8),
];
const flap = [
  ...['upper', 'fore', 'hand'].map((id) => ({ op: 'joint', id, kind: 'hinge', axis: 'x', pivot: [0, 0, 0], min: -40, max: 40, at: 0 })),
  { op: 'loop', id: 'upper', kind: 'swing', amount: 30, axis: 'x', period: 1.6, at: 0 },
  { op: 'loop', id: 'fore', kind: 'swing', amount: 25, axis: 'x', period: 1.6, phase: 30, at: 0 },
  { op: 'loop', id: 'hand', kind: 'swing', amount: 30, axis: 'x', period: 1.6, phase: 60, at: 0 },
];

/** How far the model's vertices reach on the stage, as a share of the stage's half height and half width (1 is the stage's edge). */
function reach(scene: PanelScene, frame: Frame): { x: number; y: number } {
  const out = { x: 0, y: 0 };
  const p = new Vector3();
  for (const o of frame.objects) {
    scene.nodeOf(o.key)?.traverse((m) => {
      if (!(m instanceof Mesh) || !m.visible) return;
      const a = m.geometry.getAttribute('position');
      for (let i = 0; i < a.count; i++) {
        p.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld).project(scene.camera);
        out.x = Math.max(out.x, Math.abs(p.x));
        out.y = Math.max(out.y, Math.abs(p.y));
      }
    });
  }
  return out;
}

/** Plays a scene's last step for a few seconds, frame by frame as the page does, and gives each frame's reach and the camera's distance. */
function play(all: ReturnType<typeof steps>, from: number, to: number, every: number): Array<{ t: number; x: number; y: number; distance: number }> {
  const scene = new PanelScene({ tier: 'mid' });
  try {
    const rows = [];
    for (let t = from; t <= to + 1e-9; t += every) {
      const f = frameAt(all, all.length - 1, t);
      scene.sync(f, ASPECT);
      rows.push({ t, ...reach(scene, f), distance: scene.camera.position.length() });
    }
    return rows;
  } finally { scene.destroy(); }
}

test('a model that swings out of its rest shape stays inside the screen the whole time it swings', () => {
  const rows = play(steps(wing, flap), 0.2, 4, 0.1);
  const worst = rows.reduce((a, b) => (Math.max(b.x, b.y) > Math.max(a.x, a.y) ? b : a));
  assert.ok(Math.max(worst.x, worst.y) <= 1.001, `at ${worst.t.toFixed(1)} s the model reaches ${worst.x.toFixed(2)} of the stage's half width and ${worst.y.toFixed(2)} of its half height`);
  // The camera does not move over the cycle (no breathing), and the model still fills what it can of the stage.
  const distances = rows.map((r) => r.distance);
  assert.ok(Math.max(...distances) - Math.min(...distances) < 0.01 * Math.max(...distances), 'the camera stands still while the model swings');
  assert.ok(Math.max(...rows.map((r) => Math.max(r.x, r.y))) > 0.8, 'and the swing, at its widest, fills most of the stage');
});

test('a model that only turns inside its own shape is fitted exactly as a still one is', () => {
  const wheel = [
    { op: 'panel', x: 520, y: 120, w: 460, h: 400 }, { op: 'orbit', az: 0, el: 0, dur: 0 },
    { op: 'add', shape: 'cylinder', id: 'wheel', size: [4, 0.6, 4], rot: [90, 0, 0], at: 0 },
  ];
  const still = play(steps(wheel), 1, 1, 1)[0]!;
  const turning = play(steps(wheel, [{ op: 'spin', id: 'wheel', rpm: 30, at: 0 }]), 0.5, 3, 0.25);
  for (const r of turning) assert.ok(Math.abs(r.distance - still.distance) < 0.01 * still.distance, `at ${r.t} s the camera stands ${r.distance.toFixed(2)}, a still wheel's ${still.distance.toFixed(2)}`);
});

test('a still model is fitted as it always was', () => {
  const rows = play(steps(wing), 1, 1, 1);
  assert.ok(Math.max(rows[0]!.x, rows[0]!.y) > 0.6 && Math.max(rows[0]!.x, rows[0]!.y) <= 1.001, `the still wing reaches ${rows[0]!.x.toFixed(2)} by ${rows[0]!.y.toFixed(2)} of the stage`);
});

// ---- a swing may pass over the stage's rectangle, never off the screen --------------------------------------------------------------------------------

const WINDOW = { width: 1920, height: 804 };
const STAGE = { x: 998, y: 96, w: 883, h: 322 }; // where the placer put the wing's stage on a 21:9 screen

/** Plays a scene with the stage placed in a window, and gives each frame's reach of the screen and of the stage, in the window's pixels. */
function playOnScreen(all: ReturnType<typeof steps>, from: number, to: number, every: number): Array<{ t: number; screen: number; stage: number }> {
  const scene = new PanelScene({ tier: 'mid' });
  try {
    const rows = [];
    for (let t = from; t <= to + 1e-9; t += every) {
      const f = frameAt(all, all.length - 1, t);
      scene.sync(f, STAGE.w / STAGE.h, { rect: STAGE, ...WINDOW });
      let screen = 0, stage = 0;
      const p = new Vector3();
      for (const o of f.objects) {
        scene.nodeOf(o.key)?.traverse((m) => {
          if (!(m instanceof Mesh) || !m.visible) return;
          const a = m.geometry.getAttribute('position');
          for (let i = 0; i < a.count; i++) {
            p.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld).project(scene.camera);
            const x = ((p.x + 1) / 2) * WINDOW.width, y = ((1 - p.y) / 2) * WINDOW.height;
            screen = Math.max(screen, Math.abs(p.x), Math.abs(p.y));
            stage = Math.max(stage, Math.abs(x - (STAGE.x + STAGE.w / 2)) / (STAGE.w / 2), Math.abs(y - (STAGE.y + STAGE.h / 2)) / (STAGE.h / 2));
          }
        });
      }
      rows.push({ t, screen, stage });
    }
    return rows;
  } finally { scene.destroy(); }
}

test('a swing may pass over its stage but stays on the screen, and the model is no smaller for it than it has to be', () => {
  const rows = playOnScreen(steps(wing, flap), 0.2, 4, 0.1);
  const worstScreen = Math.max(...rows.map((r) => r.screen));
  assert.ok(worstScreen <= 1.001, `the swing reaches ${worstScreen.toFixed(3)} of the screen's half size (1 is its edge)`);
  const worstStage = Math.max(...rows.map((r) => r.stage));
  assert.ok(worstStage > 1.2, `and it does pass over the stage's rectangle (${worstStage.toFixed(2)} of the stage's half size), since it is allowed to`);
  assert.ok(worstScreen > 0.85, `reaching the screen's edge is what the camera fits it to (${worstScreen.toFixed(2)})`);
});

test('a machine that starts later in the same step is fitted from the start: the camera does not move when it starts', () => {
  const late = flap.map((a) => (a.op === 'loop' ? { ...a, at: 3 } : a));
  const rows = play(steps(wing, late), 0.5, 5, 0.25);
  const before = rows.filter((r) => r.t < 2.9).map((r) => r.distance), after = rows.filter((r) => r.t > 3.3).map((r) => r.distance);
  assert.ok(before.length > 3 && after.length > 3);
  const d = after[0]!;
  for (const x of [...before, ...after]) assert.ok(Math.abs(x - d) < 0.01 * d, `the camera stood ${x.toFixed(2)} before and ${d.toFixed(2)} after the swing began`);
});
