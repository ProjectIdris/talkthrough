import test from 'node:test';
import assert from 'node:assert/strict';
import type { Mesh } from 'three';
import { BodyField, primBounds, primInside } from '../src/overlay/organic-field.ts';
import type { FieldPart, Prim } from '../src/overlay/organic-field.ts';
import { cutFace, cutSkin } from '../src/overlay/organic-mesh.ts';
import { sheetGeometry } from '../src/overlay/organic-sheet.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import type { Scene } from '../src/scene/index.ts';

const VIEW = { rect: { x: 0, y: 0, w: 600, h: 600 }, width: 1000, height: 800 };

/** A part standing where its own space is the body's. */
const part = (prim: Prim, soft = 0): FieldPart => {
  const b = primBounds(prim);
  return { prim, toLocal: new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]), scale: 1, soft, wall: 0, lo: b.lo, hi: b.hi, inside: primInside(prim), size: Math.min(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]) };
};
const lump = (r: [number, number, number]): Prim => ({ kind: 'lumps', lumps: [{ c: [0, 0, 0], r }], reach: 1 });

test('a skin never passes its vertex ceiling, however fine it is asked for', () => {
  // A wide thin body at a cell a thousandth of its size: by the grid alone it would have some 800,000 vertices.
  const flat = cutSkin(new BodyField([part(lump([5, 5, 0.05]))]), { cell: 0.001 });
  assert.ok(flat.position.length / 3 <= 120_000, `${flat.position.length / 3} vertices`);
  assert.ok(flat.position.length / 3 > 10_000, 'and it is still a fine skin, not an empty one');
  const asked = cutSkin(new BodyField([part(lump([1, 1, 1]))]), { cell: 0.01, maxVertices: 3000 });
  assert.ok(asked.position.length / 3 <= 3000, `${asked.position.length / 3} vertices against the 3000 asked`);
  assert.ok(asked.position.length / 3 > 500, 'still a ball');
  let far = 0;
  for (let i = 0; i < asked.position.length; i += 3) far = Math.max(far, Math.abs(Math.hypot(asked.position[i]!, asked.position[i + 1]!, asked.position[i + 2]!) - 1));
  assert.ok(far < 1e-3, `every vertex is on the ball (${far})`);
});

test('a field with no finite size or cell has no skin, and says so at once', () => {
  const ball = part(lump([1, 1, 1]));
  for (const cell of [Number.NaN, 0, -1, Infinity]) assert.equal(cutSkin(new BodyField([ball]), { cell }).position.length, 0, `cell ${cell}`);
  const endless: FieldPart = { ...ball, hi: [Infinity, 1, 1] };
  assert.equal(cutSkin(new BodyField([endless]), { cell: 0.1 }).position.length, 0, 'an endless box');
  const nowhere: FieldPart = { ...ball, lo: [Number.NaN, -1, -1] };
  assert.equal(cutSkin(new BodyField([nowhere]), { cell: 0.1 }).position.length, 0, 'a box that is not a number');
  assert.equal(cutFace(new BodyField([endless]), [0, 0, 0], [1, 0, 0], [0, 1, 0], 0.1, false).position.length, 0, 'nor a cut face');
});

test('a grown sheet and a cut face are bounded whatever fineness is asked', () => {
  const leaf = sheetGeometry([[0, 0], [1, 1], [0, 3], [-1, 1]], 0.1, 1e7);
  assert.ok(leaf.getAttribute('position').count <= 60_000, `${leaf.getAttribute('position').count} vertices in the sheet`);
  assert.ok(leaf.getAttribute('position').count > 1000, 'and it is there');
  const face = cutFace(new BodyField([part(lump([5, 5, 5]))]), [0, 0, 0], [1, 0, 0], [0, 1, 0], 1e-6, false);
  assert.ok(face.position.length / 3 <= 120_000, `${face.position.length / 3} vertices in the face`);
  assert.ok(face.index.length > 3000, 'and it is there');
});

const HAND: Scene = { steps: [{ say: 'x', actions: [
  { op: 'panel', x: 100, y: 100, w: 400, h: 400 },
  { op: 'add', shape: 'blob', id: 'palm', pts: [[0, 0, 0]], sizes: [[4, 3.6, 1.2]], material: 'skin' },
  { op: 'add', shape: 'tube', id: 'finger', pts: [[0, 1.2, 0], [0, 2.6, 0], [0, 4, 0]], radius: 0.4, material: 'skin' },
] as Scene['steps'][0]['actions'] }] };

const vertices = (panel: PanelScene, key: number): Float32Array => {
  let found: Float32Array | undefined;
  panel.nodeOf(key)!.traverse((o) => {
    const geo = (o as Mesh).geometry;
    if (!found && geo?.getAttribute('position')?.count) found = geo.getAttribute('position').array as Float32Array;
  });
  assert.ok(found, 'the part is drawn');
  return found;
};

test('a finger grows out of the palm: one skin, with nothing of either left inside the other', () => {
  const panel = new PanelScene({ tier: 'mid' });
  const frame = frameAt(HAND.steps, 0, 99);
  panel.sync(frame, 1, VIEW);
  const key = (id: string): number => frame.objects.find((o) => o.id === id)!.key;
  const finger = vertices(panel, key('finger')), palm = vertices(panel, key('palm'));
  // Drawn apart, the finger's root (its end cap at y 1.2) lies well inside the palm's ellipsoid, and the palm's crown inside the finger.
  let fingerInPalm = 0, palmInFinger = 0;
  for (let i = 0; i < finger.length; i += 3) if ((finger[i]! / 2) ** 2 + (finger[i + 1]! / 1.8) ** 2 + (finger[i + 2]! / 0.6) ** 2 < 0.8) fingerInPalm++;
  for (let i = 0; i < palm.length; i += 3) if (palm[i + 1]! > 1.3 && Math.hypot(palm[i]!, palm[i + 2]!) < 0.25) palmInFinger++;
  assert.equal(fingerInPalm, 0, 'no vertex of the finger lies inside the palm');
  assert.equal(palmInFinger, 0, 'no vertex of the palm lies inside the finger');
  assert.ok(panel.organicTriangles().worn > 2000, 'and the body is drawn');
  panel.destroy();
});

test('skins that are no longer worn do not pile up: a body cut again and again keeps a few scenes of triangles at most', () => {
  const panel = new PanelScene({ tier: 'mid' });
  const base = frameAt(HAND.steps, 0, 99);
  for (let i = 0; i < 40; i++) {
    // The finger a little further along each time: a new body, and so a new skin, at every frame.
    const frame = { ...base, objects: base.objects.map((o) => (o.id === 'finger' ? { ...o, pos: [i * 0.01, 0, 0] as [number, number, number] } : o)) };
    panel.sync(frame, 1, VIEW);
  }
  const { worn, kept } = panel.organicTriangles();
  assert.ok(worn > 2000, 'the body is drawn');
  assert.ok(kept <= 3 * 110_000 + worn, `${kept} triangles kept`);
  panel.destroy();
});

test('lumps melt as they always have: the old blob skin lies on the bodies\' field, and no deeper crease is left between lumps', async () => {
  const { blobGeometry, BLOB_CELLS } = await import('../src/overlay/blob.ts');
  const { lumpReach, primDistance } = await import('../src/overlay/organic-field.ts');
  // A fish's body as the model writes one: four lumps along a line, each overlapping the next.
  const pts: Array<[number, number, number]> = [[-1.5, 0, 0], [-0.5, 0, 0], [0.8, 0, 0], [1.8, 0, 0]];
  const sizes: Array<[number, number, number]> = [[1.8, 1.6, 1], [2.2, 1.8, 1.2], [1.8, 1.2, 0.9], [1, 0.6, 0.5]];
  const old = blobGeometry(pts, sizes, 0.5, BLOB_CELLS.high).getAttribute('position');
  const prim: Prim = { kind: 'lumps', lumps: pts.map((c, i) => ({ c, r: [sizes[i]![0] / 2, sizes[i]![1] / 2, sizes[i]![2] / 2] as [number, number, number] })), reach: lumpReach(0.5) };
  let worst = 0;
  for (let i = 0; i < old.count; i++) worst = Math.max(worst, Math.abs(primDistance(prim, old.getX(i), old.getY(i), old.getZ(i))));
  assert.ok(old.count > 1000, 'the old skin is there');
  // (a hard union of the same lumps is some 0.15 away at the necks)
  assert.ok(worst < 0.04, `the old skin's vertices are within ${worst} of the new skin`);
});

test('a hollow body has a lining a wall\'s thickness inside its skin, every vertex of it a real point', () => {
  // Two chambers side by side, as a heart's are, hollow with a wall of 0.15.
  const chamber = (x: number): FieldPart => {
    const prim = lump([1, 1, 1]);
    return { prim, toLocal: new Float64Array([1, 0, 0, -x, 0, 1, 0, 0, 0, 0, 1, 0]), scale: 1, soft: 0.3, wall: 0.15, lo: [x - 1, -1, -1], hi: [x + 1, 1, 1], inside: [x, 0, 0], size: 2 };
  };
  const field = new BodyField([chamber(-0.9), chamber(0.9)]);
  const lining = cutSkin(field, { cell: 0.08, surface: 'lining' });
  assert.ok(lining.position.length / 3 > 1000, 'there is a lining');
  let bad = 0, off = 0;
  for (let i = 0; i < lining.position.length; i += 3) {
    const x = lining.position[i]!, y = lining.position[i + 1]!, z = lining.position[i + 2]!;
    if (!Number.isFinite(x + y + z)) { bad++; continue; }
    // on a ball of radius 0.85 round one of the two centres
    const d = Math.min(Math.hypot(x + 0.9, y, z), Math.hypot(x - 0.9, y, z));
    if (Math.abs(d - 0.85) > 0.02) off++;
  }
  assert.equal(bad, 0, 'no vertex is not a number');
  assert.equal(off, 0, 'every vertex lies a wall inside a chamber');
  // The two cavities stay two: the wall between the chambers is not eaten.
  assert.ok(field.cavity(0, 0, 0) > 0, 'between the chambers is wall');
  assert.ok(field.cavity(-0.9, 0, 0) < 0 && field.cavity(0.9, 0, 0) < 0, 'inside each is cavity');
  // A thin vessel, whose lining lies close under its skin (closer than the mesher's own reach): still every vertex a real point.
  const vessel = part({ kind: 'tube', pts: [[-2, 0, 0], [0, 0.3, 0], [2, 0, 0]], radii: [0.2, 0.2, 0.2] });
  const thin = cutSkin(new BodyField([{ ...vessel, wall: 0.03 }]), { cell: 0.1, surface: 'lining' });
  assert.ok(thin.position.length / 3 > 100, 'the vessel has a lining');
  assert.ok(thin.position.every((v) => Number.isFinite(v)) && thin.normal.every((v) => Number.isFinite(v)), 'and no vertex of it is not a number');
});

test('drawn live, a new skin is cut over several frames: the parts go on as they were until it is whole, then wear what a still gets', () => {
  const steps: Scene['steps'] = [
    { say: 'x', actions: HAND.steps[0]!.actions.slice(0, 2) },
    { say: 'y', actions: HAND.steps[0]!.actions.slice(2) },
  ];
  const palmOnly = frameAt(steps, 0, 99), both = frameAt(steps, 1, 99);
  const key = (id: string): number => both.objects.find((o) => o.id === id)!.key;
  // A slice of no time at all: one step of the cutting a frame, however fast the machine.
  const live = new PanelScene({ tier: 'mid', skinSlice: 0 });
  const geometryOf = (id: string): Mesh['geometry'] => {
    let found: Mesh['geometry'] | undefined;
    live.nodeOf(key(id))!.traverse((o) => { const geo = (o as Mesh).geometry; if (!found && geo?.getAttribute('position')?.count) found = geo; });
    assert.ok(found, `${id} is drawn`);
    return found;
  };
  let now = 0;
  const until = (frame: typeof both, done: () => boolean): number => {
    let frames = 0;
    while (!done() && frames < 5000) { live.sync(frame, 1, { ...VIEW, now }); now += 33; frames++; }
    return frames;
  };
  // The palm alone: its lumps stand in for it while its skin is cut.
  live.sync(palmOnly, 1, { ...VIEW, now });
  assert.equal(live.organicTriangles().worn, 0, 'no skin in the first frame');
  assert.ok(geometryOf('palm').getAttribute('position').count > 50, 'but the palm is drawn');
  const tintOf = (id: string): number[] => {
    let rgb: number[] | undefined;
    live.nodeOf(key(id))!.traverse((o) => { const m = (o as Mesh).material as { color?: { r: number; g: number; b: number } } | undefined; if (!rgb && m?.color) rgb = [m.color.r, m.color.g, m.color.b]; });
    return rgb ?? [];
  };
  assert.ok(tintOf('palm').some((c) => c < 0.99), 'the stand-in is in the colour of the palm');
  assert.ok(until(palmOnly, () => live.organicTriangles().worn > 0) > 3, 'the skin takes several frames');
  // In the very frame the skin is put on, its colour is in its vertices alone: the surface under them is white, not the colour a second time.
  assert.ok(tintOf('palm').every((c) => c === 1), 'no frame is tinted twice');
  const alone = geometryOf('palm'), aloneTriangles = live.organicTriangles().worn;
  // The finger is added: the palm keeps the skin it has, the finger is its own drawn tube, until the skin of the two together is whole.
  live.sync(both, 1, { ...VIEW, now });
  assert.ok(geometryOf('palm') === alone, 'the palm goes on wearing its skin');
  assert.equal(geometryOf('finger').userData.triangles, undefined, 'the finger is its own tube meanwhile');
  assert.equal(live.organicTriangles().worn, aloneTriangles);
  assert.ok(live.fitting, 'and the page is asked to go on drawing');
  assert.ok(until(both, () => geometryOf('palm') !== alone) > 3, 'the new skin takes several frames');
  // What it ends in is what a single still frame is given.
  const still = new PanelScene({ tier: 'mid' });
  still.sync(both, 1, VIEW);
  assert.equal(live.organicTriangles().worn, still.organicTriangles().worn, 'the same skin as a still');
  assert.ok(geometryOf('finger').userData.triangles > 100, 'the finger wears its patch of it');
  live.destroy(); still.destroy();
});

test('the cut faces of two parts side by side on one plane are the whole face between them, triangle for triangle', () => {
  const ballAt = (x: number): FieldPart => ({ prim: lump([1, 1, 1]), toLocal: new Float64Array([1, 0, 0, -x, 0, 1, 0, 0, 0, 0, 1, 0]), scale: 1, soft: 0.3, wall: 0, lo: [x - 1, -1, -1], hi: [x + 1, 1, 1], inside: [x, 0, 0], size: 2 });
  const field = new BodyField([ballAt(-0.7), ballAt(0.7)]);
  const cut = (only?: { lo: number[]; hi: number[] }) => cutFace(field, [0.013, 0.02, 0.1], [1, 0, 0], [0, 1, 0], 0.06, false, undefined, only);
  // A part's share of a face, as the bodies take it: the triangles most of whose corners are its own.
  const share = (face: ReturnType<typeof cut>, p: number): { count: number; area: number } => {
    let count = 0, area = 0;
    for (let t = 0; t < face.index.length; t += 3) {
      const [a, b, c] = [face.index[t]!, face.index[t + 1]!, face.index[t + 2]!];
      if ((face.owner[b] === face.owner[c] ? face.owner[b] : face.owner[a]) !== p) continue;
      const at = (v: number): [number, number] => [face.position[v * 3]!, face.position[v * 3 + 1]!];
      const [pa, pb, pc] = [at(a), at(b), at(c)];
      area += Math.abs((pb[0] - pa[0]) * (pc[1] - pa[1]) - (pc[0] - pa[0]) * (pb[1] - pa[1])) / 2;
      count++;
    }
    return { count, area };
  };
  const whole = cut();
  assert.ok(whole.index.length / 3 > 1000, 'the whole face is there');
  for (const p of [0, 1]) {
    const part = field.parts[p]!, room = 0.3 + 2 * 0.06;
    const own = cut({ lo: part.lo.map((v) => v - room), hi: part.hi.map((v) => v + room) });
    const mine = share(own, p), ofWhole = share(whole, p);
    assert.ok(own.position.length < whole.position.length, 'cut in the part\'s own box, not the whole body\'s');
    assert.equal(mine.count, ofWhole.count, `part ${p}: as many triangles`);
    assert.ok(Math.abs(mine.area - ofWhole.area) < 1e-9, `part ${p}: the same area (${mine.area} against ${ofWhole.area})`);
  }
  // A box the plane does not pass through has no face.
  assert.equal(cut({ lo: [-1, -1, 0.5], hi: [1, 1, 1] }).index.length, 0);
});

test('a scene laid out anew (as a seek does for every frame) is the same bodies: no skin is cut twice', () => {
  const panel = new PanelScene({ tier: 'mid' });
  panel.sync(frameAt(HAND.steps, 0, 99), 1, VIEW);
  const first = panel.organicTriangles();
  for (let i = 0; i < 3; i++) panel.sync(frameAt(structuredClone(HAND.steps), 0, 99), 1, VIEW);
  const after = panel.organicTriangles();
  assert.ok(first.worn > 2000, 'the body is drawn');
  assert.equal(after.worn, first.worn, 'the same skin is worn');
  assert.equal(after.kept, first.kept, 'and no other was cut');
  panel.destroy();
});

test('a part that gains its own colours is drawn by the program its surface already has: every surface reads vertex colours, white where a geometry has none', async () => {
  const { SURFACE_NAMES, TIERS, makeSurface } = await import('../src/overlay/materials.ts');
  for (const name of SURFACE_NAMES) {
    const surface = makeSurface(name, TIERS.mid) as ReturnType<typeof makeSurface> & { defaultAttributeValues?: { color?: number[] } };
    assert.ok(surface.vertexColors, `${name} reads vertex colours from the start`);
    assert.ok(surface.defaultAttributeValues?.color?.every((c) => c === 1) && surface.defaultAttributeValues.color.length === 3, `${name}: white where the geometry has none`);
  }
});
