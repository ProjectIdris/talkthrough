// Turning an atlas mesh into a part of a glTF binary, in plain functions (no packages): read an OBJ's vertices and faces, turn its axes and units into the
// scene's (x right, y up, z toward the viewer, metres), weld and smooth it, count whether it is closed, and write a GLB whose nodes are the named
// parts. The output is deterministic (no times, no random), so its hash is a fact about the inputs and this code.

/** Vertices and triangles of an OBJ (`v x y z`, `f a b c` or `a/b/c`, with fans for faces of more than three corners). Nothing else is read. */
export function parseObj(text) {
  const pos = [], tri = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/);
      const v = [Number(p[1]), Number(p[2]), Number(p[3])];
      if (!v.every(Number.isFinite)) throw new Error(`bad vertex: ${line}`);
      pos.push(v[0], v[1], v[2]);
    } else if (line.startsWith('f ')) {
      const ids = line.split(/\s+/).slice(1).map((t) => {
        const i = parseInt(t.split('/')[0], 10);
        return i < 0 ? pos.length / 3 + i : i - 1;
      });
      for (let k = 1; k + 1 < ids.length; k++) tri.push(ids[0], ids[k], ids[k + 1]);
    }
  }
  const count = pos.length / 3;
  for (const i of tri) if (!(i >= 0 && i < count)) throw new Error(`a face names vertex ${i + 1}, which does not exist`);
  return { positions: Float32Array.from(pos), indices: tri };
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const AXES = { 'x+': [1, 0, 0], 'x-': [-1, 0, 0], 'y+': [0, 1, 0], 'y-': [0, -1, 0], 'z+': [0, 0, 1], 'z-': [0, 0, -1] };

/**
 * The rows that turn source coordinates into the scene's: the scene's up is the source's up axis, its front (toward the viewer) the source's front
 * axis, and its right is up x front. A rotation (never a mirror), so a left stays a left.
 */
export function orientation(up, front) {
  const u = AXES[up], f = AXES[front];
  if (!u || !f) throw new Error(`orient axes must be one of ${Object.keys(AXES).join(', ')}`);
  if (u[0] * f[0] + u[1] * f[1] + u[2] * f[2] !== 0) throw new Error('up and front must be different axes');
  return { right: cross(u, f), up: u, front: f };
}

/** Positions into the scene's axes and metres. */
export function transformPositions(positions, rows, unitsToMetres) {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    out[i] = (x * rows.right[0] + y * rows.right[1] + z * rows.right[2]) * unitsToMetres;
    out[i + 1] = (x * rows.up[0] + y * rows.up[1] + z * rows.up[2]) * unitsToMetres;
    out[i + 2] = (x * rows.front[0] + y * rows.front[1] + z * rows.front[2]) * unitsToMetres;
  }
  return out;
}

/** Joins vertices at the same place (the source repeats them), dropping degenerate triangles. */
export function weld(positions, indices) {
  const seen = new Map(), remap = new Int32Array(positions.length / 3), keep = [];
  for (let i = 0, n = positions.length / 3; i < n; i++) {
    const key = `${positions[i * 3]},${positions[i * 3 + 1]},${positions[i * 3 + 2]}`;
    let at = seen.get(key);
    if (at === undefined) { at = keep.length / 3; seen.set(key, at); keep.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]); }
    remap[i] = at;
  }
  const tri = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = remap[indices[t]], b = remap[indices[t + 1]], c = remap[indices[t + 2]];
    if (a !== b && b !== c && a !== c) tri.push(a, b, c);
  }
  return { positions: Float32Array.from(keep), indices: tri };
}

/** Smooth vertex normals, each triangle weighted by its area. */
export function normals(positions, indices) {
  const n = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
    const e1 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const e2 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const f = cross(e1, e2);
    for (const v of [a, b, c]) { n[v] += f[0]; n[v + 1] += f[1]; n[v + 2] += f[2]; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

/** True when every edge is shared by exactly two triangles (a watertight solid, so a cut can be capped). */
export function isClosed(indices) {
  const edges = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k], b = indices[t + (k + 1) % 3];
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  for (const c of edges.values()) if (c !== 2) return false;
  return indices.length > 0;
}

export function bounds(positions) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], positions[i + k]); max[k] = Math.max(max[k], positions[i + k]); }
  return { min, max, center: min.map((v, k) => (v + max[k]) / 2), size: min.map((v, k) => max[k] - v) };
}

/** Joins several meshes into one (indices moved on by the vertices before them). */
export function merge(meshes) {
  let vertices = 0, tris = 0;
  for (const m of meshes) { vertices += m.positions.length; tris += m.indices.length; }
  const positions = new Float32Array(vertices), indices = [];
  let at = 0;
  for (const m of meshes) { positions.set(m.positions, at); for (const i of m.indices) indices.push(i + at / 3); at += m.positions.length; }
  return { positions, indices };
}

const pad4 = (n) => (n + 3) & ~3;

/**
 * A GLB: one scene, a root node (the model), and under it one node for each part with its mesh, centred on itself, and its own translation. Each node
 * carries `extras` (the part's key, the atlas files it came from, its confidence). Positions, normals and 32-bit indices, one flat colour as the
 * material (the app picks its own surface by name; this is for any other viewer).
 */
export function writeGlb(root, parts) {
  const chunks = [], views = [], accessors = [], meshes = [], materials = [], nodes = [{ name: root, children: [] }];
  const push = (bytes, target) => {
    const offset = chunks.reduce((n, c) => n + c.length, 0);
    const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    chunks.push(buf, Buffer.alloc(pad4(buf.length) - buf.length));
    views.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target ? { target } : {}) });
    return views.length - 1;
  };
  for (const part of parts) {
    const b = bounds(part.positions);
    const local = new Float32Array(part.positions.length);
    for (let i = 0; i < local.length; i += 3) for (let k = 0; k < 3; k++) local[i + k] = part.positions[i + k] - b.center[k];
    const nrm = normals(local, part.indices);
    const idx = Uint32Array.from(part.indices);
    const pv = push(local, 34962), nv = push(nrm, 34962), iv = push(idx, 34963);
    const lb = bounds(local);
    accessors.push({ bufferView: pv, componentType: 5126, count: local.length / 3, type: 'VEC3', min: lb.min, max: lb.max });
    accessors.push({ bufferView: nv, componentType: 5126, count: nrm.length / 3, type: 'VEC3' });
    accessors.push({ bufferView: iv, componentType: 5125, count: idx.length, type: 'SCALAR' });
    const a = accessors.length - 3;
    materials.push({ name: part.key, pbrMetallicRoughness: { baseColorFactor: [...(part.color ?? [200, 200, 200]).map((c) => Math.round((c / 255) * 1000) / 1000), 1], metallicFactor: 0, roughnessFactor: 0.6 } });
    meshes.push({ name: part.key, primitives: [{ attributes: { POSITION: a, NORMAL: a + 1 }, indices: a + 2, material: materials.length - 1 }] });
    nodes.push({ name: part.key, mesh: meshes.length - 1, translation: b.center.map((v) => Math.round(v * 1e7) / 1e7), extras: { key: part.key, files: part.files, confidence: part.confidence } });
    nodes[0].children.push(nodes.length - 1);
  }
  const bin = Buffer.concat(chunks);
  const json = { asset: { version: '2.0', generator: 'talkthrough assets:build' }, scene: 0, scenes: [{ nodes: [0] }], nodes, meshes, materials, accessors, bufferViews: views, buffers: [{ byteLength: bin.length }] };
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc(pad4(js.length) - js.length, 0x20)]);
  const total = 12 + 8 + js.length + 8 + bin.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
  out.writeUInt32LE(js.length, 12); out.writeUInt32LE(0x4e4f534a, 16); js.copy(out, 20);
  const o = 20 + js.length;
  out.writeUInt32LE(bin.length, o); out.writeUInt32LE(0x004e4942, o + 4); bin.copy(out, o + 8);
  return out;
}
