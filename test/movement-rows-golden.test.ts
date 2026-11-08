import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { loopDriver, loopStart, poses } from '../src/overlay/motion.ts';
import type { Axis, CamDef, CrankDef, FlashDef, JointDef, LoopDef, LoopKind, Motion, PoseObject, SpinState } from '../src/overlay/motion.ts';
import type { AddAction, Vec3 } from '../src/scene/types.ts';

// The movement kinds (loops: slide, swing, gate, pulse, float; the crank; the cam; the flash) recorded from the code that had each as its own pass, before they
// became rows of a catalogue. For a spread of sizes, axes, amounts, dampings, pivots, rests and angles, the pose every moved object ends up in must be what it was
// (to the sixth decimal). To record again after a change that is meant (never to make a failure go away): MOVEMENT_ROWS_WRITE=1 node --test test/movement-rows-golden.test.ts

const FIXTURE = new URL('./fixtures/movement-rows-golden.json', import.meta.url);
const r = (n: number) => Math.round(n * 1e6) / 1e6 + 0;
const emptyMotion = (): Motion => ({ spins: [], cranks: [], cams: [], flashes: [], loops: [], joints: [], couples: [], muscles: [], waves: [] });

let next = 1;
const box = (pos: Vec3, rot: Vec3 = [0, 0, 0], size: Vec3 = [1, 1, 1], extra: Partial<PoseObject> = {}): PoseObject => ({ key: next++, parentKey: null, def: { op: 'add', shape: 'box', id: `o${next}`, size } as AddAction, pos, rot, opacity: 1, ...extra });
const part = (part: string, pos: Vec3, size: Vec3, n?: number): PoseObject => ({ key: next++, parentKey: null, def: { op: 'add', shape: 'part', part, id: `p${next}`, size, ...(n ? { n } : {}) } as AddAction, pos, rot: [0, 0, 0], opacity: 1 });
const spin = (key: number, angle: number, axis: Axis = 2, rate = 0): SpinState => ({ key, axis, angle, rate });

const ANGLES = [0, 37, 90, 135, 180, 270, 359, 725];
const out: Record<string, unknown> = {};
const record = (label: string, objects: PoseObject[], motion: Motion): void => {
  const got = poses(objects, motion);
  out[label] = [...got.entries()].sort((a, b) => a[0] - b[0]).map(([key, p]) => [key, p.pos?.map(r) ?? null, p.rot?.map(r) ?? null, p.opacity === undefined ? null : r(p.opacity), p.scale?.map(r) ?? null]);
};

// ---- loops -----------------------------------------------------------------------------------------------------------------------
const kinds: LoopKind[] = ['slide', 'swing', 'gate', 'pulse', 'float'];
for (const kind of kinds) {
  for (const axis of [0, 1, 2] as Axis[]) {
    for (const amount of kind === 'pulse' ? [0.5, 1.6] : kind === 'swing' || kind === 'gate' ? [25, -40] : [0.4, 3]) {
      for (const rest of [[0, 0, 0], [90, 0, 0], [10, 20, 30]] as Vec3[]) {
        for (const pivot of [[0, 0, 0], [1, -1, 0.5]] as Vec3[]) {
          for (const damp of [undefined, 1.5]) {
            for (const joint of [undefined, 'hinge', 'slide'] as const) {
              const o = box([1, 2, 0.5], rest);
              const loop: LoopDef = { key: o.key, kind, axis, amount, pivot, ...(damp !== undefined ? { damp, start: loopStart(kind) } : {}), ...(kind === 'float' ? { tilt: 4, start: loopStart(kind) } : {}) };
              const j: JointDef[] = joint ? [{ key: o.key, kind: joint, axis, dir: null, pivot, min: undefined, max: undefined, toKey: null, limit: null }] : [];
              for (const a of ANGLES) record(`${kind} axis${axis} amt${amount} rest${rest} pivot${pivot} damp${damp} ${joint ?? 'bare'} @${a}`, [o], { ...emptyMotion(), loops: [loop], joints: j, spins: [spin(loopDriver(o.key), a)] });
            }
          }
        }
      }
    }
  }
}
// a swing hung from another part, and limits that hold a value
{
  const holder = box([3, 4, 0]);
  const bob = box([3, 1, 0]);
  for (const a of ANGLES) record(`pendulum @${a}`, [holder, bob], { ...emptyMotion(), loops: [{ key: bob.key, kind: 'swing', axis: 2, amount: 25, pivot: [0, 0, 0], pivotKey: holder.key }], spins: [spin(loopDriver(bob.key), a)] });
  for (const a of ANGLES) record(`limited swing @${a}`, [bob], { ...emptyMotion(), loops: [{ key: bob.key, kind: 'swing', axis: 2, amount: 60, pivot: [0, 1, 0] }], joints: [{ key: bob.key, kind: 'hinge', axis: 2, dir: null, pivot: [0, 1, 0], min: -20, max: 30, toKey: null, limit: null }], spins: [spin(loopDriver(bob.key), a)] });
}

// ---- crank ------------------------------------------------------------------------------------------------------------------------
for (const shaftKind of ['kit', 'plain'] as const) {
  for (const n of [1, 3]) {
    for (const withRod of [true, false]) {
      for (const offset of [0, 0.6]) {
        for (const pin of [1, 2]) {
          if (shaftKind === 'plain' && n > 1) continue;
          const shaft = shaftKind === 'kit' ? part('crankshaft', [0, -2, 0], [4, 4, 2], n) : ({ key: next++, parentKey: null, def: { op: 'add', shape: 'cylinder', id: 'w', size: [4, 0.6, 4] } as AddAction, pos: [0, -2, 0], rot: [90, 0, 0], opacity: 1 } as PoseObject);
          const rod = withRod ? part('connecting-rod', [0, 0.5, 0], [0.8, 4, 0.5]) : undefined;
          const piston = part('piston', [offset, 3, 0], [2, 2, 2]);
          const pinObj = shaftKind === 'plain' ? ({ key: -1_000_000 - piston.key, parentKey: null, def: { op: 'add', shape: 'cylinder', id: 'pin', size: [0.3, 0.5, 0.3] } as AddAction, pos: [0, 0, 0], rot: [0, 0, 0], opacity: 1 } as PoseObject) : undefined;
          const crank: CrankDef = { key: piston.key, shaftKey: shaft.key, rodKey: rod ? rod.key : null, pin };
          for (const a of ANGLES) record(`crank ${shaftKind} n${n} rod${withRod} off${offset} pin${pin} @${a}`, [shaft, ...(rod ? [rod] : []), piston, ...(pinObj ? [pinObj] : [])], { ...emptyMotion(), cranks: [crank], spins: [spin(shaft.key, a)] });
        }
      }
    }
  }
}
// a crank that names a cylinder block is left still
{
  const block = part('cylinder-block', [0, 0, 0], [3, 4, 3]);
  const shaft = part('crankshaft', [0, -2, 0], [4, 4, 2]);
  const piston = { ...part('piston', [0, 3, 0], [2, 2, 2]), parentKey: block.key };
  record('crank held', [block, shaft, piston], { ...emptyMotion(), cranks: [{ key: piston.key, shaftKey: shaft.key, rodKey: null, pin: 1 }], spins: [spin(shaft.key, 40)] });
}

// ---- cam and flash ----------------------------------------------------------------------------------------------------------------
for (const lift of [undefined, 0.8]) {
  for (const open of [60, 110, 200]) {
    for (const phase of [0, 180, -90]) {
      const cam = part('camshaft', [0, 4, 0], [3, 1, 1]);
      const valve = part('valve', [0, 2, 0], [0.5, 3, 0.5]);
      const def: CamDef = { key: valve.key, byKey: cam.key, lift, open, phase };
      for (let a = -360; a <= 720; a += 45) record(`cam lift${lift} open${open} phase${phase} @${a}`, [cam, valve], { ...emptyMotion(), cams: [def], spins: [spin(cam.key, a)] });
    }
  }
}
for (const cycle of [720, 360]) {
  for (const [angle, span] of [[0, 90], [180, 60], [90, 200]]) {
    const wheel = part('crankshaft', [0, 0, 0], [4, 4, 2]);
    const lamp = box([2, 2, 0]);
    const def: FlashDef = { key: lamp.key, byKey: wheel.key, angle: angle!, span: span!, cycle };
    for (let a = -90; a <= 1440; a += 30) record(`flash cycle${cycle} angle${angle} span${span} @${a}`, [wheel, lamp], { ...emptyMotion(), flashes: [def], spins: [spin(wheel.key, a)] });
  }
}

test('every movement kind poses exactly as it was recorded, kind by kind', () => {
  if (process.env.MOVEMENT_ROWS_WRITE) { writeFileSync(FIXTURE, JSON.stringify(out) + '\n'); return; }
  const golden = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
  assert.deepEqual(Object.keys(out), Object.keys(golden), 'the same cases');
  const bad = Object.keys(out).filter((k) => JSON.stringify(out[k]) !== JSON.stringify(golden[k]));
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} of ${Object.keys(out).length} cases differ`);
});

test('the recording reaches every kind and every kind moves something', () => {
  const keys = Object.keys(out);
  for (const k of ['slide', 'swing', 'gate', 'pulse', 'float', 'crank', 'cam', 'flash', 'pendulum']) assert.ok(keys.some((c) => c.startsWith(k)), k);
  const moved = (prefix: string) => keys.filter((c) => c.startsWith(prefix)).some((c) => (out[c] as unknown[]).length > 0);
  for (const k of ['slide', 'swing', 'gate', 'pulse', 'float', 'crank', 'cam', 'flash', 'pendulum']) assert.ok(moved(k), `${k} moves something`);
});
