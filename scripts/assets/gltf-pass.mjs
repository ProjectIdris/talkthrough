// Turning a glTF or GLB model into the one GLB the app loads, with its materials and textures kept as the artist made them (a pass-through, not a
// re-modelling): the source's geometry, UVs, materials and images are copied byte for byte into one binary chunk, every file the source points at
// must be one the manifest names and pins (so nothing is read that was not reviewed), and the only things added are a root node that puts the model
// on the scene's axes, in metres and centred on its own middle, and a `part` tag on the nodes the manifest names as parts. The build also measures what
// the app needs without reading a mesh: each part's centre, size, triangles and whether it is watertight. Deterministic, like the OBJ path.

import { bounds, isClosed, orientation, weld } from './obj-glb.mjs';

const pad4 = (n) => (n + 3) & ~3;
const round = (v, d = 6) => Math.round(v * 10 ** d) / 10 ** d;

/** Extensions the page's loader handles with no decoder to fetch; a file that needs another (Draco, meshopt, KTX2) is refused, not half-drawn. */
export const ALLOWED_EXTENSIONS = new Set([
  'KHR_materials_transmission', 'KHR_materials_ior', 'KHR_materials_specular', 'KHR_materials_volume', 'KHR_materials_emissive_strength',
  'KHR_materials_clearcoat', 'KHR_materials_sheen', 'KHR_texture_transform',
]);

const COMPONENT = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

// 4x4 matrices, column-major as glTF writes them.
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function fromTrs(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0,
    2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
    2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
const local = (n) => (n.matrix ? [...n.matrix] : fromTrs(n.translation, n.rotation, n.scale));
const apply = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];

/** The JSON and the embedded binary chunk of a GLB. */
export function readGlb(bytes) {
  if (bytes.length < 28 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) throw new Error('not a GLB 2 file');
  let at = 12, json, bin;
  while (at + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(at), type = bytes.readUInt32LE(at + 4);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(body.toString('utf8'));
    else if (type === 0x004e4942 && !bin) bin = body;
    at += 8 + length;
  }
  if (!json) throw new Error('a GLB with no JSON chunk');
  return { json, bin };
}

/** The glTF's parts: everything it points at must be a file the manifest lists, by its path next to the model file. */
function resolveUri(uri, owner, files, what) {
  if (/^data:/i.test(uri)) throw new Error(`${what} is a data URI; the source must keep its files separate and pinned`);
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith('/') || uri.includes('..')) throw new Error(`${what} points outside the model's folder (${uri})`);
  const path = decodeURIComponent(uri);
  const dir = owner.includes('/') ? owner.slice(0, owner.lastIndexOf('/') + 1) : '';
  const entry = dir + path;
  const file = files.get(entry);
  if (!file) throw new Error(`${what} names ${entry}, which the manifest does not list; every file must be named and pinned`);
  return file;
}

/** Reads a vertex attribute or index accessor out of the combined binary. */
function readAccessor(json, bin, base, index) {
  const a = json.accessors[index];
  if (a.sparse) throw new Error('sparse accessors are not supported');
  const view = json.bufferViews[a.bufferView];
  const [Type, size] = COMPONENT[a.componentType] ?? [];
  if (!Type) throw new Error(`unknown component type ${a.componentType}`);
  const width = WIDTH[a.type];
  const stride = view.byteStride ?? size * width;
  const start = base[view.buffer] + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = new Array(a.count * width);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
  for (let i = 0; i < a.count; i++) for (let k = 0; k < width; k++) out[i * width + k] = dv[get](start + i * stride + k * size, true);
  return { data: out, count: a.count, width };
}

/** The node indices a manifest part names: by the node's name, or `#3` for the node at that index (a source whose nodes have no names). */
function nodesNamed(json, key) {
  if (/^#\d+$/.test(key)) {
    const i = Number(key.slice(1));
    if (!json.nodes[i]) throw new Error(`there is no node ${key}`);
    return [i];
  }
  const found = json.nodes.map((n, i) => (n.name === key ? i : -1)).filter((i) => i >= 0);
  if (!found.length) throw new Error(`there is no node named ${key}`);
  return found;
}

/** The built GLB bytes and what was measured while making them (the same shape as the OBJ path's). */
export function buildGltfModel(m, readBytes) {
  const files = new Map(m.files.map((f) => [f.entry, f]));
  const primary = m.files.find((f) => /\.(gltf|glb)$/i.test(f.entry));
  if (!primary) throw new Error('the manifest lists no .gltf or .glb file');
  const raw = readBytes(primary);
  let json, glbBin;
  if (/\.glb$/i.test(primary.entry)) ({ json, bin: glbBin } = readGlb(raw));
  else json = JSON.parse(raw.toString('utf8'));
  if (!json.asset || !String(json.asset.version).startsWith('2')) throw new Error('not a glTF 2 file');
  for (const list of [json.extensionsRequired, json.extensionsUsed]) for (const e of list ?? []) if (!ALLOWED_EXTENSIONS.has(e)) throw new Error(`the file uses ${e}, which the page cannot load without a decoder`);
  for (const mesh of json.meshes ?? []) for (const p of mesh.primitives) {
    if ((p.mode ?? 4) !== 4) throw new Error('only triangle meshes are supported');
    if (p.targets) throw new Error('morph targets are not supported');
    for (const k of Object.keys(p.attributes)) if (!/^(POSITION|NORMAL|TANGENT|TEXCOORD_\d|COLOR_\d)$/.test(k)) throw new Error(`attribute ${k} is not supported`);
  }
  if ((json.skins ?? []).length || (json.animations ?? []).length) throw new Error('skins and animations are not supported');

  // One binary chunk: the file's own, then each buffer it pointed at, then each image.
  const chunks = [];
  let size = 0;
  const add = (bytes) => { const at = size; chunks.push(bytes, Buffer.alloc(pad4(bytes.length) - bytes.length)); size += pad4(bytes.length); return at; };
  const base = [];
  const buffers = json.buffers ?? [];
  buffers.forEach((b, i) => {
    if (b.uri === undefined) {
      if (!glbBin || i !== 0) throw new Error(`buffer ${i} has no uri and no GLB chunk`);
      base.push(add(glbBin.subarray(0, b.byteLength)));
    } else base.push(add(readBytes(resolveUri(b.uri, primary.entry, files, `buffer ${i}`))));
  });
  const views = (json.bufferViews ?? []).map((v) => ({ ...v, buffer: 0, byteOffset: base[v.buffer] + (v.byteOffset ?? 0) }));
  for (const [i, img] of (json.images ?? []).entries()) {
    if (img.uri === undefined) continue;
    const file = resolveUri(img.uri, primary.entry, files, `image ${i}`);
    const mime = /\.png$/i.test(file.entry) ? 'image/png' : /\.jpe?g$/i.test(file.entry) ? 'image/jpeg' : undefined;
    if (!mime) throw new Error(`image ${i} (${file.entry}) is not a PNG or JPEG`);
    const bytes = readBytes(file);
    views.push({ buffer: 0, byteOffset: add(bytes), byteLength: bytes.length });
    img.bufferView = views.length - 1;
    img.mimeType = mime;
    delete img.uri;
  }
  const bin = Buffer.concat(chunks);
  json.bufferViews = views;
  json.buffers = [{ byteLength: bin.length }];
  // Reading accessors below uses offsets into the combined chunk (the views are already moved).
  const flat = [0];

  // Parts: each names source nodes; everything under them belongs to the part.
  const scene = json.scenes[json.scene ?? 0];
  const roots = scene.nodes;
  const members = new Map();
  const claim = (i, key) => {
    if (members.has(i) && members.get(i) !== key) throw new Error(`node ${json.nodes[i].name ?? '#' + i} belongs to two parts (${members.get(i)} and ${key})`);
    members.set(i, key);
    for (const c of json.nodes[i].children ?? []) claim(c, key);
  };
  for (const p of m.parts) for (const id of p.nodes) for (const i of nodesNamed(json, id)) claim(i, p.key);
  const world = new Map();
  const walk = (i, parent) => {
    const w = multiply(parent, local(json.nodes[i]));
    world.set(i, w);
    for (const c of json.nodes[i].children ?? []) walk(c, w);
  };
  for (const r of roots) walk(r, identity());
  for (const [i, n] of world) if (json.nodes[i].mesh !== undefined && !members.has(i)) throw new Error(`mesh node ${json.nodes[i].name ?? '#' + i} is in no part; every mesh must belong to one so none is dropped`);

  // The root: the model on the scene's axes, in metres, its own middle at the origin. First pass finds the middle.
  const rows = orientation(m.orient.up, m.orient.front);
  const s = m.scale.unitsToMetres;
  const axes = [[rows.right[0], rows.up[0], rows.front[0]], [rows.right[1], rows.up[1], rows.front[1]], [rows.right[2], rows.up[2], rows.front[2]]].map((c) => c.map((v) => v * s));
  const rootMatrix = (t) => [...axes[0], 0, ...axes[1], 0, ...axes[2], 0, t[0], t[1], t[2], 1];
  const measured = new Map(m.parts.map((p) => [p.key, { positions: [], triangles: 0, closed: true }]));
  const raw0 = rootMatrix([0, 0, 0]);
  for (const [i, w] of world) {
    const node = json.nodes[i];
    if (node.mesh === undefined) continue;
    const total = multiply(raw0, w);
    const into = measured.get(members.get(i));
    for (const prim of json.meshes[node.mesh].primitives) {
      const pos = readAccessor(json, bin, flat, prim.attributes.POSITION);
      if (pos.width !== 3) throw new Error('POSITION is not a VEC3');
      const out = new Float32Array(pos.count * 3);
      for (let v = 0; v < pos.count; v++) { const p = apply(total, pos.data[v * 3], pos.data[v * 3 + 1], pos.data[v * 3 + 2]); out.set(p, v * 3); }
      const index = prim.indices !== undefined ? readAccessor(json, bin, flat, prim.indices).data : Array.from({ length: pos.count }, (_, k) => k);
      const welded = weld(out, index);
      into.closed = into.closed && isClosed(welded.indices);
      into.triangles += index.length / 3;
      into.positions.push(out);
    }
  }
  const everything = bounds(Float32Array.from(Array.from(measured.values()).flatMap((p) => p.positions.flatMap((a) => Array.from(a)))));
  const shift = everything.center.map((v) => -v);
  const result = {};
  let triangles = 0;
  for (const p of m.parts) {
    const got = measured.get(p.key);
    if (!got.positions.length) throw new Error(`part ${p.key} holds no mesh`);
    const b = bounds(Float32Array.from(got.positions.flatMap((a) => Array.from(a))));
    result[p.key] = { center: b.center.map((v, k) => round(v + shift[k])), size: b.size.map((v) => round(v)), closed: got.closed, triangles: got.triangles };
    triangles += got.triangles;
  }
  // Tag the parts, add the root.
  for (const p of m.parts) for (const id of p.nodes) for (const i of nodesNamed(json, id)) json.nodes[i].extras = { ...(json.nodes[i].extras ?? {}), part: p.key };
  json.nodes.push({ name: m.id, matrix: rootMatrix(shift).map((v) => round(v, 9)), children: [...roots] });
  scene.nodes = [json.nodes.length - 1];
  json.asset = { ...json.asset, generator: `${json.asset.generator ?? 'unknown'}; passed through by talkthrough assets:build` };
  delete json.extras;

  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc(pad4(js.length) - js.length, 0x20)]);
  const total = 12 + 8 + js.length + 8 + bin.length;
  const glb = Buffer.alloc(total);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(total, 8);
  glb.writeUInt32LE(js.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); js.copy(glb, 20);
  const o = 20 + js.length;
  glb.writeUInt32LE(bin.length, o); glb.writeUInt32LE(0x004e4942, o + 4); bin.copy(glb, o + 8);
  return { glb, size: everything.size.map((v) => round(v)), triangles, parts: result };
}
