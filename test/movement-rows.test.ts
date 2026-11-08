import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAM_ROW, CRANK_ROW, DEFAULT_AMOUNT, FLASH_ROW, LOOP_ROWS, bind, fresh, loopRow, num } from '../src/scene/movement-rows.ts';
import type { LoopRow } from '../src/scene/movement-rows.ts';
import { loopDriver, loopStart, poses } from '../src/overlay/motion.ts';
import type { LoopDef, Motion, PoseObject } from '../src/overlay/motion.ts';
import { VARIANTS } from '../src/scene/spec.ts';
import type { AddAction } from '../src/scene/types.ts';

// The movement kinds are rows of a catalogue (src/scene/movement-rows.ts) over a few general motions in motion.ts. What every kind poses is held by
// movement-rows-golden.test.ts; this is the facts the rest of the program reads from the rows, the paths, and that a movement can be added as a row alone.

const empty = (): Motion => ({ spins: [], cranks: [], cams: [], flashes: [], loops: [], joints: [], couples: [], muscles: [], waves: [] });
const box = (key: number, pos: [number, number, number]): PoseObject => ({ key, parentKey: null, def: { op: 'add', shape: 'box', id: `b${key}`, size: [1, 1, 1] } as AddAction, pos, rot: [0, 0, 0], opacity: 1 });

test('the catalogue holds exactly the loop kinds the scene language names, with the facts that were spread over three files', () => {
  const loop = VARIANTS.find((v) => v.name === 'loop')!;
  const named = (loop.fields.kind as unknown as { values: string[] }).values.filter((k) => k !== 'stop');
  assert.deepEqual(Object.keys(LOOP_ROWS).sort(), [...named].sort());
  assert.deepEqual(Object.fromEntries(Object.entries(LOOP_ROWS).map(([k, r]) => [k, [r.axis, r.start, ...r.amount]])), {
    slide: [1, 270, 0.01, 100], swing: [2, 270, -180, 180], gate: [2, 270, -170, 170], pulse: [1, 180, 0.1, 5], float: [1, 270, 0.01, 100],
    step: [2, 0, -360, 360], ratchet: [2, 270, -360, 360], geneva: [2, 180, 20, 120],
  });
  assert.deepEqual(DEFAULT_AMOUNT, [0.1, 5], 'a stopped loop keeps the old range');
  assert.equal(loopStart('pulse'), 180);
  assert.equal(loopStart('swing'), 270);
  assert.equal(loopRow('toString'), undefined, 'a name that is not a kind is no row');
  assert.equal(loopRow('stop'), undefined);
});

test('the general motions: a swing turns, a slide travels half its amount each side, a pulse swells, a float bobs and rocks, a gate opens on one half', () => {
  const at = (kind: LoopDef['kind'], amount: number, a: number, extra: Partial<LoopDef> = {}) => {
    const o = box(1, [1, 2, 0]);
    const loop: LoopDef = { key: 1, kind, axis: kind === 'swing' || kind === 'gate' ? 2 : 1, amount, pivot: [0, 0, 0], ...extra };
    return poses([o], { ...empty(), loops: [loop], spins: [{ key: loopDriver(1), axis: 2, angle: a, rate: 0 }] }).get(1)!;
  };
  assert.ok(Math.abs(at('swing', 30, 0).rot![2]! - 30) < 1e-9, 'at the far end of the cycle');
  assert.ok(Math.abs(at('swing', 30, 90).rot![2]!) < 1e-9);
  assert.ok(Math.abs(at('slide', 4, 0).pos![1]! - (2 + 2)) < 1e-9);
  assert.ok(Math.abs(at('slide', 4, 180).pos![1]! - (2 - 2)) < 1e-9);
  assert.ok(Math.abs(at('pulse', 2, 0).scale![0]! - 2) < 1e-9);
  assert.ok(Math.abs(at('pulse', 2, 180).scale![0]! - 1) < 1e-9);
  assert.ok(at('gate', 70, 0).rot![2]! === 70 && (at('gate', 70, 180).rot?.[2] ?? 0) === 0, 'open on the first half, shut on the second');
  const f = at('float', 0.5, 0, { tilt: 6, start: 0 });
  assert.equal(f.pos![1], 2, 'a float that has just begun has not moved yet (it eases in)');
  const g = at('float', 0.5, 450, { tilt: 6, start: 0 });
  assert.ok(Math.abs(g.pos![1]! - 2) < 1e-9 && Math.abs(g.rot![2]! - 6) < 1e-9, 'a quarter turn on (past the ease): level, rocked all the way');
});

test('a crank follows a circle with a rod of fixed length; a cam lifts by a bump; a flash rises fast and falls slowly', () => {
  const base = { shaftX: 0, shaftY: 0, shaftZ: 0, pistonX: 0, pistonZ: 0, throws: 1, pin: 1, r: 1, big: 0, length: 4, drop: 0, plain: false, thick: 1, rodD: 1, pinH: 1, rodZ: 0 };
  const piston = (turn: number) => num(CRANK_ROW.piston[1], bind(fresh({ ...base, turn }), CRANK_ROW.lets));
  assert.ok(Math.abs(piston(0) - 5) < 1e-9, 'the pin at the top: the piston is a throw and a rod above the shaft');
  assert.ok(Math.abs(piston(180) - 3) < 1e-9, 'at the bottom');
  assert.ok(piston(90) < 5 && piston(90) > 3);
  const cam = (turn: number) => num(CAM_ROW.y, bind(fresh({ turn, phase: 180, open: 100, liftSet: true, liftOpt: 0.8, valveH: 3, posY: 2 }), CAM_ROW.lets));
  assert.ok(Math.abs(cam(180) - (2 - 0.8)) < 1e-9, 'the nose at the valve: lifted all the way');
  assert.equal(cam(0), 2, 'away from it: not lifted');
  const flash = (turn: number) => num(FLASH_ROW.opacity, bind(fresh({ turn, angle: 0, span: 100, cycle: 720, opacity: 1 }), FLASH_ROW.lets));
  assert.ok(flash(10) === 1 && flash(5) === 0.5 && flash(400) === 0, 'the rise takes a tenth of the span');
  assert.ok(flash(30) < 1 && flash(30) > flash(80));
});

test('a new movement is a row: nothing else is written to pose it, give it its range or its start', () => {
  const table = LOOP_ROWS as Record<string, LoopRow>;
  table.wobble = { motion: 'turn', axis: 0, start: 90, amount: [-45, 45], value: 'sin(a)*amount*fade' };
  try {
    const o = box(7, [0, 0, 0]);
    const loop = { key: 7, kind: 'wobble', axis: 0, amount: 20, pivot: [0, 0, 0] } as unknown as LoopDef;
    const turned = (a: number) => poses([o], { ...empty(), loops: [loop], spins: [{ key: loopDriver(7), axis: 2, angle: a, rate: 0 }] }).get(7)!.rot![0]!;
    assert.ok(Math.abs(turned(90) - 20) < 1e-9);
    assert.ok(Math.abs(turned(270) + 20) < 1e-9);
    assert.equal(loopStart('wobble' as never), 90);
    assert.deepEqual(loopRow('wobble')!.amount, [-45, 45]);
  } finally {
    delete table.wobble;
  }
});
