import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { InstancedMesh } from 'three';
import { Object3D } from 'three';
import type { BufferGeometry, Mesh } from 'three';
import { DETAIL } from '../src/overlay/geometry.ts';
import { roundOf } from '../src/overlay/connector.ts';
import { mechanismColor } from '../src/overlay/part-colors.ts';
import { buildPart } from '../src/overlay/parts.ts';
import { KIT_PRESETS, kitParts } from '../src/scene/kit-presets.ts';
import { OTHER_PARTS, partGuide, partNames, resolvePartName } from '../src/scene/part-library.ts';
import { resolvePartGeometry } from '../src/scene/part-geometry.ts';
import { createSceneState, sceneGuide, validateStep } from '../src/scene/index.ts';
import { PARTS } from '../src/scene/spec.ts';
import type { AddPart, Vec3 } from '../src/scene/types.ts';

// The twelve parts added as rows after the first thirteen (pulley, sprocket, bevel gear, rack, shaft, frame plate, turbine, coil, magnet, ramp, fulcrum, bolt):
// what each builds is recorded here (the first thirteen are recorded by kit-parts-golden.test.ts, untouched), its points are named and sit where its box says,
// a part's name is read like a material's, and the thirteen first parts keep the colours they had. To record again after a change that is meant:
// KIT_NEW_WRITE=1 node --test test/kit-new-parts.test.ts

const FIXTURE = new URL('./fixtures/kit-new-parts-golden.json', import.meta.url);
const NEW = ['pulley', 'sprocket', 'bevel-gear', 'rack', 'shaft', 'frame-plate', 'turbine', 'coil', 'magnet', 'ramp', 'fulcrum', 'bolt'];
const OLD = ['cylinder-block', 'piston', 'connecting-rod', 'crankshaft', 'valve', 'camshaft', 'spark-plug', 'gear', 'spring', 'bearing', 'pipe', 'elbow', 'housing'];

type Def = Omit<AddPart, 'op' | 'shape' | 'id'>;
const part = (p: string, size: Vec3, extra: object = {}): Def => ({ part: p as AddPart['part'], size, ...extra }) as Def;
const sets: Array<[string, Def]> = [];
const add = (label: string, def: Def) => sets.push([label, def]);
for (const size of [[3, 3, 0.8], [2, 2.5, 0.5], [4, 3, 1]] as Vec3[]) { add(`pulley ${size}`, part('pulley', size)); add(`pulley block ${size}`, part('pulley', size, { variant: 'block' })); }
for (const n of [undefined, 3, 6, 16, 60, 200]) for (const size of [[3, 3, 0.6], [2, 2, 1]] as Vec3[]) add(`sprocket n${n} ${size}`, part('sprocket', size, n === undefined ? {} : { n }));
for (const n of [undefined, 3, 6, 12, 36, 80]) for (const size of [[3, 3, 1.2], [2, 2, 0.8]] as Vec3[]) add(`bevel-gear n${n} ${size}`, part('bevel-gear', size, n === undefined ? {} : { n }));
for (const n of [undefined, 1, 10, 30]) for (const size of [[5, 1, 0.8], [3, 0.6, 0.5]] as Vec3[]) add(`rack n${n} ${size}`, part('rack', size, n === undefined ? {} : { n }));
for (const n of [undefined, 0, 2, 6]) for (const size of [[0.5, 0.5, 5], [0.8, 0.8, 3]] as Vec3[]) add(`shaft n${n} ${size}`, part('shaft', size, n === undefined ? {} : { n }));
for (const n of [undefined, 1, 3, 8]) for (const size of [[5, 2.5, 0.3], [4, 3, 0.5]] as Vec3[]) add(`frame-plate n${n} ${size}`, part('frame-plate', size, n === undefined ? {} : { n }));
for (const n of [undefined, 3, 14, 40]) for (const size of [[3, 3, 0.7], [2, 2, 1]] as Vec3[]) { add(`turbine n${n} ${size}`, part('turbine', size, n === undefined ? {} : { n })); add(`turbine ducted n${n} ${size}`, part('turbine', size, { variant: 'ducted', ...(n === undefined ? {} : { n }) })); }
for (const n of [undefined, 1, 12, 40]) for (const size of [[1.6, 3, 1.6], [1, 2, 1]] as Vec3[]) add(`coil n${n} ${size}`, part('coil', size, n === undefined ? {} : { n }));
for (const size of [[1, 3.5, 0.8], [0.6, 2, 0.6]] as Vec3[]) add(`magnet ${size}`, part('magnet', size));
for (const size of [[4, 2, 1.2], [3, 3, 1]] as Vec3[]) add(`ramp ${size}`, part('ramp', size));
for (const size of [[2, 2.4, 0.6], [1, 1, 1]] as Vec3[]) add(`fulcrum ${size}`, part('fulcrum', size));
for (const n of [undefined, 2, 8, 20]) for (const size of [[0.8, 3, 0.8], [0.4, 1.5, 0.4]] as Vec3[]) add(`bolt n${n} ${size}`, part('bolt', size, n === undefined ? {} : { n }));

const round = (v: number, d = 5) => Math.round(v * 10 ** d) + 0;
const attr = (g: BufferGeometry, name: string): number[] => { const a = g.getAttribute(name); return a ? Array.from(a.array as ArrayLike<number>, (v) => round(v)) : []; };
const digest = (g: BufferGeometry): string => createHash('sha1').update(JSON.stringify([attr(g, 'position'), attr(g, 'normal'), g.index ? Array.from(g.index.array) : []])).digest('hex').slice(0, 16);

function record(def: Def, level: 'low' | 'mid' | 'high') {
  const built = buildPart({ op: 'add', shape: 'part', id: 'p', ...def } as AddPart, DETAIL[level]);
  built.root.updateMatrixWorld(true);
  return {
    anchors: Object.fromEntries(Object.entries(built.anchors).sort().map(([k, v]) => [k, v.map((x) => round(x, 6))])),
    pieces: built.pieces.map((p) => {
      const o = p.object as Mesh | InstancedMesh;
      return [
        p.surface, p.tint, p.color ?? null, p.edges, p.closed ?? true, o.parent === built.root ? 'root' : 'nested',
        o.position.toArray().map((x) => round(x, 6)), [o.rotation.x, o.rotation.y, o.rotation.z].map((x) => round(x, 6)), o.scale.toArray().map((x) => round(x, 6)),
        digest(o.geometry), (o as InstancedMesh).isInstancedMesh ? [(o as InstancedMesh).count, createHash('sha1').update(JSON.stringify(Array.from((o as InstancedMesh).instanceMatrix.array, (v) => round(v)))).digest('hex').slice(0, 12)] : 0,
      ];
    }),
  };
}

const levels: Array<'low' | 'mid' | 'high'> = ['low', 'mid', 'high'];
const all: Record<string, unknown> = {};
for (const [label, def] of sets) for (const level of levels) all[`${label} ${level}`] = record(def, level);

test('the added parts build exactly what was recorded, part by part', () => {
  if (process.env.KIT_NEW_WRITE) { writeFileSync(FIXTURE, JSON.stringify(all, null, 0) + '\n'); return; }
  const golden = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
  assert.deepEqual(Object.keys(all), Object.keys(golden), 'the same configurations');
  const bad = Object.keys(all).filter((k) => JSON.stringify(all[k]) !== JSON.stringify(golden[k]));
  assert.deepEqual(bad, [], `${bad.length} of ${Object.keys(all).length} configurations differ`);
});

test('the added parts are the table\'s last twelve rows, each a part of the language and each recorded', () => {
  assert.deepEqual(kitParts().slice(13), NEW);
  assert.deepEqual(kitParts().slice(0, 13), OLD);
  for (const p of NEW) { assert.ok(PARTS.includes(p as never), `${p} is a part`); assert.ok(sets.some(([label]) => label.startsWith(p)), `${p} is recorded`); }
});

const POINTS: Record<string, string[]> = {
  pulley: ['axis', 'hook'], sprocket: ['axis'], 'bevel-gear': ['axis'], rack: ['start', 'end', 'teeth'], shaft: ['axis-front', 'axis-rear'],
  'frame-plate': ['front', 'back', 'hole1', 'hole2', 'hole3'], turbine: ['axis'], coil: ['top', 'bottom'], magnet: ['north', 'south'], ramp: ['foot', 'crest', 'slope'],
  fulcrum: ['pivot', 'base'], bolt: ['head', 'tip'],
};

test('each added part names its points, they sit inside its fitted box, and each builds pieces at every size and level', () => {
  for (const p of NEW) {
    for (const size of [[1, 1, 1], [2, 3, 2.5], [4, 1, 0.5]] as Vec3[]) {
      const { size: fitted, anchors } = resolvePartGeometry({ part: p, size } as AddPart);
      assert.ok(fitted.every((v) => Number.isFinite(v) && v > 0), `${p} ${size}`);
      assert.deepEqual(Object.keys(anchors).sort(), ['origin', ...POINTS[p]!].sort(), `${p} points`);
      for (const [name, at] of Object.entries(anchors)) {
        assert.ok(at.every(Number.isFinite), `${p}.${name}`);
        // the block's eye (the pulley's hook) hangs above the wheel, beyond the box, by design: about two radii up
        at.forEach((v, i) => assert.ok(Math.abs(v) <= (p === 'pulley' && name === 'hook' && i === 1 ? fitted[0]! * 1.1 : fitted[i]! / 2) + 1e-9, `${p}.${name} is inside the box (${fitted}) on axis ${i}: ${v}`));
      }
      for (const level of levels) {
        const built = buildPart({ op: 'add', shape: 'part', id: 'p', part: p, size } as AddPart, DETAIL[level]);
        assert.ok(built.pieces.length > 0, `${p} ${size} ${level} builds`);
        assert.deepEqual(Object.keys(built.anchors).sort(), ['origin', ...POINTS[p]!].sort(), `${p} built points`);
      }
    }
  }
});

test('counts and variants change the piece or its teeth, held between the row\'s limits', () => {
  const pieces = (p: string, extra: object) => buildPart({ op: 'add', shape: 'part', id: 'p', part: p, size: p === 'rack' ? [5, 1, 0.8] : [3, 3, 1], ...extra } as AddPart, DETAIL.mid);
  const digestOf = (p: string, extra: object) => pieces(p, extra).pieces.map((x) => digest((x.object as Mesh).geometry)).join();
  assert.notEqual(digestOf('sprocket', { n: 8 }), digestOf('sprocket', { n: 24 }));
  assert.equal(digestOf('sprocket', { n: 2 }), digestOf('sprocket', { n: 6 }), 'below the least, the least');
  assert.equal(digestOf('sprocket', { n: 500 }), digestOf('sprocket', { n: 60 }), 'above the most, the most');
  assert.notEqual(digestOf('rack', { n: 4 }), digestOf('rack', { n: 12 }));
  assert.ok(pieces('pulley', { variant: 'block' }).pieces.length > pieces('pulley', {}).pieces.length, 'the block adds its cheeks and hook');
  assert.ok(pieces('turbine', { variant: 'ducted' }).pieces.length > pieces('turbine', {}).pieces.length, 'the duct adds its ring');
  assert.ok(pieces('frame-plate', { n: 6 }).anchors.hole6, 'a hole is a point');
  assert.equal(pieces('frame-plate', { n: 50 }).anchors.hole9, undefined, 'at most eight holes');
});

test('the copper of a coil and the poles of a magnet are coloured parts of the one piece, the rest take the part\'s tint', () => {
  const colours = (p: string) => new Set(buildPart({ op: 'add', shape: 'part', id: 'p', part: p, size: [1, 3, 1] } as AddPart, DETAIL.mid).pieces.map((x) => JSON.stringify(x.color ?? null)));
  assert.ok(colours('coil').has('[184,115,51]'), 'copper');
  assert.ok(colours('magnet').has('[208,54,54]') && colours('magnet').has('[52,92,208]'), 'north red, south blue');
});

test('a disc part (gear, bearing, pulley, sprocket, bevel gear, turbine) is round about z, from its row; a rack or a shaft is not', () => {
  for (const p of ['gear', 'bearing', 'pulley', 'sprocket', 'bevel-gear', 'turbine']) {
    const round = roundOf({ shape: 'part', part: p, size: [3, 2, 0.8] }, new Object3D());
    assert.ok(round, `${p} is round`);
    assert.deepEqual(round.axis.toArray().map((v) => Math.abs(Math.round(v))), [0, 0, 1], `${p} turns about z`);
    assert.ok(round.radius > 0 && round.width > 0, p);
  }
  for (const p of ['rack', 'shaft', 'coil', 'magnet', 'ramp', 'fulcrum', 'bolt', 'frame-plate', 'piston']) assert.equal(roundOf({ shape: 'part', part: p, size: [3, 2, 0.8] }, new Object3D()), undefined, p);
});

test('the first thirteen parts keep the colours they had before the colour moved into their rows', () => {
  const was: Record<string, number[]> = {
    'cylinder-block': [132, 142, 158], piston: [200, 206, 216], 'connecting-rod': [168, 174, 186], crankshaft: [108, 114, 128], valve: [190, 196, 206], camshaft: [140, 146, 158],
    'spark-plug': [176, 182, 194], gear: [190, 170, 120], spring: [150, 156, 168], bearing: [160, 166, 178], pipe: [150, 158, 172], elbow: [150, 158, 172], housing: [112, 124, 144],
  };
  for (const p of OLD) assert.deepEqual(mechanismColor(p), was[p], p);
  assert.equal(mechanismColor('chip'), undefined);
  assert.equal(mechanismColor('constructor'), undefined);
  for (const p of NEW) assert.ok(mechanismColor(p), `${p} has a colour`);
});

test('a part name is read like a material name: its own, another it is known by, or one slip away (with a note), else refused with the nearest', () => {
  const run = (name: unknown) => validateStep({ say: 'x', actions: [{ op: 'add', shape: 'part', id: 'a', part: name, size: [2, 2, 1] }] }, createSceneState());
  const partOf = (r: ReturnType<typeof run>) => (r.step!.actions[0] as { part?: string }).part;
  const own = run('pulley');
  assert.deepEqual(own.issues, []);
  assert.equal(partOf(own), 'pulley');
  assert.equal(partOf(run('bevel gear')), 'bevel-gear', 'a space for the hyphen');
  assert.deepEqual(run('Gear').issues, [], 'any case');
  const alias = run('sheave');
  assert.equal(partOf(alias), 'pulley');
  assert.ok(alias.issues.some((i) => /part "sheave" read as pulley/.test(i.message)), JSON.stringify(alias.issues));
  const slip = run('sprochet');
  assert.equal(partOf(slip), 'sprocket');
  assert.ok(slip.issues.some((i) => /part "sprochet" read as sprocket/.test(i.message)), JSON.stringify(slip.issues));
  const bad = run('zzzzqq');
  assert.ok(!bad.step || !bad.step.actions.length);
  assert.ok(bad.issues.some((i) => /unknown part "zzzzqq"/.test(i.message) && /the parts are/.test(i.message) && /bevel-gear/.test(i.message)), JSON.stringify(bad.issues));
  assert.equal(resolvePartName('constructor').name, undefined);
  assert.equal(resolvePartName('__proto__').name, undefined);
  assert.equal(resolvePartName(7).name, undefined);
});

test('the part names are the others then the kit table\'s, with no name twice, and the guide lists every one of them and stays inside its size', () => {
  const names = partNames();
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names, [...OTHER_PARTS, ...kitParts()]);
  assert.deepEqual([...PARTS].sort(), [...names].sort(), 'the language has exactly these parts');
  const guide = partGuide();
  for (const n of names) assert.ok(guide.includes(n), `${n} is in the guide`);
  assert.ok(sceneGuide.includes(guide), 'the guide holds the generated list');
  assert.ok(sceneGuide.length <= 44800, `the guide is ${sceneGuide.length}`);
});
