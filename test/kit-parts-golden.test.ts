import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { InstancedMesh } from 'three';
import type { BufferGeometry, Mesh } from 'three';
import { DETAIL } from '../src/overlay/geometry.ts';
import { buildPart } from '../src/overlay/parts.ts';
import { kitParts } from '../src/scene/kit-presets.ts';
import { PARTS } from '../src/scene/spec.ts';
import type { AddPart, Vec3 } from '../src/scene/types.ts';

// The mechanism kit, recorded before its builders became rows of a table: for every part, at several sizes, counts, variants and levels of detail, what is
// built (every piece's surface, tint, colour, edge flag, whether a cut caps it, its place, and a digest of its mesh) and the named points it offers.
// The table that builds the parts now must reproduce all of it. To record again after a change that is meant (never to make a failure go away):
// KIT_GOLDEN_WRITE=1 node --test test/kit-parts-golden.test.ts

const FIXTURE = new URL('./fixtures/kit-parts-golden.json', import.meta.url);

type Config = { name: string; def: Omit<AddPart, 'op' | 'shape' | 'id'>; levels?: Array<'low' | 'mid' | 'high'> };
const part = (p: string, size: Vec3, extra: object = {}): Config['def'] => ({ part: p as AddPart['part'], size, ...extra }) as Config['def'];
const sets: Array<[string, Config['def']]> = [];
const add = (label: string, def: Config['def']) => sets.push([label, def]);
for (const size of [[3, 4, 3], [2, 5, 2.5], [4, 2, 3]] as Vec3[]) {
  add(`cylinder-block ${size}`, part('cylinder-block', size));
  add(`cylinder-block cutaway ${size}`, part('cylinder-block', size, { variant: 'cutaway' }));
  add(`cylinder-block finned ${size}`, part('cylinder-block', size, { variant: 'finned' }));
  add(`cylinder-block finned n3 ${size}`, part('cylinder-block', size, { variant: 'finned', n: 3 }));
}
for (const size of [[1, 1, 1], [2, 2, 2], [2, 3, 2.4], [1, 0.4, 1.5]] as Vec3[]) add(`piston ${size}`, part('piston', size));
for (const size of [[0.8, 4, 0.5], [1, 3, 0.6], [3, 1, 0.5], [0.5, 0.5, 4]] as Vec3[]) add(`connecting-rod ${size}`, part('connecting-rod', size));
for (const n of [undefined, 1, 2, 4, 8, 12]) for (const size of [[4, 4, 2], [3, 5, 6]] as Vec3[]) add(`crankshaft n${n} ${size}`, part('crankshaft', size, n === undefined ? {} : { n }));
for (const size of [[0.5, 3, 0.5], [0.6, 2, 0.6], [3, 0.5, 0.5], [1, 1, 1]] as Vec3[]) { add(`valve ${size}`, part('valve', size)); add(`spark-plug ${size}`, part('spark-plug', size)); }
for (const n of [undefined, 1, 4, 12, 20]) for (const size of [[3, 1, 1], [1, 1, 4], [2, 2, 2]] as Vec3[]) add(`camshaft n${n} ${size}`, part('camshaft', size, n === undefined ? {} : { n }));
for (const n of [undefined, 3, 6, 13, 14, 16, 40, 41, 120, 200]) for (const size of [[3, 3, 0.6], [2, 2, 1], [0.5, 3, 3]] as Vec3[]) add(`gear n${n} ${size}`, part('gear', size, n === undefined ? {} : { n }));
for (const n of [undefined, 1, 2, 8, 40, 60]) for (const size of [[1, 3, 1], [2, 4, 2], [3, 1, 3]] as Vec3[]) add(`spring n${n} ${size}`, part('spring', size, n === undefined ? {} : { n }));
for (const n of [undefined, 3, 5, 9, 16, 30]) for (const size of [[3, 3, 0.8], [2, 1, 2]] as Vec3[]) add(`bearing n${n} ${size}`, part('bearing', size, n === undefined ? {} : { n }));
for (const size of [[1, 4, 1], [1.5, 2, 1.5], [4, 1, 1]] as Vec3[]) add(`pipe ${size}`, part('pipe', size));
for (const size of [[2, 2, 0.6], [3, 2, 1], [2, 3, 3], [1, 1, 1]] as Vec3[]) add(`elbow ${size}`, part('elbow', size));
for (const size of [[3, 2, 2], [2, 2, 2], [5, 1, 3]] as Vec3[]) { add(`housing ${size}`, part('housing', size)); add(`housing cutaway ${size}`, part('housing', size, { variant: 'cutaway' })); }

const round = (v: number, d = 5) => Math.round(v * 10 ** d) + 0;
const attr = (g: BufferGeometry, name: string): number[] => { const a = g.getAttribute(name); return a ? Array.from(a.array as ArrayLike<number>, (v) => round(v)) : []; };
const digest = (g: BufferGeometry): string => createHash('sha1').update(JSON.stringify([attr(g, 'position'), attr(g, 'normal'), g.index ? Array.from(g.index.array) : []])).digest('hex').slice(0, 16);

function record(def: Config['def'], level: 'low' | 'mid' | 'high') {
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

test('the mechanism kit builds exactly what was recorded, part by part', () => {
  if (process.env.KIT_GOLDEN_WRITE) { writeFileSync(FIXTURE, JSON.stringify(all, null, 0) + '\n'); return; }
  const golden = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
  assert.deepEqual(Object.keys(all), Object.keys(golden), 'the same configurations');
  const bad = Object.keys(all).filter((k) => JSON.stringify(all[k]) !== JSON.stringify(golden[k]));
  assert.deepEqual(bad, [], `${bad.length} of ${Object.keys(all).length} configurations differ`);
});

test('every kit part in the table is a part of the scene language and is covered by the recording', () => {
  const mechanism = kitParts().slice(0, 13); // the thirteen first rows; the rows added since are recorded in kit-new-parts.test.ts
  for (const p of mechanism) assert.ok(PARTS.includes(p as never), `${p} is a part`);
  for (const p of mechanism) assert.ok(sets.some(([label]) => label.startsWith(p)), `${p} is recorded`);
});
