import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';
import type { Plugin } from 'esbuild';
import { Box3, BoxGeometry, MeshPhysicalMaterial, MeshStandardMaterial, Texture, Vector3 } from 'three';
import { TIERS } from '../src/overlay/materials.ts';
import { modelSurface } from '../src/overlay/model-surface.ts';
import type { BufferGeometry, Mesh } from 'three';
import { createSceneState, sceneGuide, validateScene } from '../src/scene/index.ts';
import type { Scene } from '../src/scene/index.ts';
import { MODELS } from '../src/scene/model-catalogue.ts';
import type { ModelEntry } from '../src/scene/model-catalogue.ts';
import { modelScale } from '../src/scene/models.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { cornerFor, createModelStore, creditLine, externalReference, failedNote, HEAVY_MODEL_TRIANGLES, modelTriangles, modelsIn, takeApartable, withoutFailedModels } from '../src/overlay/model-assets.ts';
import type { ModelState, ModelStore } from '../src/overlay/model-assets.ts';
import { frameAt } from '../src/overlay/timeline.ts';
// @ts-expect-error plain script modules
import { writeGlb, parseObj } from '../scripts/assets/obj-glb.mjs';
// @ts-expect-error plain script modules
import { generate } from '../scripts/assets/index.mjs';
// @ts-expect-error plain script modules
import { manifestProblems, readManifests } from '../scripts/assets/manifest.mjs';
// @ts-expect-error plain script modules
import { shipModels } from '../scripts/assets/ship.mjs';

const heart = MODELS.find((m) => m.id === 'heart')!;
/** The page decodes a texture with the browser's createImageBitmap; Node has none, so a stand-in gives each image a size and nothing else. */
function withImageDecoder<T>(run: () => Promise<T>): Promise<T> {
  const g = globalThis as Record<string, unknown>;
  const before = { createImageBitmap: g.createImageBitmap, self: g.self };
  g.createImageBitmap = async () => ({ width: 8, height: 8, close() {} });
  g.self = globalThis;
  return run().finally(() => { g.createImageBitmap = before.createImageBitmap; if (before.self === undefined) delete g.self; else g.self = before.self; });
}
const anatomy = MODELS.filter((m) => m.format === 'obj');
const objects = MODELS.filter((m) => m.format === 'gltf');
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
    pieces: (_m, _p) => (state === 'ready' ? [{ geometry: new BoxGeometry(0.02, 0.04, 0.01), material: undefined }] : undefined),
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
  await withImageDecoder(() => store.ensure(MODELS.map((m) => m.id)));
  for (const m of MODELS) {
    assert.equal(store.state(m.id), 'ready', `${m.id}: ${store.failure(m.id)}`);
    let triangles = 0;
    for (const p of m.parts) {
      const pieces = store.pieces(m.id, p.key)!;
      assert.ok(pieces.length > 0, `${m.id}.${p.key} has a mesh`);
      const box = new Box3();
      for (const piece of pieces) {
        piece.geometry.computeBoundingBox();
        box.union(piece.geometry.boundingBox!);
        triangles += (piece.geometry.index?.count ?? piece.geometry.getAttribute('position').count) / 3;
        // a textured model keeps the artist's materials; an anatomy part has none of its own
        assert.equal(piece.material !== undefined, m.format === 'gltf', `${m.id}.${p.key} material`);
      }
      const size = box.getSize(new Vector3()).toArray();
      p.size.forEach((s, i) => assert.ok(Math.abs(size[i]! - s) < 1e-5 + s * 1e-3, `${m.id}.${p.key} axis ${i}: ${size[i]} vs ${s}`));
      // centred on the part, so the planner's place for it is the right one
      const middle = box.getCenter(new Vector3()).toArray();
      middle.forEach((c, i) => assert.ok(Math.abs(c) < 1e-5 + p.size[i]! * 1e-3, `${m.id}.${p.key} is centred on itself (axis ${i}: ${c})`));
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

// ---- what the author attached, a model that fails, and where the small print goes ---------------------

test('a model written again keeps what the author attached to it, on the same part when the new model has it and on the model when it has not', () => {
  const state = createSceneState();
  const first = validated({ steps: [{ say: 'Heart.', actions: [{ op: 'panel', x: 400, y: 80, w: 500, h: 700 }, { op: 'add', shape: 'model', id: 'h', model: 'heart', size: 6 },
    { op: 'add', shape: 'box', id: 'tag', size: [0.5, 0.5, 0.5], parent: 'h' }, { op: 'add', shape: 'box', id: 'on', size: [0.5, 0.5, 0.5], parent: 'h.left-ventricle' }] }] }, state);
  (state as { replaceable?: Set<string> }).replaceable = new Set(state.ids.keys());
  const same = validated({ steps: [{ say: 'Heart again.', actions: [{ op: 'add', shape: 'model', id: 'h', model: 'heart', size: 6 }] }] }, state);
  const frame = frameAt([...first.steps, ...same.steps], 1, 5);
  const alive = (id: string) => frame.objects.findLast((o) => o.id === id)!;
  const lv = alive('h.left-ventricle');
  assert.equal(alive('on').parentKey, lv.key, 'still on the left ventricle');
  assert.equal(alive('tag').parentKey, alive('h').key);

  (state as { replaceable?: Set<string> }).replaceable = new Set(state.ids.keys());
  const other = validated({ steps: [{ say: 'Brain.', actions: [{ op: 'add', shape: 'model', id: 'h', model: 'brain', size: 6 }] }] }, state);
  const later = frameAt([...first.steps, ...same.steps, ...other.steps], 2, 5);
  const on = later.objects.findLast((o) => o.id === 'on')!;
  assert.equal(on.parentKey, later.objects.findLast((o) => o.id === 'h')!.key, 'on the model, the brain having no left ventricle');
  const scale = modelScale(heart, 6);
  heart.parts.find((p) => p.key === 'left-ventricle')!.center.forEach((c, i) => assert.ok(Math.abs(on.pos[i]! - c * scale) < 1e-9, 'it stays where it was'));
});

test('a model that cannot be loaded leaves the stage without it and its pins, says so, and logs why once', async () => {
  const scene = validated({ steps: [{ say: 'A heart.', actions: [{ op: 'panel', x: 400, y: 80, w: 500, h: 700 }, { op: 'add', shape: 'model', id: 'h', model: 'heart', size: 6 }, { op: 'add', shape: 'box', id: 'tag', size: [1, 1, 1], parent: 'h' },
    { op: 'add', shape: 'box', id: 'other', size: [1, 1, 1] }, { op: 'pin', id: 'p', on: 'h.left-ventricle', text: 'Left ventricle' }, { op: 'pin', id: 'q', on: 'other', text: 'Other' }] }] });
  const frame = frameAt(scene.steps, 0, 5);
  // a damaged file: the right name, the wrong bytes
  const logged: string[] = [];
  const store = createModelStore({ read: async () => new ArrayBuffer(64), log: (m) => logged.push(m) });
  assert.equal(withoutFailedModels(frame, store).frame, frame, 'nothing changes while it is not failed');
  await store.ensure(['heart']);
  await store.ensure(['heart']);
  assert.equal(store.state('heart'), 'failed');
  assert.equal(logged.length, 1);
  assert.match(logged[0]!, /^model heart failed: .*bytes/);
  const kept = withoutFailedModels(frame, store);
  assert.deepEqual(kept.failed, ['Human heart']);
  const ids = kept.frame.objects.map((o) => o.id);
  assert.deepEqual(ids, ['other'], 'the model, its parts and what hung from it are out');
  assert.deepEqual(kept.frame.marks.map((m) => m.id), ['q'], 'the pin on a part is out, the pin on something else stays');
  assert.match(failedNote(kept.failed), /"Human heart" could not be loaded, so it is not shown/);
  assert.equal(creditLine(kept.frame.objects), '', 'no credit for what is not shown');
});

test('the small print of the stage takes the corner with least in the way, the foot first, keeps it while it is clear, and keeps off the pin tags', () => {
  const stage = { x: 100, y: 100, w: 800, h: 600 };
  const size = { w: 300, h: 40 };
  const xy = (c: { x: number; y: number }) => ({ x: c.x, y: c.y });
  assert.deepEqual(xy(cornerFor(stage, size, [])), { x: 110, y: 650 }, 'the left foot when nothing is in the way');
  // the model fills the left foot: the right foot
  const model = { x: 100, y: 500, w: 400, h: 200 };
  assert.deepEqual(xy(cornerFor(stage, size, [model])), { x: 590, y: 650 });
  // both feet taken: a corner at the top
  assert.deepEqual(xy(cornerFor(stage, size, [{ x: 100, y: 500, w: 800, h: 200 }])), { x: 110, y: 110 });
  // a pin tag in the left foot is as much in the way as the model
  const tag = { x: 150, y: 640, w: 120, h: 40 };
  assert.deepEqual(xy(cornerFor(stage, size, [tag])), { x: 590, y: 650 });
  // it stays where it is while that is clear, and moves when it is not
  const left = cornerFor(stage, size, []);
  assert.equal(left.corner, 0);
  assert.equal(cornerFor(stage, size, [{ x: 700, y: 640, w: 100, h: 40 }], 10, 0).corner, 0, 'a tag at the right foot does not move it from the left');
  assert.equal(cornerFor(stage, size, [tag], 10, 0).corner, 1, 'a tag on it does');
  // everything taken: the one with the least overlap, never outside the stage
  const c = cornerFor(stage, size, [{ x: 100, y: 100, w: 800, h: 600 }]);
  assert.ok(c.x >= stage.x && c.y >= stage.y && c.x + size.w <= stage.x + stage.w && c.y + size.h <= stage.y + stage.h);
  // a note wider than the stage still fits it
  assert.equal(cornerFor({ x: 0, y: 0, w: 200, h: 100 }, { w: 400, h: 20 }, []).x, 10);
});

test('a pin whose model was left out, or whose file has not come yet, is no fault of the pin: nothing is logged for it', () => {
  const scene = validated({ steps: [{ say: 'A heart.', actions: [{ op: 'panel', x: 400, y: 80, w: 500, h: 700 }, { op: 'add', shape: 'model', id: 'h', model: 'heart', size: 6 }, { op: 'pin', id: 'p', on: 'h.left-ventricle', text: 'LV' }] }] });
  const frame = frameAt(scene.steps, 0, 5);
  const key = frame.objects.find((o) => o.id === 'h.left-ventricle')!.key;
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => { warned.push(a.join(' ')); };
  try {
    const waiting = new PanelScene({ tier: 'low', models: fakeStore('loading') });
    waiting.sync(frame, 1);
    assert.equal(waiting.project(key, undefined, 800, 600)?.visible ?? false, false);
    assert.equal(waiting.project(key + 999, undefined, 800, 600), undefined, 'a node that is not there');
    assert.deepEqual(warned, []);
    // a part that is built and cannot be seen is still reported, once
    const plain = new PanelScene({ tier: 'low' });
    const g = validated({ steps: [{ say: 'A box.', actions: [{ op: 'panel', x: 400, y: 80, w: 500, h: 700 }, { op: 'add', shape: 'box', id: 'b', size: [1, 1, 1], opacity: 0 }] }] });
    const f = frameAt(g.steps, 0, 5);
    plain.sync(f, 1);
    plain.project(f.objects.find((o) => o.id === 'b')!.key, undefined, 800, 600);
    assert.equal(warned.length, 1, warned.join('|'));
  } finally { console.warn = warn; }
});

test('BodyParts3D is credited as its current grant says, the older file notice is kept on record, and the prototype is held back from every release', () => {
  const out = generate();
  assert.match(out.credits, /Credit: BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4\.0 International$/m, 'the credit, exactly');
  assert.match(out.credits, /Earlier notice, kept on record: .*CC Attribution-ShareAlike 2\.1 Japan/);
  assert.match(out.credits, /Source archive: https:\/\/dbarchive.*isa_BP3D_4\.0_obj_99\.zip/);
  assert.match(out.credits, /Left ventricle \(atlas; FJ\d+\)/, 'the source element ids of each part');
  assert.match(out.credits, /MIT licence covers that code only: it excludes the models named here/);
  assert.match(out.credits, /Held back from releases/);
  assert.deepEqual(anatomy.map((m) => m.id).sort(), ['brain', 'heart']);
  for (const m of anatomy) {
    assert.equal(m.licence.id, 'CC-BY-4.0');
    assert.equal(m.credit, 'BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International');
    assert.equal(m.release.blocked, true);
  }
  for (const m of objects) {
    assert.equal(m.licence.id, 'CC0-1.0');
    assert.equal(m.credit, undefined, 'CC0 asks for no credit');
    assert.equal(m.release.blocked, false);
  }
  // an earlier notice must say that it is kept
  const manifest = JSON.parse(JSON.stringify(readManifests().find((x: { manifest: { id: string } }) => x.manifest.id === 'heart').manifest));
  assert.deepEqual(manifestProblems(manifest), []);
  manifest.licence.earlierNotice.kept = false;
  assert.match(manifestProblems(manifest).join(';'), /earlier licence notice/);
});

test('a release leaves out what is held (no file, no credits for it, and it says so) and carries the rest', { skip: built ? false : 'run npm run assets first' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tt-rel-'));
  try {
    mkdirSync(join(dir, 'models'));
    writeFileSync(join(dir, 'models', 'heart.glb'), 'an earlier build');
    const r = shipModels({ strict: true, release: true, out: dir });
    assert.deepEqual([...r.dropped].sort(), anatomy.map((m) => m.id).sort());
    assert.deepEqual([...r.shipped].sort(), objects.map((m) => m.id).sort());
    assert.ok(!existsSync(join(dir, 'models', 'heart.glb')) && existsSync(join(dir, 'models', 'drill.glb')), 'the held file is removed, the carried one is there');
    const credits = readFileSync(join(dir, 'CREDITS.md'), 'utf8');
    assert.ok(!credits.includes('BodyParts3D') && credits.includes('Power drill'), 'the credits list only what is carried');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a release builds the app with a catalogue that does not list the held models: no model line in the guide, no model shape, and a scene that asks for one says so', async () => {
  const { build } = await import('esbuild');
  // @ts-expect-error plain script module
  const { releaseCatalogue, releaseSplit } = await import('../scripts/assets/release.mjs');
  assert.deepEqual(releaseSplit().kept.map((m: { id: string }) => m.id).sort(), objects.map((m) => m.id).sort(), 'both anatomy models are held, the CC0 objects are carried');
  const dir = mkdtempSync(join(tmpdir(), 'tt-bundle-'));
  try {
    const entry = join(import.meta.dirname, '..', 'src', 'scene', 'index.ts');
    // a release with the real manifests: the anatomy is gone from the guide and the validator, the objects stay
    const mixed = join(dir, 'mixed.mjs');
    await build({ entryPoints: [entry], outfile: mixed, bundle: true, platform: 'node', format: 'esm', plugins: [releaseCatalogue], logLevel: 'silent' });
    const kept = await import(pathToFileURL(mixed).href);
    const line = kept.sceneGuide.split('\n').find((l: string) => l.startsWith('- Real models')) as string;
    assert.ok(line.includes('drill') && !/\bheart\b/.test(line) && !/\bbrain\b/.test(line), 'the guide offers the objects and not the anatomy');
    const gone = kept.validateStep({ say: 'x', actions: [{ op: 'panel', x: 400, y: 80, w: 500, h: 700 }, { op: 'add', shape: 'model', id: 'h', model: 'heart' }] }, kept.createSceneState());
    assert.ok(!(gone.step?.actions ?? []).some((a: { op: string; id?: string }) => a.id === 'h'), 'a held model is dropped');
    // and with every model held there is no model line and no model shape at all
    const out = join(dir, 'scene.mjs');
    // @ts-expect-error plain script module
    const { catalogueSource } = await import('../scripts/assets/index.mjs');
    const none: Plugin = {
      name: 'none-left',
      setup(b) {
        b.onLoad({ filter: /model-catalogue\.ts$/ }, () => ({ contents: catalogueSource([]), loader: 'ts', resolveDir: join(import.meta.dirname, '..', 'src', 'scene') }));
      },
    };
    await build({ entryPoints: [entry], outfile: out, bundle: true, platform: 'node', format: 'esm', plugins: [none], logLevel: 'silent' });
    const lib = await import(pathToFileURL(out).href);
    assert.ok(!lib.sceneGuide.includes('Real models'), 'no model line');
    assert.ok(!lib.sceneGuide.includes('with no real model below'), 'no pointer to models that are not there');
    assert.ok(!JSON.stringify(lib.sceneSchemaLean).includes('"heart"'));
    const r = lib.validateStep({ say: 'x', actions: [{ op: 'panel', x: 400, y: 80, w: 500, h: 700 }, { op: 'add', shape: 'model', id: 'h', model: 'heart' }] }, lib.createSceneState());
    assert.ok(!(r.step?.actions ?? []).some((a: { op: string; id?: string }) => a.id === 'h'), 'the add is dropped');
    assert.ok(r.issues.length > 0);
    // and the full catalogue of a developer build still has them
    assert.ok(sceneGuide.includes('Real models'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a frame with a dense real model on it is told apart by its triangles, each model once', () => {
  const scene = validated({ steps: [{ say: 'Heart.', actions: [{ op: 'panel', x: 400, y: 80, w: 500, h: 700 }, { op: 'add', shape: 'model', id: 'h', model: 'heart' }, { op: 'add', shape: 'box', id: 'b', size: [1, 1, 1] }] }] });
  const frame = frameAt(scene.steps, 0, 5);
  assert.equal(modelTriangles(frame.objects), heart.built.triangles, 'the model counts once, not once for each of its parts');
  assert.ok(modelTriangles(frame.objects) >= HEAVY_MODEL_TRIANGLES, 'the heart is dense enough for the light level');
  const plain = validated({ steps: [{ say: 'Box.', actions: [{ op: 'panel', x: 400, y: 80, w: 500, h: 700 }, { op: 'add', shape: 'box', id: 'b', size: [1, 1, 1] }] }] });
  assert.equal(modelTriangles(frameAt(plain.steps, 0, 5).objects), 0);
});

test('Explode and Cut are offered for what can be taken apart: not for a model of one piece alone, but for one with parts', () => {
  const frameOf = (actions: unknown[]) => frameAt(validated({ steps: [{ say: 'x', actions: [{ op: 'panel', x: 400, y: 80, w: 500, h: 700 }, ...actions] }] }).steps, 0, 5);
  const drill = { op: 'add', shape: 'model', id: 'd', model: 'drill' };
  const lone = frameOf([drill]);
  assert.ok(lone.objects.length >= 2, 'the group and its mesh would pass the old count of two');
  assert.equal(takeApartable(lone.objects).length, 0);
  assert.ok(takeApartable(frameOf([{ op: 'add', shape: 'model', id: 'c', model: 'camera' }]).objects).length >= 2, 'a camera has a strap and a body');
  assert.ok(takeApartable(frameOf([drill, { op: 'add', shape: 'box', id: 'a', size: [1, 1, 1] }, { op: 'add', shape: 'box', id: 'b', size: [1, 1, 1] }]).objects).length >= 2, 'two shapes beside the drill still can');
});

test('a textured model\'s surface carries its colour map on every tier, its other maps only where the tier draws them, and glass is the overlay\'s glass', () => {
  const map = new Texture(), normal = new Texture(), arm = new Texture();
  const source = new MeshStandardMaterial({ map, normalMap: normal, roughnessMap: arm, metalnessMap: arm, roughness: 1, metalness: 1 });
  const low = modelSurface(source, TIERS.low), mid = modelSurface(source, TIERS.mid), high = modelSurface(source, TIERS.high);
  for (const s of [low, mid, high]) { assert.equal(s.map, map); assert.equal(s.userData.name, 'textured'); assert.equal(s.color.getHex(), 0xffffff); }
  assert.equal(low.normalMap, null);
  assert.equal(low.roughnessMap, null);
  assert.ok(low.metalness <= 0.1, 'a metal factor with no metal map would turn the colour map to dark chrome');
  assert.equal(mid.normalMap, normal);
  assert.equal(high.roughnessMap, arm);
  assert.equal(high.metalness, 1, 'the factor stands where its map is drawn');
  const glass = modelSurface(new MeshStandardMaterial({ transparent: true, opacity: 0.8 }), TIERS.mid);
  assert.equal(glass.userData.name, 'glass');
  assert.equal(modelSurface(Object.assign(new MeshPhysicalMaterial(), { transmission: 1 }), TIERS.low).userData.name, 'glass');
  // the tiers' budgets: smaller textures and fewer maps on the lower one
  assert.ok(TIERS.low.modelTexture < TIERS.mid.modelTexture && TIERS.low.modelMaps === 'colour' && TIERS.mid.modelMaps === 'full');
});

test('the page may read the blobs the model loader makes for a textured model\'s images, and nothing but files and blobs', () => {
  // Seen once the hard way: without blob: every texture was refused and every textured model drew white.
  const html = readFileSync(join(import.meta.dirname, '..', 'src', 'overlay', 'index.html'), 'utf8');
  const connect = /connect-src ([^"';]+)/.exec(html)![1]!.trim().split(/\s+/);
  assert.deepEqual(connect.sort(), ['blob:', 'file:']);
});
