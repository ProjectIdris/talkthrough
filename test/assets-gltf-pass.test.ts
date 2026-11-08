import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Box3, Vector3 } from 'three';
import { createModelStore } from '../src/overlay/model-assets.ts';
import type { ModelEntry } from '../src/scene/model-catalogue.ts';
// @ts-expect-error plain script modules
import { buildGltfModel, readGlb } from '../scripts/assets/gltf-pass.mjs';
// @ts-expect-error plain script modules
import { fetchAddressProblem, manifestProblems } from '../scripts/assets/manifest.mjs';

// A glTF made here, small enough to check by hand: one triangle (0,0,0) (1,0,0) (0,1,0) shared by two nodes, one moved by a translation and one turned a quarter about z.

const bin = Buffer.alloc(44);
[0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => bin.writeFloatLE(v, i * 4));
[0, 1, 2].forEach((v, i) => bin.writeUInt16LE(v, 36 + i * 2));
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const source = (extra: Record<string, unknown> = {}) => ({
  asset: { version: '2.0', generator: 'test' }, scene: 0, scenes: [{ nodes: [0, 1] }],
  nodes: [{ name: 'a', mesh: 0, translation: [1, 0, 0] }, { name: 'b', mesh: 0, rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
  materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }], textures: [{ source: 0 }], images: [{ uri: 'tex/c.png' }],
  accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }, { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }],
  buffers: [{ uri: 'tri.bin', byteLength: 44 }],
  ...extra,
});

const manifest = (over: Record<string, unknown> = {}) => ({
  id: 'tri', format: 'gltf', orient: { up: 'y+', front: 'z+' }, scale: { unitsToMetres: 2 },
  files: [{ entry: 'tri.gltf' }, { entry: 'tri.bin' }, { entry: 'tex/c.png' }],
  parts: [{ key: 'a', name: 'A', confidence: 'atlas', nodes: ['a'] }, { key: 'b', name: 'B', confidence: 'atlas', nodes: ['b'] }],
  ...over,
});

const reader = (json: unknown) => (f: { entry: string }): Buffer => {
  if (f.entry === 'tri.gltf') return Buffer.from(JSON.stringify(json));
  if (f.entry === 'tri.bin') return bin;
  if (f.entry === 'tex/c.png') return png;
  throw new Error(`no file ${f.entry}`);
};
const near = (got: number[], want: number[]) => got.forEach((v, i) => assert.ok(Math.abs(v - want[i]!) < 1e-6, `${got} is not ${want}`));

test('the pass-through measures each part where it stands in the scene: node transforms, the model\'s scale, centred on the whole', () => {
  const r = buildGltfModel(manifest(), reader(source()));
  // a: (1,0,0) (2,0,0) (1,1,0), then times 2: x 2..4, y 0..2. b: the quarter turn takes (x,y) to (-y,x): x -2..0, y 0..2. The whole: x -2..4, y 0..2, middle (1,1,0).
  near(r.parts.a.center, [2, 0, 0]);
  near(r.parts.a.size, [2, 2, 0]);
  near(r.parts.b.center, [-2, 0, 0]);
  near(r.parts.b.size, [2, 2, 0]);
  near(r.size, [6, 2, 0]);
  assert.equal(r.triangles, 2);
});

test('the axes in the manifest turn the model into the scene\'s (up y, toward the viewer z), never a mirror', () => {
  // up z and front -y: a point (x,y,z) goes to (x, z, -y).
  const r = buildGltfModel(manifest({ orient: { up: 'z+', front: 'y-' }, scale: { unitsToMetres: 1 }, parts: [{ key: 'a', name: 'A', confidence: 'atlas', nodes: ['a'] }] }), reader(source({ scenes: [{ nodes: [0] }] })));
  near(r.parts.a.size, [1, 0, 1]);
});

test('the output is one GLB with the images inside it, the parts tagged, a root of the model\'s id, and the same bytes every time', () => {
  const a = buildGltfModel(manifest(), reader(source())), b = buildGltfModel(manifest(), reader(source()));
  assert.ok(a.glb.equals(b.glb), 'deterministic');
  const { json, bin: chunk } = readGlb(a.glb);
  assert.ok(!JSON.stringify(json).includes('"uri"'), 'no external reference left');
  assert.equal(json.images[0].mimeType, 'image/png');
  const view = json.bufferViews[json.images[0].bufferView];
  assert.ok(chunk.subarray(view.byteOffset, view.byteOffset + view.byteLength).equals(png), 'the image bytes are the source\'s own');
  assert.equal(json.buffers.length, 1);
  assert.equal(json.buffers[0].byteLength, chunk.length);
  const root = json.nodes[json.scenes[json.scene].nodes[0]];
  assert.equal(root.name, 'tri');
  assert.deepEqual(json.nodes.filter((n: { extras?: { part?: string } }) => n.extras?.part).map((n: { extras: { part: string } }) => n.extras.part), ['a', 'b']);
});

test('what the manifest does not pin is refused: an unlisted file, a data URI, a decoder the page lacks, a mesh in no part', () => {
  const fails = (json: unknown, m = manifest(), why: RegExp) => assert.throws(() => buildGltfModel(m, reader(json)), why);
  fails(source({ images: [{ uri: 'tex/other.png' }] }), manifest(), /does not list/);
  fails(source({ images: [{ uri: 'data:image/png;base64,AAAA' }] }), manifest(), /data URI/);
  fails(source({ images: [{ uri: '../c.png' }] }), manifest(), /outside/);
  fails(source({ extensionsRequired: ['KHR_draco_mesh_compression'] }), manifest(), /KHR_draco_mesh_compression/);
  fails(source(), manifest({ parts: [{ key: 'a', name: 'A', confidence: 'atlas', nodes: ['a'] }] }), /in no part/);
  fails(source(), manifest({ parts: [{ key: 'a', name: 'A', confidence: 'atlas', nodes: ['a', 'b'] }, { key: 'c', name: 'C', confidence: 'atlas', nodes: ['b'] }] }), /belongs to two parts/);
  fails(source(), manifest({ parts: [{ key: 'a', name: 'A', confidence: 'atlas', nodes: ['nope'] }] }), /no node named/);
});

test('a glTF manifest must pin its files, name a publisher\'s host and say how the licence reads on its page', () => {
  const sound = {
    id: 'tri', name: 'Tri', description: 'a triangle', aliases: [], format: 'gltf',
    licence: { id: 'CC0-1.0', version: '1.0', statement: 'CC0', statedOn: 'https://polyhaven.com/license' },
    source: { name: 'Poly Haven', url: 'https://polyhaven.com/a/x', cacheFolder: 'ph-x' }, retrieved: '2026-11-08', changes: 'none',
    orient: { up: 'y+', front: 'z+' }, scale: { unitsToMetres: 1 },
    files: [{ entry: 'x.gltf', url: 'https://dl.polyhaven.org/file/x.gltf', bytes: 10, sha256: 'a'.repeat(64) }],
    parts: [{ key: 'whole', name: 'Whole', confidence: 'atlas', nodes: ['x'] }],
  };
  assert.deepEqual(manifestProblems(sound), []);
  const broken = (change: (m: typeof sound) => void) => { const m = JSON.parse(JSON.stringify(sound)); change(m); return manifestProblems(m).join(';'); };
  assert.match(broken((m) => { m.files[0]!.url = 'https://example.com/x.gltf'; }), /url must be https/);
  assert.match(broken((m) => { m.files[0]!.url = 'http://dl.polyhaven.org/x.gltf'; }), /url must be https/);
  assert.match(broken((m) => { delete (m.files[0] as { sha256?: string }).sha256; }), /pinned/);
  assert.match(broken((m) => { delete (m as { retrieved?: string }).retrieved; }), /retrieved/);
  assert.match(broken((m) => { delete (m.licence as { statement?: string }).statement; }), /licence as its page states it/);
});

test('the store brings a textured model in: each mesh in the model\'s space, centred on its part, with the source\'s own material', async () => {
  const built = buildGltfModel(manifest(), reader(source()));
  const entry = {
    id: 'tri', name: 'Tri', description: '', aliases: [], format: 'gltf', single: false,
    licence: { id: 'CC0-1.0', name: 'CC0', version: '1.0', url: '' }, release: { blocked: false }, size: built.size, realLengthMetres: 6, caveats: [],
    built: { file: 'tri.glb', bytes: built.glb.length, sha256: createHash('sha256').update(built.glb).digest('hex'), triangles: built.triangles },
    parts: ['a', 'b'].map((key) => ({ key, name: key, aliases: [], confidence: 'atlas', color: [255, 255, 255], closed: false, ...built.parts[key] })),
  } as unknown as ModelEntry;
  const g = globalThis as Record<string, unknown>;
  const before = { createImageBitmap: g.createImageBitmap, self: g.self };
  g.createImageBitmap = async () => ({ width: 8, height: 8, close() {} });
  g.self = globalThis;
  try {
    const store = createModelStore({ catalogue: [entry], read: async () => built.glb.buffer.slice(built.glb.byteOffset, built.glb.byteOffset + built.glb.byteLength) as ArrayBuffer });
    await store.ensure(['tri']);
    assert.equal(store.state('tri'), 'ready', store.failure('tri'));
    for (const key of ['a', 'b']) {
      const pieces = store.pieces('tri', key)!;
      assert.equal(pieces.length, 1);
      const box = new Box3().setFromBufferAttribute(pieces[0]!.geometry.getAttribute('position') as never);
      near(box.getCenter(new Vector3()).toArray(), [0, 0, 0]);
      near(box.getSize(new Vector3()).toArray(), [2, 2, 0]);
      assert.ok((pieces[0]!.material as { map?: unknown }).map, 'the colour map came through');
    }
  } finally { g.createImageBitmap = before.createImageBitmap; if (before.self === undefined) delete g.self; else g.self = before.self; }
});

test('a mirrored node is refused, not built inside out', () => {
  const only = manifest({ parts: [{ key: 'a', name: 'A', confidence: 'atlas', nodes: ['a'] }] });
  const withScale = (scale: number[]) => source({ scenes: [{ nodes: [0] }], nodes: [{ name: 'a', mesh: 0, scale }, { name: 'b', mesh: 0 }] });
  assert.throws(() => buildGltfModel(only, reader(withScale([-1, 1, 1]))), /mirrored/);
  // two mirrors make a turn: not refused
  assert.doesNotThrow(() => buildGltfModel(only, reader(withScale([-1, -1, 1]))));
});

test('where a file may come from and go: https on a publisher host only, and entries stay inside the model folder', () => {
  assert.equal(fetchAddressProblem('https://dl.polyhaven.org/file/x.gltf'), undefined);
  assert.equal(fetchAddressProblem('https://3d-api.si.edu/content/x.glb'), undefined);
  assert.match(fetchAddressProblem('http://dl.polyhaven.org/x.gltf') ?? '', /not https/, 'a redirect to http on an allowed host');
  assert.match(fetchAddressProblem('https://example.com/x.gltf') ?? '', /not an allowed host/);
  assert.match(fetchAddressProblem('https://dl.polyhaven.org.evil.com/x') ?? '', /not an allowed host/);
  assert.match(fetchAddressProblem('not a url') ?? '', /not an address/);
  const sound = {
    id: 'tri', name: 'Tri', description: 'a triangle', aliases: [], format: 'gltf',
    licence: { id: 'CC0-1.0', version: '1.0', statement: 'CC0', statedOn: 'https://polyhaven.com/license' },
    source: { name: 'Poly Haven', url: 'https://polyhaven.com/a/x', cacheFolder: 'ph-x' }, retrieved: '2026-11-08', changes: 'none',
    orient: { up: 'y+', front: 'z+' }, scale: { unitsToMetres: 1 },
    files: [{ entry: 'x.gltf', url: 'https://dl.polyhaven.org/file/x.gltf', bytes: 10, sha256: 'a'.repeat(64) }],
    parts: [{ key: 'whole', name: 'Whole', confidence: 'atlas', nodes: ['x'] }],
  };
  for (const entry of ['../../evil.bin', 'C:/evil.bin', '/evil.bin', 'a\\b.bin', 'a/../../b.bin', 'D:evil']) {
    const m = JSON.parse(JSON.stringify(sound)); m.files.push({ ...m.files[0], entry });
    assert.match(manifestProblems(m).join(';'), /must stay inside/, entry);
  }
  const ok = JSON.parse(JSON.stringify(sound)); ok.files.push({ ...ok.files[0], entry: 'textures/a.b.jpg' });
  assert.deepEqual(manifestProblems(ok), []);
});

test('the hub of a part is the origin of its node (where it turns), or a point the manifest gives; it is checked', () => {
  const withHub = (a: unknown, b?: unknown) => buildGltfModel(manifest({ parts: [{ key: 'a', name: 'A', confidence: 'atlas', nodes: ['a'], hub: a }, { key: 'b', name: 'B', confidence: 'atlas', nodes: ['b'], ...(b ? { hub: b } : {}) }] }), reader(source()));
  // node a sits at (1,0,0) and node b at the origin, times 2, from the whole's middle (1,1,0): hubs (1,-1,0) and (-1,-1,0); the mesh's own middle is not the hub.
  const r = withHub('node', 'node');
  near(r.parts.a.hub, [1, -1, 0]);
  near(r.parts.b.hub, [-1, -1, 0]);
  near(withHub([0.5, 0.25, 0]).parts.a.hub, [0.5, 0.25, 0]);
  assert.equal(withHub(undefined).parts.a.hub, undefined, 'no hub unless the manifest asks');
  const sound = manifest();
  for (const bad of ['middle', [1, 2], [1, 2, 'x']]) {
    const m = JSON.parse(JSON.stringify(sound)); m.parts[0].hub = bad;
    assert.match(manifestProblems({ ...m, id: 'tri' }).join(';'), /hub must be/, JSON.stringify(bad));
  }
});
