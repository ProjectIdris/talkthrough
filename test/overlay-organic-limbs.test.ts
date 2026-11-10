import test from 'node:test';
import assert from 'node:assert/strict';
import type { Mesh } from 'three';
import { BodyField, primDistance, tubeOf } from '../src/overlay/organic-field.ts';
import type { FieldPart, Prim } from '../src/overlay/organic-field.ts';
import { organicKind } from '../src/overlay/organic-bodies.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import { validateScene } from '../src/scene/index.ts';
import type { Scene } from '../src/scene/index.ts';

const VIEW = { rect: { x: 0, y: 0, w: 600, h: 600 }, width: 1000, height: 800 };
type Add = Parameters<typeof organicKind>[0];
type Actions = Scene['steps'][0]['actions'];
const PANEL = { op: 'panel', x: 100, y: 100, w: 400, h: 400 };

/** Every vertex drawn for a part, in the part's own space. */
const drawn = (scene: Scene, ids: string[]): Record<string, Float32Array> => {
  const frame = frameAt(scene.steps, scene.steps.length - 1, 99);
  const panel = new PanelScene({ tier: 'mid' });
  panel.sync(frame, 1, VIEW);
  const out: Record<string, Float32Array> = {};
  for (const id of ids) {
    let found = new Float32Array(0);
    panel.nodeOf(frame.objects.find((o) => o.id === id)!.key)!.traverse((o) => {
      const at = (o as Mesh).geometry?.getAttribute('position');
      if (at && at.count * 3 > found.length) found = Float32Array.from(at.array as Float32Array);
    });
    out[id] = found;
  }
  panel.destroy();
  return out;
};

const limb = (def: Record<string, unknown>): Extract<Prim, { kind: 'tube' }> => {
  const kind = organicKind({ op: 'add', shape: 'tube', id: 't', ...def } as unknown as Add);
  assert.ok(kind && kind.prim.kind === 'tube', 'a tube of the body');
  return kind.prim as Extract<Prim, { kind: 'tube' }>;
};

test('a tube that thins along its length is a smooth cone between its points, with no ring where two stretches meet', () => {
  // Balls of radius 1, 0.8, 0.6, 0.4 a unit apart: the skin that touches them all is one cone, a fifth of a unit thinner for each unit along.
  const tube: Prim = { kind: 'tube', pts: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]], radii: [1, 0.8, 0.6, 0.4] };
  const lean = Math.sqrt(1 - 0.2 * 0.2);
  let worst = 0;
  for (let x = 0.3; x <= 2.9; x += 0.05) {
    const c = (x - 0.2) / 0.96;
    worst = Math.max(worst, Math.abs(primDistance(tube, x, (1 - 0.2 * c) * lean, 0)));
  }
  assert.ok(worst < 1e-9, `the cone's own surface is where the field is nothing (off by ${worst})`);
});

test('a tube made for the field is the tube it was given: straight runs are fewer stretches, a curve keeps its points, and no stretch passed over was the nearest', () => {
  // A straight taper through thirteen samples is one stretch; an arc keeps every sample.
  const line = Array.from({ length: 13 }, (_, i): [number, number, number] => [i * 0.25, 0, 0]);
  const taper = line.map((_, i) => 0.5 - 0.02 * i);
  const straight = tubeOf(line, taper);
  assert.ok(straight.kind === 'tube' && straight.pts.length === 2, 'a straight taper is one stretch');
  const arc = Array.from({ length: 13 }, (_, i): [number, number, number] => [3 * Math.cos(i * 0.12), 3 * Math.sin(i * 0.12), 0]);
  const curved = tubeOf(arc, arc.map(() => 0.3));
  assert.ok(curved.kind === 'tube' && curved.pts.length === 13, 'a curve keeps its points');
  // A finger with a wavy width, asked at points near and far: the same distance with the stretches passed over as with every stretch asked.
  const path = Array.from({ length: 40 }, (_, i): [number, number, number] => [i * 0.1, 0.3 * Math.sin(i * 0.2), 0.1 * Math.cos(i * 0.3)]);
  const widths = path.map((_, i) => 0.3 + 0.05 * Math.sin(i * 0.9));
  const quick = tubeOf(path, widths);
  assert.ok(quick.kind === 'tube' && quick.near && quick.pts.length > 30);
  const plain = { kind: 'tube' as const, pts: quick.pts, radii: quick.radii };
  let worst = 0, seed = 7;
  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let k = 0; k < 4000; k++) {
    const x = -1 + 6 * rnd(), y = -1.5 + 3 * rnd(), z = -1.5 + 3 * rnd();
    worst = Math.max(worst, Math.abs(primDistance(quick, x, y, z) - primDistance(plain, x, y, z)));
  }
  assert.ok(worst < 1e-12, `off by ${worst}`);
  // and the straight taper is the same solid as its thirteen samples were
  const sampled = { kind: 'tube' as const, pts: line, radii: taper };
  for (let k = 0; k < 500; k++) {
    const x = -1 + 5 * rnd(), y = -1 + 2 * rnd(), z = -1 + 2 * rnd();
    worst = Math.max(worst, Math.abs(primDistance(straight, x, y, z) - primDistance(sampled, x, y, z)));
  }
  assert.ok(worst < 1e-9, `the straight taper is off by ${worst}`);
});

test('a slender limb of skin has its joints: a knuckle where it runs straight through a point, a corner where it is bent, and none in a vessel or a stump', () => {
  const finger = limb({ pts: [[0, 0, 0], [0, 1.6, 0], [0, 3.2, 0]], radius: 0.4, material: 'skin' });
  assert.equal(finger.creases?.length, 1, 'one knuckle');
  assert.ok(Math.abs(finger.creases![0]!.at - 1.6) < 0.05, `at the middle point (${finger.creases![0]!.at})`);
  assert.ok(Math.max(...finger.radii) > 0.42 && Math.max(...finger.radii) < 0.45, `a slight swelling either side of it (${Math.max(...finger.radii)})`);
  // The same path as a vessel, and as a stump too thick for its length: plain tubes.
  assert.equal(limb({ pts: [[0, 0, 0], [0, 1.6, 0], [0, 3.2, 0]], radius: 0.4, material: 'vessel' }).creases, undefined, 'a vessel has no knuckle');
  const stump = limb({ pts: [[0, 0, 0], [0, 1.6, 0], [0, 3.2, 0]], radius: 1, material: 'skin' });
  assert.equal(stump.creases, undefined, 'nor has a forearm');
  assert.ok(Math.max(...stump.radii) <= 1 + 1e-9, 'and it does not swell');
  // Bent sharply (a knee, the leg of an insect): the corner is kept, with a ball to it, and no fold is drawn across it.
  const knee = limb({ pts: [[0, 0, 0], [0, 2, 0], [2, 2, 0]], radius: 0.3, material: 'skin' });
  assert.equal(knee.creases?.length ?? 0, 0, 'a bent joint has no fold');
  const corner = knee.pts.findIndex((p) => Math.hypot(p[0], p[1] - 2, p[2]) < 1e-6);
  assert.ok(corner > 0, 'the path goes through the corner itself');
  assert.ok(knee.radii[corner]! > 0.33, `and is a ball there (${knee.radii[corner]})`);
  // Three knuckles close together (a finger through five points) are each slighter than one alone.
  const three = limb({ pts: [[0, 0, 0], [0, 1, 0], [0, 1.9, 0], [0, 2.7, 0], [0, 3.3, 0]], radius: 0.4, material: 'skin' });
  assert.equal(three.creases?.length, 3, 'three knuckles');
  assert.ok(Math.max(...three.radii) < Math.max(...finger.radii) - 0.005, `each slighter (${Math.max(...three.radii)} against ${Math.max(...finger.radii)})`);
});

test('a box of flesh is a pad and a thick outline of flesh a slab; bone keeps its box, and a thin outline stays a sheet', () => {
  const kindOf = (def: Record<string, unknown>): string | undefined => organicKind({ op: 'add', id: 'p', ...def } as unknown as Add)?.prim.kind;
  assert.equal(kindOf({ shape: 'box', size: [4, 4.2, 0.9], material: 'skin' }), 'pad');
  assert.equal(kindOf({ shape: 'box', size: [4, 4.2, 0.9], material: 'bone' }), 'box');
  const outline = [[-2, -2], [2, -2], [2, 2], [-2, 2]];
  assert.equal(kindOf({ shape: 'extrude', outline, depth: 1.2, material: 'skin' }), 'slab');
  assert.equal(kindOf({ shape: 'extrude', outline, depth: 0.1, material: 'skin' }), undefined, 'a leaf-thin outline is a sheet, not a part of a body');
});

test('a palm and a wrist written as boxes in one plane are one flat thing: no furrow between them, and no swelling where their faces lie together', () => {
  const hand: Scene = { steps: [{ say: 'x', actions: [
    PANEL,
    { op: 'add', shape: 'box', id: 'palm', size: [4, 4.2, 1], bevel: 0.3, material: 'skin' },
    { op: 'add', shape: 'box', id: 'wrist', pos: [0, -2.9, 0], size: [3.2, 2, 0.9], bevel: 0.3, material: 'skin' },
  ] as Actions }] };
  const v = drawn(hand, ['palm', 'wrist']);
  assert.ok(v.palm!.length > 3000 && v.wrist!.length > 1500, 'both are drawn');
  let thick = 0;
  for (const id of ['palm', 'wrist']) for (let i = 2; i < v[id]!.length; i += 3) thick = Math.max(thick, Math.abs(v[id]![i]!));
  assert.ok(thick < 0.51, `nowhere thicker than the palm (${thick} against 0.5)`);
  // Down the middle of the back of the hand, across the join (the palm ends at y -2.1, the wrist begins at -1.9): the skin runs from the palm's face to
  // the wrist's (0.5 to 0.45). Two pads each with its own rounded rim would leave a furrow there.
  let low = Infinity, seen = 0;
  for (const [id, dy] of [['palm', 0], ['wrist', -2.9]] as const) for (let i = 0; i < v[id]!.length; i += 3) {
    const x = v[id]![i]!, y = v[id]![i + 1]! + dy, z = v[id]![i + 2]!;
    if (Math.abs(x) < 0.5 && y > -2.5 && y < -1.5 && z > 0) { low = Math.min(low, z); seen++; }
  }
  assert.ok(seen > 20 && low > 0.43, `the back of the hand runs on into the wrist (lowest ${low} over ${seen} vertices)`);
});

test('a flat part is asked as far off as its join in the plane reaches: the skin round a palm and a wrist is the same with no part passed over', () => {
  // The same two pads twice: in their own boxes (a part out of reach of the point asked is passed over), and in boxes so roomy that none ever is.
  const pad = (half: [number, number, number], y: number, roomy: boolean): FieldPart => {
    const reach = 0.45 * 2 * Math.min(half[0], half[1]), room = roomy ? 1000 : reach / 4;
    return {
      prim: { kind: 'pad', half, thin: 2, corner: 0.4, rim: 0.2 }, toLocal: new Float64Array([1, 0, 0, 0, 0, 1, 0, -y, 0, 0, 1, 0]), scale: 1, soft: 0.2, wall: 0,
      lo: [-half[0] - room, y - half[1] - room, -half[2] - room], hi: [half[0] + room, y + half[1] + room, half[2] + room], inside: [0, y, 0], size: 2 * half[2],
      flat: { plane: 0, mid: 0, half: half[2], rim: 0.2, reach },
    };
  };
  const hand = (roomy: boolean): BodyField => new BodyField([pad([2, 2.1, 0.5], 0, roomy), pad([1.6, 1, 0.45], -2.9, roomy)], [[0, 0, 1]]);
  const quick = hand(false), whole = hand(true);
  let worst = 0, near = 0, seed = 11;
  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let k = 0; k < 30000; k++) {
    const x = -2.8 + 5.6 * rnd(), y = -4.6 + 7.4 * rnd(), z = -0.8 + 1.6 * rnd();
    const f = whole.value(x, y, z);
    if (Math.abs(f) > 0.3) continue;
    near++;
    worst = Math.max(worst, Math.abs(quick.value(x, y, z) - f));
  }
  assert.ok(near > 3000, `points near the skin (${near})`);
  assert.ok(worst < 1e-9, `the skin moves by ${worst} when a part out of its box is passed over`);
});

test('a round wrist under a flat palm is no thicker than the palm where the two lie together, and round again beyond it', () => {
  const hand: Scene = { steps: [{ say: 'x', actions: [
    PANEL,
    { op: 'add', shape: 'blob', id: 'palm', pts: [[-0.6, 0, 0], [0.6, 0, 0], [0, 0.2, 0], [0, -0.2, 0]], sizes: [[1.6, 1.6, 0.7]], soft: 0.5, material: 'skin' },
    { op: 'add', shape: 'tube', id: 'wrist', pts: [[0, -0.6, 0], [0, -2.6, 0]], radius: 0.7, material: 'skin' },
  ] as Actions }] };
  const v = drawn(hand, ['palm', 'wrist']);
  let within = 0, beyond = 0;
  for (const id of ['palm', 'wrist']) for (let i = 0; i < v[id]!.length; i += 3) {
    const y = v[id]![i + 1]!, z = Math.abs(v[id]![i + 2]!);
    if (y > -0.8) within = Math.max(within, z); else if (y < -2.2) beyond = Math.max(beyond, z);
  }
  assert.ok(within < 0.5, `in the palm the hand is as thick as the palm (${within}; the wrist alone is 0.7)`);
  assert.ok(beyond > 0.65, `and the wrist is round where it has left it (${beyond})`);
});

test('a limb with one end out of its body is not taken for a part inside it: it grows out of the body', () => {
  // The forearm starts in the palm and runs out of it at a slant; its middle point is well inside the palm.
  const hand: Scene = { steps: [{ say: 'x', actions: [
    PANEL,
    { op: 'add', shape: 'blob', id: 'palm', pts: [[0, 0, 0]], sizes: [[4, 4, 1.2]], material: 'skin' },
    { op: 'add', shape: 'tube', id: 'forearm', pts: [[0.5, 0.6, 0], [0, -0.3, 0], [-1.8, -3.4, 0]], radius: 0.4, material: 'skin' },
  ] as Actions }] };
  const v = drawn(hand, ['palm', 'forearm']);
  // Where the forearm leaves the palm the palm's skin is open: none of it lies inside the forearm.
  let inside = 0;
  const ax = -1.8, ay = -3.1, al = Math.hypot(ax, ay);
  for (let i = 0; i < v.palm!.length; i += 3) {
    const px = v.palm![i]!, py = v.palm![i + 1]! + 0.3, pz = v.palm![i + 2]!;
    const t = (px * ax + py * ay) / al;
    if (t > 1.2 && t < al && Math.hypot(px - (ax / al) * t, py - (ay / al) * t, pz) < 0.25) inside++;
  }
  assert.equal(inside, 0, 'no skin of the palm inside the forearm');
  assert.ok(v.forearm!.length > 600, 'and the forearm is drawn');
});

const issuesOf = (actions: unknown[]): { scene: Scene; notes: string[] } => {
  const r = validateScene({ steps: [{ say: 'x', actions: [PANEL, ...actions] }] });
  assert.ok(r.scene, 'the scene is kept');
  return { scene: r.scene, notes: r.issues.map((i) => i.message) };
};
const ptsOf = (scene: Scene, id: string): number[][] => {
  const all = scene.steps.flatMap((s) => s.actions).filter((a) => a.op === 'add' && a.id === id);
  return (all[all.length - 1] as unknown as { pts: number[][] }).pts;
};

test('what grows out of living flesh starts inside it: a finger written from within the palm stays there, and a wire in a case is still brought to its face', () => {
  const { scene } = issuesOf([
    { op: 'add', shape: 'box', id: 'palm', size: [4, 4, 0.9], material: 'skin' },
    { op: 'add', shape: 'tube', id: 'finger', pts: [[0, 1.4, 0], [0, 3, 0], [0, 4.5, 0]], radius: 0.4, material: 'skin' },
    { op: 'add', shape: 'box', id: 'case', pos: [8, 0, 0], size: [4, 4, 0.9], material: 'steel' },
    { op: 'add', shape: 'tube', id: 'wire', pts: [[8, 1.4, 0], [8, 3, 0], [8, 4.5, 0]], radius: 0.4, material: 'copper' },
  ]);
  assert.deepEqual(ptsOf(scene, 'finger')[0], [0, 1.4, 0], 'the finger starts where it was written, inside the palm');
  assert.notDeepEqual(ptsOf(scene, 'wire')[0], [8, 1.4, 0], 'the wire is moved onto the case');
  const finger = scene.steps.flatMap((s) => s.actions).find((a) => a.op === 'add' && a.id === 'finger') as unknown as { attach?: Array<{ to: string } | null> };
  assert.equal(finger.attach?.[0]?.to, 'palm', 'and the finger goes with the palm');
});

test('only living into living grows: a tube of skin in a steel block, and a steel pin in flesh, are both still brought to the face', () => {
  const { scene } = issuesOf([
    { op: 'add', shape: 'box', id: 'block', size: [4, 4, 0.9], material: 'steel' },
    { op: 'add', shape: 'tube', id: 'stub', pts: [[0, 1.4, 0], [0, 3, 0], [0, 4.5, 0]], radius: 0.4, material: 'skin' },
    { op: 'add', shape: 'box', id: 'flesh', pos: [8, 0, 0], size: [4, 4, 0.9], material: 'skin' },
    { op: 'add', shape: 'tube', id: 'pin', pts: [[8, 1.4, 0], [8, 3, 0], [8, 4.5, 0]], radius: 0.4, material: 'steel' },
  ]);
  assert.notDeepEqual(ptsOf(scene, 'stub')[0], [0, 1.4, 0], 'the skin tube is moved onto the block');
  assert.notDeepEqual(ptsOf(scene, 'pin')[0], [8, 1.4, 0], 'the pin is moved onto the flesh');
});

test('a living tube that ends beside a living part is not drawn back to it; one that stops short of it is still brought to it', () => {
  const { scene } = issuesOf([
    { op: 'add', shape: 'tube', id: 'toe', pts: [[0, 0, 0], [0, 1, 0], [0, 2, 0]], radius: 0.5, material: 'skin' },
    { op: 'add', shape: 'sphere', id: 'pad', pos: [0, 1.6, 0.4], size: [0.9, 0.8, 0.5], material: 'skin' },
    { op: 'add', shape: 'sphere', id: 'chamber', pos: [10, 0, 0], size: [4, 4, 4], material: 'organ' },
    { op: 'add', shape: 'tube', id: 'vein', pts: [[6, 0, 0], [7.8, 0, 0]], radius: 0.2, material: 'vessel' },
  ]);
  assert.deepEqual(ptsOf(scene, 'toe')[2], [0, 2, 0], 'the toe keeps its length over its pad');
  const toe = scene.steps.flatMap((s) => s.actions).filter((a) => a.op === 'add' && a.id === 'toe').pop() as unknown as { attach?: Array<{ to: string } | null> };
  assert.equal(toe.attach?.[1]?.to, 'pad', 'and its end goes with the pad');
  assert.ok(Math.abs(ptsOf(scene, 'vein')[1]![0]! - 8) < 1e-6, `the vein reaches the chamber (${ptsOf(scene, 'vein')[1]})`);
});

test('flesh written round a bone and held by it does not make the bone see-through', () => {
  const { notes } = issuesOf([
    { op: 'add', shape: 'cylinder', id: 'bone', size: [0.6, 4, 0.6], material: 'bone' },
    { op: 'add', shape: 'blob', id: 'flesh', parent: 'bone', pts: [[0, 0.8, 0], [0, -0.8, 0]], sizes: [[2, 2.6, 2]], material: 'muscle', opacity: 0.4 },
  ]);
  assert.ok(!notes.some((m) => /made see-through/.test(m)), notes.join(' | '));
  // (a small part truly inside a closed solid still is: the rule itself is whole)
  const eye = issuesOf([
    { op: 'add', shape: 'sphere', id: 'globe', size: [3, 3, 3], material: 'organ' },
    { op: 'add', shape: 'blob', id: 'lens', parent: 'globe', pts: [[0, 0, 0.6]], sizes: [[0.8, 0.8, 0.4]], material: 'tissue' },
  ]);
  assert.ok(eye.notes.some((m) => /made see-through/.test(m)), 'a lens inside a globe still opens the globe');
});
