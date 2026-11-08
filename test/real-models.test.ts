import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BoxGeometry } from 'three';
import type { BufferGeometry, Mesh } from 'three';
import { createSceneState, validateScene } from '../src/scene/index.ts';
import type { Scene } from '../src/scene/index.ts';
import { MODELS } from '../src/scene/model-catalogue.ts';
import type { ModelEntry } from '../src/scene/model-catalogue.ts';
import { modelScale } from '../src/scene/models.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { createModelStore, creditLine, externalReference, modelsIn } from '../src/overlay/model-assets.ts';
import type { ModelState, ModelStore } from '../src/overlay/model-assets.ts';
import { frameAt } from '../src/overlay/timeline.ts';
// @ts-expect-error plain script modules
import { writeGlb, parseObj } from '../scripts/assets/obj-glb.mjs';
// @ts-expect-error plain script modules
import { generate } from '../scripts/assets/index.mjs';
// @ts-expect-error plain script modules
import { shipModels } from '../scripts/assets/ship.mjs';

const heart = MODELS.find((m) => m.id === 'heart')!;
const validated = (raw: unknown, state = createSceneState()): Scene => {
  const r = validateScene(raw, state);
  assert.ok(r.scene, JSON.stringify(r.issues));
  return r.scene;
};
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const ab = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

// ---- the planner ------------------------------------------------------------------------------------

test('a model becomes a group with each named part under it, at the part\'s place in the model and the model\'s scale', () => {
  const scene = validated({ steps: [{ say: 'A heart.', actions: [{ op: 'panel', x: 400, y: 80, w: 500, h: 700 }, { op: 'add', shape: 'model', id: 'h', model: 'heart', size: 6 }] }] });
  const frame = frameAt(scene.steps, 0, 2);
  const group = frame.objects.find((o) => o.id === 'h')!;
  assert.equal(group.shape, 'model');
  const scale = modelScale(heart, 6);
  const parts = frame.objects.filter((o) => o.parentKey === group.key);
  assert.equal(parts.length, heart.parts.length);
  for (const p of heart.parts) {
    const o = parts.find((x) => x.id === `h.${p.key}`);
    assert.ok(o, `h.${p.key} exists`);
    assert.equal(o.shape, 'meshpart');
    p.center.forEach((c, i) => assert.ok(Math.abs(o.pos[i]! - c * scale) < 1e-9, `${p.key} sits at its centre ${i}`));
    assert.deepEqual(o.color, p.color);
  }
});

test('a model written again replaces it: the old parts go, the new model\'s parts are the ones alive', () => {
  const state = createSceneState();
  const first = validated({ steps: [{ say: 'Brain.', actions: [{ op: 'panel', x: 400, y: 80, w: 500, h: 700 }, { op: 'add', shape: 'model', id: 'x', model: 'brain' }] }] }, state);
  (state as { replaceable?: Set<string> }).replaceable = new Set(state.ids.keys());
  const second = validated({ steps: [{ say: 'Heart.', actions: [{ op: 'add', shape: 'model', id: 'x', model: 'heart' }] }] }, state);
  const frame = frameAt([...first.steps, ...second.steps], 1, 5);
  const ids = frame.objects.map((o) => o.id);
  assert.ok(ids.includes('x.left-ventricle') && !ids.includes('x.cerebellum'), ids.join(' '));
});

// ---- the renderer ------------------------------------------------------------------------------------

function fakeStore(initial: ModelState): ModelStore & { set(s: ModelState): void } {
  let state = initial;
  return {
    set: (s) => { state = s; },
    state: () => state,
    ensure: async () => {},
    failure: () => undefined,
    geometry: (_m, _p) => (state === 'ready' ? new BoxGeometry(0.02, 0.04, 0.01) : undefined),
  };
}

test('a part waits for its file and is built when it arrives; a model that failed leaves its parts empty and the scene plays on', () => {
  const scene = validated({ steps: [{ say: 'A heart.', actions: [{ op: 'panel', x: 400, y: 80, w: 500, h: 700 }, { op: 'add', shape: 'model', id: 'h', model: 'heart', size: 6 }] }] });
  const frame = frameAt(scene.steps, 0, 2);
  const key = frame.objects.find((o) => o.id === 'h.left-ventricle')!.key;
  const store = fakeStore('loading');
  const panel = new PanelScene({ tier: 'low', models: store });
  panel.sync(frame, 1);
  assert.equal(panel.nodeOf(key)!.children.length, 0, 'nothing drawn yet');
  store.set('ready');
  panel.sync(frame, 1);
  const node = panel.nodeOf(key)!;
  const mesh = node as Mesh;
  assert.ok(mesh.isMesh, 'drawn once the file is in');
  // at the model's scale: the 0.02 x 0.04 x 0.01 metre box is that many scene units times the scale
  mesh.geometry.computeBoundingBox();
  const size = mesh.geometry.boundingBox!.getSize(new (mesh.position.constructor as new () => import('three').Vector3)());
  const scale = modelScale(heart, 6);
  assert.ok(Math.abs(size.y - 0.04 * scale) < 1e-6, `scaled by ${scale}: ${size.y}`);

  const failed = fakeStore('failed');
  const other = new PanelScene({ tier: 'low', models: failed });
  other.sync(frame, 1);
  other.sync(frame, 1);
  assert.equal(other.nodeOf(key)!.children.length, 0);
  assert.ok(!(other.nodeOf(key) as Mesh).isMesh);
  // with no store at all (a page that cannot load files) it is the same: empty parts, no throw
  const none = new PanelScene({ tier: 'low' });
  none.sync(frame, 1);
  assert.ok(!(none.nodeOf(key) as Mesh).isMesh);
});

// ---- the store ---------------------------------------------------------------------------------------

const TETRA = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4\n';
function fakeModel(): { entry: ModelEntry; bytes: Buffer } {
  const a = parseObj(TETRA);
  const bytes = writeGlb('thing', [{ key: 'a', positions: a.positions, indices: a.indices, files: ['F1'], confidence: 'atlas' }, { key: 'b', positions: a.positions, indices: a.indices, files: ['F2'], confidence: 'atlas' }]) as Buffer;
  const part = (key: string) => ({ key, name: key, aliases: [], confidence: 'atlas' as const, color: [1, 2, 3] as [number, number, number], closed: true, center: [0.25, 0.25, 0.25] as [number, number, number], size: [1, 1, 1] as [number, number, number], triangles: 4 });
  const entry: ModelEntry = { ...heart, id: 'thing', name: 'Thing', aliases: [], size: [1, 1, 1], parts: [part('a'), part('b')], built: { file: 'thing.glb', bytes: bytes.length, sha256: sha(bytes), triangles: 8 } };
  return { entry, bytes };
}

test('the store loads a model, keeps its named parts centred on themselves, and tells when it is ready', async () => {
  const { entry, bytes } = fakeModel();
  let changed = 0;
  const store = createModelStore({ read: async () => ab(bytes), catalogue: [entry], changed: () => { changed++; } });
  assert.equal(store.state('thing'), 'idle');
  const loading = store.ensure(['thing', 'nothing']);
  assert.equal(store.state('thing'), 'loading');
  await loading;
  assert.equal(store.state('thing'), 'ready');
  assert.equal(changed, 1);
  const g = store.geometry('thing', 'a') as BufferGeometry;
  g.computeBoundingBox();
  assert.ok(g.boundingBox!.getCenter(new (g.boundingBox!.min.constructor as new () => import('three').Vector3)()).length() < 1e-5);
  assert.equal(store.geometry('thing', 'zzz'), undefined);
  await store.ensure(['thing']);
  assert.equal(changed, 1, 'loaded once');
});

test('the store refuses a file that is not the one the catalogue pins, or that reaches outside itself, and never rejects', async () => {
  const { entry, bytes } = fakeModel();
  const tampered = Buffer.from(bytes);
  tampered[tampered.length - 5] = (tampered[tampered.length - 5] ?? 0) ^ 0xff;
  const run = async (data: Buffer, pinned: ModelEntry = entry) => {
    const store = createModelStore({ read: async () => ab(data), catalogue: [pinned] });
    await store.ensure(['thing']);
    return { state: store.state('thing'), why: store.failure('thing') ?? '' };
  };
  const changedBytes = await run(tampered);
  assert.equal(changedBytes.state, 'failed');
  assert.match(changedBytes.why, /hash differs/);
  const short = await run(bytes.subarray(0, bytes.length - 4));
  assert.match(short.why, /bytes/);
  // a file pinned by its hash that carries a uri (a buffer fetched from elsewhere) is refused too
  const json = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'https://example.invalid/x.bin', byteLength: 4 }] });
  const pad = Buffer.from(json + ' '.repeat((4 - (json.length % 4)) % 4));
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + pad.length, 8); head.writeUInt32LE(pad.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  const evil = Buffer.concat([head, pad, Buffer.alloc(8)]);
  const pinned = { ...entry, built: { ...entry.built, bytes: evil.length, sha256: sha(evil) } };
  const refused = await run(evil, pinned);
  assert.equal(refused.state, 'failed');
  assert.match(refused.why, /uri/);
  // a pinned file that lacks a part the catalogue names
  const lacking = await run(bytes, { ...entry, parts: [...entry.parts, { ...entry.parts[0]!, key: 'c' }] });
  assert.match(lacking.why, /lacks parts: c/);
  // a read that throws
  const store = createModelStore({ read: async () => { throw new Error('no file'); }, catalogue: [entry] });
  await store.ensure(['thing']);
  assert.equal(store.state('thing'), 'failed');
  assert.deepEqual(externalReference({ buffers: [{ byteLength: 4 }] }), undefined);
  assert.match(externalReference({ images: [{ uri: 'data:image/png;base64,AA' }] }) ?? '', /images/);
});

test('which models a scene uses, and the credit line it owes', () => {
  const scene = validated({ steps: [{ say: 'Two.', actions: [{ op: 'panel', x: 0, y: 0, w: 500, h: 700 }, { op: 'add', shape: 'model', id: 'h', model: 'human heart' }, { op: 'add', shape: 'model', id: 'b', model: 'brain' }] }] });
  assert.deepEqual(modelsIn(scene).sort(), ['brain', 'heart']);
  assert.deepEqual(modelsIn({ steps: [{ actions: [{ op: 'add', shape: 'box', id: 'x' }] }] }), []);
  const line = creditLine(frameAt(scene.steps, 0, 2).objects);
  assert.match(line, /BodyParts3D/);
  assert.match(line, /CC Attribution 4\.0/);
  assert.ok(!/https?:/.test(line), 'the short form carries no address');
  assert.equal(line.split(' · ').length, 2, 'one per model');
  assert.equal(creditLine([{ def: { shape: 'box' } }]), '');
});

// ---- the files ---------------------------------------------------------------------------------------

test('the catalogue and the credits file are what the manifests say', () => {
  const out = generate();
  const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(read(join(import.meta.dirname, '..', 'src', 'scene', 'model-catalogue.ts')), out.catalogue, 'run npm run assets:index');
  assert.equal(read(join(import.meta.dirname, '..', 'assets', 'CREDITS.md')), out.credits, 'run npm run assets:index');
  assert.match(out.credits, /CC BY 4\.0/);
});

const built = existsSync(join(import.meta.dirname, '..', 'assets', 'built', 'heart.glb'));
test('the real built models load in three\'s own loader, with every named part and the sizes the catalogue says', { skip: built ? false : 'run npm run assets first' }, async () => {
  const store = createModelStore({ read: async (file) => ab(readFileSync(join(import.meta.dirname, '..', 'assets', 'built', file))) });
  await store.ensure(MODELS.map((m) => m.id));
  for (const m of MODELS) {
    assert.equal(store.state(m.id), 'ready', `${m.id}: ${store.failure(m.id)}`);
    let triangles = 0;
    for (const p of m.parts) {
      const g = store.geometry(m.id, p.key)!;
      g.computeBoundingBox();
      const size = g.boundingBox!.getSize(new (g.boundingBox!.min.constructor as new () => import('three').Vector3)());
      p.size.forEach((s, i) => assert.ok(Math.abs(size.toArray()[i]! - s) < 1e-5 + s * 1e-3, `${m.id}.${p.key} axis ${i}: ${size.toArray()[i]} vs ${s}`));
      triangles += (g.index?.count ?? 0) / 3;
    }
    assert.equal(triangles, m.built.triangles, `${m.id} triangles`);
  }
});

test('shipping puts only the files the manifests pin next to the app, and the credits', { skip: built ? false : 'run npm run assets first' }, () => {
  const out = mkdtempSync(join(tmpdir(), 'tt-ship-'));
  try {
    const r = shipModels({ out });
    assert.deepEqual([...r.shipped].sort(), MODELS.map((m) => m.id).sort());
    assert.deepEqual(readdirSync(join(out, 'models')).sort(), MODELS.map((m) => m.built.file).sort());
    assert.ok(existsSync(join(out, 'CREDITS.md')));
    for (const m of MODELS) assert.equal(sha(readFileSync(join(out, 'models', m.built.file))), m.built.sha256);
  } finally { rmSync(out, { recursive: true, force: true }); }
});
