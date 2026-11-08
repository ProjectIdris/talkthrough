import assert from 'node:assert/strict';
import test from 'node:test';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { createSceneState, validateStep } from '../src/scene/index.ts';
import { assemblyHint, assembliesNamed, assemblyNames, maxAssemblyId } from '../src/scene/assembly.ts';
import { partNames } from '../src/scene/part-library.ts';
import { emptyFrame, evaluate, planStep } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';
import { questionText } from '../src/adapters/subscription-shared.ts';
import type { ModelRequest } from '../src/adapters/model.ts';

// The assemblies: a working mechanism asked for with `add part`, expanded into pieces that mesh, attach and move with the right ratios and directions. Each test reads
// the evaluated poses of the whole thing (the same poses the renderer draws), never the rows' own numbers, so a wrong number anywhere is seen.

type Raw = Record<string, unknown>;
const SIZES: Record<string, number[]> = {
  'gear-train': [14, 7, 4], 'rack-and-pinion': [12, 5, 2], 'crank-slider': [4.3, 8.3, 3.8], 'cam-follower': [3, 8, 6], lever: [12, 5, 2.4], differential: [12, 8.7, 13],
  planetary: [10, 10, 2], 'four-bar-linkage': [10, 6, 2], 'bicycle-drivetrain': [18, 14, 6], 'block-and-tackle': [7, 12, 2],
  geneva: [10, 6, 2], escapement: [8, 12, 2], ratchet: [9, 9, 2], 'spring-snap': [10, 5, 6],
};

function build(part: string, size: number[], extra: Raw = {}) {
  const r = validateStep({ say: 'x', actions: [{ op: 'add', shape: 'part', id: 'a', part, size, ...extra }] }, createSceneState());
  return { step: r.step, issues: r.issues, plan: r.step ? planStep(emptyFrame(), r.step) : undefined };
}
const built = (part: string, size: number[] = SIZES[part]!, extra: Raw = {}) => {
  const b = build(part, size, extra);
  assert.ok(b.step && b.plan, JSON.stringify(b.issues));
  const step = b.step, actions = step.actions as Raw[], parents: Record<string, string> = {};
  for (const a of actions) if (a.op === 'add' && typeof a.parent === 'string') parents[a.id as string] = a.parent;
  return { plan: b.plan, step, parents, add: (id: string) => actions.find((a) => a.id === id && a.op === 'add')! };
};
type World = (id: string) => Matrix4;
function world(f: Frame, parents: Record<string, string>): World {
  const cache = new Map<string, Matrix4>();
  const get = (id: string): Matrix4 => {
    const hit = cache.get(id);
    if (hit) return hit;
    const o = f.objects.find((q) => q.id === id)!;
    const pose = (o as unknown as { pose?: { pos?: number[]; rot?: number[] } }).pose;
    const pos = pose?.pos ?? (o as unknown as { pos: number[] }).pos ?? [0, 0, 0];
    const rot = pose?.rot ?? (o as unknown as { rot: number[] }).rot ?? [0, 0, 0];
    const m = new Matrix4().compose(new Vector3(...pos), new Quaternion().setFromEuler(new Euler(rot[0]! * Math.PI / 180, rot[1]! * Math.PI / 180, rot[2]! * Math.PI / 180, 'XYZ')), new Vector3(1, 1, 1));
    const par = parents[id];
    const w = par ? get(par).clone().multiply(m) : m;
    cache.set(id, w);
    return w;
  };
  return get;
}
const worldAt = (b: ReturnType<typeof built>, t: number) => world(evaluate(b.plan, t), b.parents);
/** The angular velocity (radians a second) of a part in the world, by a small step. */
function omega(b: ReturnType<typeof built>, id: string, t: number, dt = 1e-3): Vector3 {
  const A = new Matrix4().extractRotation(worldAt(b, t)(id));
  const B = new Matrix4().extractRotation(worldAt(b, t + dt)(id));
  const q = new Quaternion().setFromRotationMatrix(B.multiply(A.clone().transpose()));
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  const ang = 2 * Math.acos(Math.min(1, q.w)), s = Math.sqrt(1 - q.w * q.w);
  return s < 1e-9 ? new Vector3() : new Vector3(q.x / s, q.y / s, q.z / s).multiplyScalar(ang / dt);
}
const near = (a: number, b: number, eps: number, what = '') => assert.ok(Math.abs(a - b) <= eps, `${what} ${a} vs ${b}`);
const centre = (m: Matrix4) => new Vector3().setFromMatrixPosition(m);
/** The turn from angle b to angle a in degrees, taken as the short way round (-180 to 180), so a wheel's angle passing the wrap is not a jump. */
const dAng = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;
const zAngle = (m: Matrix4) => new Euler().setFromRotationMatrix(new Matrix4().extractRotation(m), 'XYZ').z * 180 / Math.PI;

// --- the outline of a kit gear and how deep two outlines go into each other (the same tooth shape the kit draws) ---
type P2 = [number, number];
const gearPoly = (n: number, rOut: number, cx: number, cy: number, rotDeg: number): P2[] => {
  const rRoot = rOut * (n > 40 ? 0.93 : 0.86), pitch = (Math.PI * 2) / n, pts: P2[] = [];
  for (let i = 0; i < n; i++) {
    for (const [da, r] of [[-0.31, rRoot], [-0.15, rOut], [0.15, rOut], [0.31, rRoot]] as const) {
      const a = i * pitch + da * pitch + (rotDeg * Math.PI) / 180;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return pts;
};
/** The inside teeth of the ring: wedges from the outer wall in towards the planets. */
function ringTeeth(n: number, rv: number): P2[][] {
  const pitch = (Math.PI * 2) / n, rti = rv * 0.93, out: P2[][] = [];
  for (let i = 0; i < n; i++) {
    const P = (da: number, r: number): P2 => [Math.cos(i * pitch + da * pitch) * r, Math.sin(i * pitch + da * pitch) * r];
    out.push([P(-0.25, rv * 1.02), P(-0.17, rti), P(0.17, rti), P(0.25, rv * 1.02)]);
  }
  return out;
}
const rackPoly = (n: number, sx: number, sy: number, cx: number, cy: number): P2[] => {
  const p = sx / n, yb = -sy / 2 + sy * 0.55, yt = sy / 2, pts: P2[] = [[-sx / 2, -sy / 2], [sx / 2, -sy / 2], [sx / 2, yb]];
  for (let i = 0; i < n; i++) {
    const xc = sx / 2 - p * (i + 0.5);
    pts.push([xc + 0.5 * p, yb], [xc + 0.2 * p, yt], [xc - 0.2 * p, yt], [xc - 0.5 * p, yb]);
  }
  pts.push([-sx / 2, yb]);
  return pts.map(([x, y]) => [x + cx, y + cy] as P2);
};
function inside(pt: P2, poly: P2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function distToEdge(pt: P2, poly: P2[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j]!, [bx, by] = poly[i]!;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((pt[0] - ax) * dx + (pt[1] - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(pt[0] - (ax + t * dx), pt[1] - (ay + t * dy)));
  }
  return best;
}
const dense = (poly: P2[], k = 6): P2[] => poly.flatMap((a, i) => { const b = poly[(i + 1) % poly.length]!; return Array.from({ length: k }, (_, s): P2 => [a[0] + ((b[0] - a[0]) * s) / k, a[1] + ((b[1] - a[1]) * s) / k]); });
function penetration(A: P2[], B: P2[]): number {
  let d = 0;
  for (const pt of dense(A)) if (inside(pt, B)) d = Math.max(d, distToEdge(pt, B));
  for (const pt of dense(B)) if (inside(pt, A)) d = Math.max(d, distToEdge(pt, A));
  return d;
}
const TIMES = Array.from({ length: 24 }, (_, i) => 0.05 + i * 0.37);

test('every assembly is a part name the validator takes: it validates clean at its own size and at others, within the action budget, with the pieces under the one id', () => {
  assert.deepEqual(assemblyNames().sort(), Object.keys(SIZES).sort());
  for (const name of assemblyNames()) {
    for (const size of [SIZES[name]!, SIZES[name]!.map((v) => v * 0.5), SIZES[name]!.map((v) => v * 2), [SIZES[name]![0]! * 2, SIZES[name]![1]!, SIZES[name]![2]! * 0.7]]) {
      const b = build(name, size);
      assert.ok(b.step, `${name} ${size}`);
      assert.deepEqual(b.issues.map((i) => `${i.kind} ${i.path} ${i.message}`), [], `${name} ${size}`);
      const actions = b.step.actions as Raw[];
      assert.ok(actions.length <= 240, `${name} makes ${actions.length} actions`);
      assert.equal(actions[0]!.shape, 'group');
      assert.equal(actions[0]!.id, 'a');
      for (const a of actions) if (a.op === 'add' && a.id !== 'a') assert.ok(String(a.id).startsWith('a-'), String(a.id));
      assert.ok(b.plan);
      for (const t of [0, 1.3, 7]) for (const o of evaluate(b.plan, t).objects) {
        const pose = (o as unknown as { pose?: { pos?: number[]; rot?: number[] } }).pose;
        for (const v of [...(pose?.pos ?? []), ...(pose?.rot ?? [])]) assert.ok(Number.isFinite(v), `${name} ${o.id} at ${t}`);
      }
    }
  }
});

test('assembly names are written and resolved, but are not in the guide\'s part list (the guide is full; a question that names one is told by a hint)', () => {
  for (const name of assemblyNames()) assert.ok(!partNames().includes(name), name);
  assert.ok(build('Differential', SIZES.differential!).step, 'a slip of case still resolves');
});

test('an id too long for the longest piece key is refused whole; a count outside the row is held to it with a note', () => {
  const long = build('differential', SIZES.differential!, { id: 'x'.repeat(maxAssemblyId('differential') + 2) });
  assert.equal(long.step?.actions.length ?? 0, 0);
  assert.ok(long.issues.length > 0);
  const ok = build('differential', SIZES.differential!, { id: 'x'.repeat(maxAssemblyId('differential')) });
  assert.ok(ok.step && ok.issues.length === 0, JSON.stringify(ok.issues));
  const many = build('planetary', SIZES.planetary!, { n: 9 });
  assert.ok(many.step);
  assert.equal((many.step.actions as Raw[]).filter((a) => a.op === 'add' && /^a-planet\d$/.test(String(a.id))).length, 4);
  assert.ok(many.issues.some((i) => /held to 4/.test(i.message)), JSON.stringify(many.issues));
});

test('gear train: each large gear turns a third as fast as the small one before it and the other way round, and every gear that meets another is in mesh at every time', () => {
  for (const n of [1, 2, 3, 4]) {
    const b = built('gear-train', [14, 7, 4], { n });
    const w0 = omega(b, 'a-pinion0', 0.5).z;
    for (let s = 1; s <= n; s++) near(omega(b, `a-gear${s}`, 0.5).z / w0, Math.pow(-1 / 3, s), 1e-3, `stage ${s} of ${n}`);
    // every pair of gears in one plane and near enough to touch is a pair that meshes
    const gears = (b.step.actions as Raw[]).filter((a) => a.op === 'add' && a.part === 'gear');
    let pairs = 0, worst = 0;
    for (const t of TIMES) {
      const W = worldAt(b, t);
      for (let i = 0; i < gears.length; i++) for (let j = i + 1; j < gears.length; j++) {
        const A = gears[i]!, B = gears[j]!, ma = W(A.id as string), mb = W(B.id as string);
        const ra = (A.size as number[])[0]! / 2, rb = (B.size as number[])[0]! / 2, th = Math.max((A.size as number[])[2]!, (B.size as number[])[2]!);
        const ca = centre(ma), cb = centre(mb);
        if (Math.abs(ca.z - cb.z) > th * 0.5 || Math.hypot(ca.x - cb.x, ca.y - cb.y) > (ra + rb) * 1.08) continue;
        if (t === TIMES[0]) pairs++;
        worst = Math.max(worst, penetration(gearPoly(A.n as number, ra, ca.x, ca.y, zAngle(ma)), gearPoly(B.n as number, rb, cb.x, cb.y, zAngle(mb))) / Math.min(ra, rb));
      }
    }
    assert.equal(pairs, n, `${n} stages mesh in ${n} places`);
    assert.ok(worst < 0.02, `stage count ${n}: teeth go ${worst} of a radius into each other`);
  }
});

test('rack and pinion: the rack goes the length of the pinion\'s pitch circle that rolls, and the teeth are in mesh at every time', () => {
  for (const n of [8, 12, 20]) {
    const b = built('rack-and-pinion', [12, 5, 2], { n });
    const rack = b.add('a-rack'), pin = b.add('a-pinion');
    const R = (pin.size as number[])[0]! / 2;
    let worst = 0;
    for (const t of TIMES) {
      const W = worldAt(b, t), mr = W('a-rack'), mp = W('a-pinion');
      worst = Math.max(worst, penetration(gearPoly(n, R, centre(mp).x, centre(mp).y, zAngle(mp)), rackPoly(rack.n as number, (rack.size as number[])[0]!, (rack.size as number[])[1]!, centre(mr).x, centre(mr).y)) / R);
    }
    assert.ok(worst < 0.02, `n ${n}: ${worst}`);
    const x0 = centre(worldAt(b, 1)('a-rack')).x, x1 = centre(worldAt(b, 1.05)('a-rack')).x;
    const a0 = zAngle(worldAt(b, 1)('a-pinion')), a1 = zAngle(worldAt(b, 1.05)('a-pinion'));
    near((x1 - x0) / (((a1 - a0) * Math.PI) / 180), 0.93 * R, 0.02 * R, `n ${n}: travel for each radian`);
  }
});

test('planetary gear set: the carrier turns at 12/48 of the sun, each planet at -1/2 of it, the ring is still, and no planet goes into the sun or the ring teeth', () => {
  for (const n of [2, 3, 4]) {
    const b = built('planetary', [10, 10, 2], { n });
    const ws = omega(b, 'a-sun', 0.5).z;
    near(omega(b, 'a-carrier', 0.5).z / ws, 0.25, 1e-3, 'carrier');
    for (let i = 0; i < n; i++) near(omega(b, `a-planet${i}`, 0.5).z / ws, -0.5, 1e-3, `planet ${i}`);
    near(omega(b, 'a-ring', 0.5).length(), 0, 1e-6, 'ring');
    const ring = b.add('a-ring'), sunAdd = b.add('a-sun');
    const rs = (sunAdd.size as number[])[0]! / 2, rv = (ring.size as number[])[0]! / 2 / 1.1, teeth = ringTeeth(ring.n as number, rv);
    let worstSun = 0, worstRing = 0;
    for (const t of TIMES) {
      const W = worldAt(b, t), ms = W('a-sun');
      const sun = gearPoly(12, rs, centre(ms).x, centre(ms).y, zAngle(ms));
      for (let i = 0; i < n; i++) {
        const mp = W(`a-planet${i}`), pp = gearPoly(12, rs, centre(mp).x, centre(mp).y, zAngle(mp));
        worstSun = Math.max(worstSun, penetration(sun, pp) / rs);
        for (const tooth of teeth) worstRing = Math.max(worstRing, penetration(tooth, pp) / rs);
      }
    }
    assert.ok(worstSun < 0.02, `${n} planets: sun ${worstSun}`);
    assert.ok(worstRing < 0.02, `${n} planets: ring ${worstRing}`);
  }
});

test('differential: the ring turns a third of the pinion, the axles together turn twice the carrier, and the bevel gears roll on one another with their apexes together', () => {
  const b = built('differential');
  const apexOf = (id: string, t: number) => {
    const add = b.add(id), m = worldAt(b, t)(id), sz = (add.size as number[])[2]!;
    return centre(m).addScaledVector(new Vector3(0, 0, 1).transformDirection(m), 1.028 * sz);
  };
  for (const t of [0.5, 1.7]) {
    const wp = omega(b, 'a-pinion', t), wr = omega(b, 'a-ring', t), wc = omega(b, 'a-carrier', t), wl = omega(b, 'a-side-left', t), wrr = omega(b, 'a-side-right', t);
    near(wr.length() / wp.length(), 1 / 3, 1e-3, 'ring to pinion');
    near(wc.dot(wr) / wr.length() ** 2, 1, 1e-3, 'the carrier turns with the ring');
    near(wl.clone().add(wrr).sub(wc.clone().multiplyScalar(2)).length() / wp.length(), 0, 2e-3, 'axles together are twice the carrier');
    assert.ok(wl.clone().sub(wrr).length() / wp.length() > 0.05, 'one axle is faster than the other (it is turning a corner)');
    const scale = (b.add('a-ring').size as number[])[0]!;
    for (const [x, y] of [['a-pinion', 'a-ring'], ['a-side-left', 'a-spider-top'], ['a-side-left', 'a-spider-bottom'], ['a-side-right', 'a-spider-top'], ['a-side-right', 'a-spider-bottom']] as const) {
      assert.ok(apexOf(x, t).distanceTo(apexOf(y, t)) < 1e-3 * scale, `${x} meets ${y} at the apex`);
    }
  }
});

test('crank slider and cam and follower and the lever classes all move, and move the part they are for', () => {
  const cs = built('crank-slider');
  const ys = TIMES.map((t) => centre(worldAt(cs, t)('a-piston')).y);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 0.5, 'the piston travels');
  const cam = built('cam-follower');
  const vs = TIMES.map((t) => centre(worldAt(cam, t)('a-valve')).y);
  assert.ok(Math.max(...vs) - Math.min(...vs) > 0.05, 'the follower lifts');
  for (const n of [1, 2, 3]) {
    const lv = built('lever', [12, 5, 2.4], { n });
    const r = TIMES.map((t) => zAngle(worldAt(lv, t)('a-beam')));
    assert.ok(Math.max(...r) - Math.min(...r) > 5, `class ${n}: the beam rocks`);
  }
});

test('cam and follower: the stem of the valve rides on the lobe through the whole turn (no gap, no sinking into it)', () => {
  const b = built('cam-follower');
  const camAdd = b.add('a-camshaft'), valveAdd = b.add('a-valve');
  const cw = (camAdd.size as number[])[0]!, vh = (valveAdd.size as number[])[1]!;
  // The kit camshaft: a base circle of 0.27 of its width, a nose at half of it, a smooth flank of 64 degrees each side of the nose.
  const rBase = 0.27 * cw, rNose = 0.5 * cw, flank = 64;
  let worst = 0, travel = 0, lo = Infinity, hi = -Infinity;
  for (let t = 0; t <= 3.01; t += 0.05) {
    const w = worldAt(b, t);
    const cam = w('a-camshaft');
    const axis = centre(cam);
    const nose = new Vector3(0, 1, 0).transformDirection(cam);
    const theta = (Math.acos(Math.max(-1, Math.min(1, nose.dot(new Vector3(0, -1, 0))))) * 180) / Math.PI;
    const r = theta >= flank ? rBase : rBase + (rNose - rBase) * 0.5 * (1 + Math.cos((Math.PI * theta) / flank));
    const stemTop = centre(w('a-valve')).y + vh / 2;
    worst = Math.max(worst, Math.abs(axis.y - r - stemTop));
    lo = Math.min(lo, stemTop); hi = Math.max(hi, stemTop);
    travel = hi - lo;
  }
  assert.ok(worst < 0.02 * cw, `the valve's stem top is within ${worst} of the lobe's surface`);
  assert.ok(travel > 0.15 * cw, `and it travels (${travel})`);
});

test('four-bar linkage (parallelogram): the coupler stays level, the rocker follows the crank turn for turn, and the joints stay joined', () => {
  const b = built('four-bar-linkage');
  const crank = b.add('a-crank-bar'), coupler = b.add('a-coupler-bar'), rocker = b.add('a-rocker-bar');
  const w = (crank.size as number[])[1]!, aLen = (crank.size as number[])[0]! - w, bLen = (coupler.size as number[])[0]! - w;
  assert.equal((rocker.size as number[])[0], (crank.size as number[])[0]);
  for (const t of TIMES) {
    const W = worldAt(b, t);
    const C1 = new Vector3(bLen, 0, 0).applyMatrix4(W('a-coupler')), C2 = new Vector3(aLen, 0, 0).applyMatrix4(W('a-rocker'));
    near(C1.x, C2.x, 1e-4, 'coupler end meets rocker end x'); near(C1.y, C2.y, 1e-4, 'y');
    const B1 = new Vector3(aLen, 0, 0).applyMatrix4(W('a-crank-arm')), B2 = new Vector3(0, 0, 0).applyMatrix4(W('a-coupler'));
    near(B1.x, B2.x, 1e-4, 'coupler start is at the crank end'); near(B1.y, B2.y, 1e-4, 'y');
  }
  near(omega(b, 'a-coupler', 1).length(), 0, 1e-6, 'coupler does not turn');
  near(omega(b, 'a-rocker', 1).z / omega(b, 'a-crank-arm', 1).z, 1, 1e-3, 'rocker to crank');
});

test('bicycle drivetrain: the sprocket and the wheel turn 44 over 16 times the chainring the same way, the pedal stays level, and the chain runs between them', () => {
  const b = built('bicycle-drivetrain');
  const wc = omega(b, 'a-chainring', 1).z;
  near(omega(b, 'a-sprocket', 1).z / wc, 44 / 16, 1e-3, 'sprocket');
  near(omega(b, 'a-wheel', 1).z / wc, 44 / 16, 1e-3, 'wheel');
  near(omega(b, 'a-pedal', 1).length(), 0, 1e-5, 'pedal');
  const chain = (b.step.actions as Raw[]).find((a) => a.id === 'a-chain')!;
  assert.equal(chain.shape, 'connector');
  assert.deepEqual([chain.from, chain.to, chain.kind], ['a-chainring', 'a-sprocket', 'wrapped']);
});

test('block and tackle: the hand goes twice as far as the load, the other way, and each sheaf turns by the rope laid on it', () => {
  const b = built('block-and-tackle');
  const y = (id: string, t: number) => centre(worldAt(b, t)(id)).y;
  for (const t of [0.5, 1.5, 3.5, 4.5]) near((y('a-hand', t) - y('a-hand', 0.0001)) / (y('a-load', t) - y('a-load', 0.0001)), -2, 1e-3, `at ${t}`);
  const rg = 0.88 * Math.min(7 / 6, 12 / 11.5, 2 / 0.8);
  const vload = (y('a-load', 1.001) - y('a-load', 1)) / 0.001, vhand = (y('a-hand', 1.001) - y('a-hand', 1)) / 0.001;
  near(omega(b, 'a-moving', 1).z, vload / rg, 2e-3, 'moving sheaf');
  near(omega(b, 'a-fixed', 1).z, vhand / rg, 2e-3, 'fixed sheaf');
});

test('a question that names an assembly is told it, beside the question and never in the guide; a question that names none is told nothing', () => {
  assert.deepEqual(assembliesNamed('How does a differential work?'), ['differential']);
  assert.deepEqual(assembliesNamed('how does a planetary gear set work'), ['planetary']);
  assert.deepEqual(assembliesNamed('what is a block and tackle'), ['block-and-tackle']);
  assert.deepEqual(assembliesNamed('how does a rack and pinion steer a car'), ['rack-and-pinion']);
  for (const q of ['what is a hearth', 'explain the heart', 'how do magnets work', '']) assert.equal(assemblyHint(q), undefined, q);
  const hint = assemblyHint('How does a differential work?') ?? '';
  assert.match(hint, /part:"differential"/);
  assert.match(hint, /<id>-<piece>/);
  assert.match(hint, /side-left/);
  const request: ModelRequest = { question: 'how does a bicycle drivetrain work', screenshot: { mime: 'image/png', base64: 'AAAA', width: 1280, height: 720 }, thread: [], schema: {} };
  const text = questionText(request);
  assert.ok(text.includes('bicycle-drivetrain') && text.indexOf('ready assembly') < text.indexOf('transcribed from speech'));
  assert.ok(!questionText({ ...request, question: 'explain gears' }).includes('ready assembly'));
});

// --- intermittent motion: the Geneva drive, the clock escapement and the ratchet and pawl ---

test('Geneva drive: the pin runs in a slot while it is in the wheel, the wheel turns one slot opposite the driver a turn and stands still the rest of it', () => {
  for (const n of [4, 5, 6]) {
    const b = built('geneva', [10, 6, 2], { n });
    const amt = 360 / n, tau = 6; // the driver spins at 10 rpm: one turn in six seconds
    const wheelAdd = b.add('a-wheel') as Raw, pinAdd = b.add('a-pin') as Raw;
    const wx = (wheelAdd.pos as number[])[0]!, driverX = ((b.add('a-driver') as Raw).pos as number[])[0]!;
    const c = wx - driverX, a = Math.abs(((pinAdd.pos as number[])[0]!)); // the pin's circle and the middle-to-middle distance
    const bReach = a / Math.tan(Math.PI / n);
    let engaged = 0, still = 0;
    for (let t = 0.02; t < 2 * tau; t += 0.05) {
      const w = worldAt(b, t);
      const local = centre(w('a-pin')).applyMatrix4(w('a-wheel').clone().invert());
      const dist = Math.hypot(local.x, local.y);
      const prev = zAngle(worldAt(b, t - 0.01)('a-wheel')), next = zAngle(worldAt(b, t + 0.01)('a-wheel'));
      if (dist < bReach - 0.03 * a) {
        engaged++;
        // the pin's direction from the wheel's middle is along a slot (any one of the n), and it is in the slot's length
        const dir = (Math.atan2(local.y, local.x) * 180) / Math.PI;
        const off = Math.min(...Array.from({ length: n }, (_, i) => Math.abs((((dir - (180 + amt / 2 + i * amt)) % 360) + 540) % 360 - 180)));
        assert.ok(off < 0.6, `n=${n} t=${t.toFixed(2)}: the pin is ${off.toFixed(2)} degrees off a slot`);
        assert.ok(dist > c - a - 0.05 * a, `n=${n} t=${t.toFixed(2)}: the pin is out of the slot's inner end`);
      } else if (dist > bReach + 0.03 * a) {
        still++;
        assert.ok(Math.abs(dAng(next, prev)) < 1e-6, `n=${n} t=${t.toFixed(2)}: the wheel stands while the pin is away (${prev} to ${next})`);
      }
    }
    assert.ok(engaged > 10 && still > 10, `n=${n}: the pin engages for part of a turn and is away for the rest (${engaged}, ${still})`);
    // one slot opposite the driver a turn, and the same each turn
    const w0 = zAngle(worldAt(b, 0.02)('a-wheel')), w1 = zAngle(worldAt(b, 0.02 + tau)('a-wheel')), w2 = zAngle(worldAt(b, 0.02 + 2 * tau)('a-wheel'));
        near(dAng(w1, w0), -amt, 0.01, `n=${n} first turn`);
    near(dAng(w2, w1), -amt, 0.01, `n=${n} second turn`);
  }
});

test('clock escapement: the wheel steps one tooth each time the anchor passes the middle, twice a period, and stands while the anchor is at the end of its swing', () => {
  const b = built('escapement');
  const amt = 360 / 30, wheel = (t: number) => zAngle(worldAt(b, t)('a-wheel')), anchor = (t: number) => zAngle(worldAt(b, t)('a-anchor'));
  for (let k = 0; k < 8; k++) {
    // between one crossing of the middle and the next (half a period, a second) the wheel has gone on by exactly one tooth
    const t0 = 0.25 + k * 1, t1 = t0 + 1;
    near(dAng(wheel(t1), wheel(t0)), -amt, 1e-6, `tick ${k}`);
  }
  let moving = 0;
  for (let t = 0.05; t < 6; t += 0.04) {
    const dw = Math.abs(dAng(wheel(t + 0.01), wheel(t - 0.01)));
    if (Math.abs(anchor(t)) > 5.5) assert.ok(dw < 1e-6, `t=${t.toFixed(2)}: the wheel stands while the anchor is at ${anchor(t).toFixed(1)} degrees`);
    else if (dw > 1e-3) moving++;
  }
  assert.ok(moving > 5, 'the wheel moves while the anchor is near the middle');
  // the hand is on the wheel: after fifteen beats (fifteen teeth) it has gone half way round
  near(Math.abs(dAng(wheel(0.25 + 15), wheel(0.25))), 180, 1e-6, 'half a round of the wheel in n/2 beats');
});

test('ratchet and pawl: the wheel is pushed on a tooth while the lever goes forward, stands when it comes back, and never runs backward', () => {
  const b = built('ratchet');
  const p = 360 / 12, wheel = (t: number) => zAngle(worldAt(b, t)('a-wheel')), lever = (t: number) => zAngle(worldAt(b, t)('a-lever'));
  // the lever swings half a tooth either side: the push is the forward stroke, the wheel keeps pace with the lever through it
  for (const t of [0.1, 0.2, 0.3, 0.4, 2.1, 2.2, 2.3, 2.4]) near(dAng(wheel(t), wheel(0)), lever(t) + (t > 1 ? p : 0), 1e-6, `push at ${t}`);
  let prev = wheel(0);
  for (let t = 0; t < 8; t += 0.01) {
    const w = wheel(t);
    assert.ok(dAng(w, prev) >= -1e-9, `t=${t.toFixed(2)}: the wheel runs back (${prev} to ${w})`);
    prev = w;
  }
  // a whole number of teeth a cycle, and still through the lever's return stroke
  near(dAng(wheel(2.5), wheel(0.5)), p, 1e-6, 'one tooth a cycle');
  for (const t of [0.6, 0.8, 1.0, 1.2, 1.4]) near(dAng(wheel(t), wheel(0.5)), 0, 1e-9, `stands at ${t}`);
  assert.ok(lever(1.0) < lever(0.5) - 1 && lever(1.5) < -(p / 2) + 1e-6, 'the lever swings back while the wheel stands');
});

test('spring snap: the trigger tips and the catch lifts before the hammer snaps over to the plate, it rests, is wound slowly back and caught again', () => {
  const b = built('spring-snap');
  const hammer = (t: number) => zAngle(worldAt(b, t)('a-hammer')), catchBar = (t: number) => zAngle(worldAt(b, t)('a-catch')), trigger = (t: number) => zAngle(worldAt(b, t)('a-trigger'));
  // cocked: the hammer lies on the bait side held by the catch, the trigger upright under it
  near(hammer(0), 0, 1e-9, 'cocked at the start');
  near(catchBar(0), 0, 1e-9, 'caught');
  near(trigger(0), 0, 1e-9, 'set');
  // the snap: the first quarter-second is most of the 180 degrees (fast, braking as it lands), and it lands
  let t = 0;
  while (hammer(t) < 5 && t < 4) t += 0.005;
  assert.ok(t > 0.3 && t < 0.6, `it goes at ${t}`);
  const start = t;
  while (hammer(t) < 175 && t < 4) t += 0.005;
  assert.ok(t - start < 0.3, `180 degrees in ${(t - start).toFixed(2)} s is a snap`);
  near(hammer(1.0), 180, 1e-6, 'rests on the plate');
  // the catch and the trigger are out of the way as soon as it moves, and for as long as it is away
  for (const at of [start + 0.02, 0.8, 1.2, 1.6, 2.0]) {
    assert.ok(catchBar(at) < -40, `the catch is lifted at ${at.toFixed(2)}`);
    assert.ok(trigger(at) > 10, `the trigger is tipped at ${at.toFixed(2)}`);
  }
  // wound back slowly (several times slower than the snap), never past either end, and caught again
  let back = 1.0;
  while (hammer(back) > 170 && back < 4) back += 0.005;
  const wound = back;
  while (hammer(back) > 5 && back < 4) back += 0.005;
  assert.ok(back - wound > 0.5, `wound back in ${(back - wound).toFixed(2)} s`);
  for (let at = 0; at < 8; at += 0.02) assert.ok(hammer(at) > -1e-6 && hammer(at) < 180 + 1e-6, `the hammer stays between its ends at ${at.toFixed(2)}`);
  near(hammer(3.9), 0, 1e-9, 'cocked again');
  near(catchBar(3.9), 0, 1e-9, 'caught again');
  near(hammer(4.0 + 1.0), hammer(1.0), 1e-6, 'the same every cycle');
});
