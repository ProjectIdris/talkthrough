// node scripts/assets/build.mjs [--pin] [model ...]
// Builds one GLB for each manifest from the cached source files: every file checked against its pinned hash, turned to the scene's axes and metres,
// welded, grouped into the named parts, written with the parts as nodes. The result goes in assets/built. --pin records what the build measured
// (the GLB's size and hash, each part's centre, size and whether it is closed) in the manifest; without it, the build must reproduce the pinned
// hash exactly, so a change in the files or in this code cannot go unnoticed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bounds, isClosed, merge, orientation, parseObj, transformPositions, weld, writeGlb } from './obj-glb.mjs';
import { buildGltfModel } from './gltf-pass.mjs';
import { BUILT_DIR, cacheFolder, manifestProblems, readManifests, sha256 } from './manifest.mjs';

const args = process.argv.slice(2);
const pin = args.includes('--pin');
const only = args.filter((a) => !a.startsWith('--'));
const round = (v, d = 6) => Math.round(v * 10 ** d) / 10 ** d;

/** The built GLB bytes and what was measured while making them. */
export function buildModel(m, readFile) {
  if (m.format === 'gltf') return buildGltfModel(m, (f) => Buffer.from(readFile(f, 'bytes')));
  const rows = orientation(m.orient.up, m.orient.front);
  const files = new Map(m.files.map((f) => [f.id, f]));
  const parts = m.parts.map((p) => {
    const meshes = p.nodes.map((id) => {
      const raw = parseObj(readFile(files.get(id)));
      const moved = transformPositions(raw.positions, rows, m.scale.unitsToMetres);
      return weld(moved, raw.indices);
    });
    const mesh = meshes.length === 1 ? meshes[0] : merge(meshes);
    // A part made of several files is closed when each of them is.
    const closed = meshes.every((x) => isClosed(x.indices));
    return { key: p.key, files: p.nodes, confidence: p.confidence, color: p.color, mesh, closed };
  });
  // The model's own middle is the origin: its parts are placed around it.
  const all = bounds(merge(parts.map((p) => p.mesh)).positions);
  const shifted = parts.map((p) => {
    const positions = new Float32Array(p.mesh.positions.length);
    for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) positions[i + k] = p.mesh.positions[i + k] - all.center[k];
    return { ...p, positions, indices: p.mesh.indices };
  });
  const glb = writeGlb(m.id, shifted);
  const measured = {};
  for (const p of shifted) {
    const b = bounds(p.positions);
    measured[p.key] = { center: b.center.map((v) => round(v)), size: b.size.map((v) => round(v)), closed: p.closed, triangles: p.indices.length / 3 };
  }
  return { glb, size: all.size.map((v) => round(v)), triangles: shifted.reduce((n, p) => n + p.indices.length / 3, 0), parts: measured };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  let failed = 0;
  mkdirSync(BUILT_DIR, { recursive: true });
  for (const { file, manifest: m } of readManifests()) {
    if (only.length && !only.includes(m.id)) continue;
    const problems = manifestProblems(m);
    if (problems.length) { console.error(`${m.id}: manifest is not sound: ${problems.join('; ')}`); failed++; continue; }
    const folder = cacheFolder(m);
    const readFile = (f, as = 'text') => {
      const path = join(folder, f.entry);
      if (!existsSync(path)) throw new Error(`${f.id ?? f.entry} is not in the cache (run assets:fetch)`);
      const data = readFileSync(path);
      if (f.sha256 && sha256(data) !== f.sha256) throw new Error(`${f.id ?? f.entry} does not match its pinned hash`);
      return as === 'bytes' ? data : data.toString('latin1');
    };
    try {
      const built = buildModel(m, readFile);
      const hash = sha256(built.glb);
      if (!pin && m.built && m.built.sha256 !== hash) throw new Error(`the build gives ${hash}, the manifest pins ${m.built.sha256}; check the change, then run with --pin`);
      writeFileSync(join(BUILT_DIR, `${m.id}.glb`), built.glb);
      if (pin) {
        m.built = { file: `${m.id}.glb`, bytes: built.glb.length, sha256: hash, triangles: built.triangles, size: built.size, parts: built.parts };
        writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
      }
      const open = Object.entries(built.parts).filter(([key, p]) => m.parts.find((x) => x.key === key)?.closed && !p.closed).map(([key]) => key);
      console.log(`${m.id}: ${(built.glb.length / 1048576).toFixed(2)} MB, ${built.triangles} triangles, size ${built.size.map((v) => (v * 100).toFixed(1)).join(' x ')} cm${open.length ? `; NOT closed though the manifest says so: ${open.join(', ')}` : ''}`);
    } catch (e) { console.error(`${m.id}: ${e.message}`); failed++; }
  }
  if (failed) process.exit(1);
}
