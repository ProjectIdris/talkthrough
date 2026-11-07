// Offline CPU diagnostic. No WebGL, model, network, screen capture or new dependencies.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Mesh, REVISION } from 'three';
import type { BufferAttribute, BufferGeometry } from 'three';
import { PanelScene } from '../src/overlay/scene3d.ts';
import type { Tier } from '../src/overlay/materials.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';
import { validateScene } from '../src/scene/index.ts';

type Fixture = 'first-piece' | 'repeated' | 'unique';
const digest = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');

function fixture(kind: Fixture): { frame: Frame; hash: string } {
  const shapes = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane'];
  const actions = Array.from({ length: kind === 'first-piece' ? 1 : 60 }, (_, i) => ({
    op: 'add', shape: shapes[i % shapes.length], id: `solid${i}`, edges: false,
    size: [2 + (kind === 'unique' ? i * 0.01 : 0), 1, 3],
    pos: [(i % 10) * 3, Math.floor(i / 10) * 2, 0],
  }));
  const steps = [];
  for (let i = 0; i < actions.length; i += 24) steps.push({ say: 'Solid geometry fixture.', actions: actions.slice(i, i + 24) });
  const raw = { v: 1, steps };
  const checked = validateScene(raw);
  if (!checked.scene || checked.issues.length) throw new Error(`Invalid benchmark fixture: ${JSON.stringify(checked.issues)}`);
  return { frame: frameAt(checked.scene.steps, checked.scene.steps.length - 1, 99), hash: digest(JSON.stringify(raw)) };
}

function resources(scene: PanelScene, frame: Frame) {
  const seen = new Set<BufferGeometry>();
  let logicalBytes = 0, uniqueBytes = 0;
  const hashes: string[] = [];
  for (const object of frame.objects) {
    const mesh = scene.nodeOf(object.key);
    if (!(mesh instanceof Mesh)) throw new Error('Benchmark expected one mesh per primitive');
    const geometry = mesh.geometry;
    let bytes = 0;
    const hash = createHash('sha256');
    const attributes = { ...geometry.attributes, ...(geometry.index ? { index: geometry.index } : {}) };
    for (const name of Object.keys(attributes).sort()) {
      const attribute = attributes[name] as BufferAttribute;
      const array = attribute.array;
      bytes += array.byteLength;
      hash.update(JSON.stringify([name, attribute.itemSize, attribute.normalized, array.constructor.name]));
      hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
    }
    hash.update(JSON.stringify({ groups: geometry.groups, drawRange: geometry.drawRange, matrix: mesh.matrixWorld.elements }));
    hashes.push(hash.digest('hex'));
    logicalBytes += bytes;
    if (!seen.has(geometry)) { seen.add(geometry); uniqueBytes += bytes; }
  }
  return { meshes: frame.objects.length, uniqueGeometries: seen.size, logicalBytes, uniqueBytes, geometryDigest: digest(JSON.stringify(hashes)) };
}

function summary(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  return { p50: ordered[Math.floor((ordered.length - 1) * 0.5)]!, p95: ordered[Math.ceil((ordered.length - 1) * 0.95)]! };
}

export function benchmarkSolidSharing({ samples = 10, warmups = 2 }: { samples?: number; warmups?: number } = {}) {
  if (!Number.isInteger(samples) || samples < 1 || samples > 100) throw new Error('samples must be an integer from 1 to 100');
  if (!Number.isInteger(warmups) || warmups < 0 || warmups > 10) throw new Error('warmups must be an integer from 0 to 10');
  const cases = [];
  for (const tier of ['low', 'mid', 'high'] as Tier[]) for (const kind of ['first-piece', 'repeated', 'unique'] as Fixture[]) {
    const { frame, hash } = fixture(kind);
    const first: number[] = [], warm: number[] = [];
    let counts: ReturnType<typeof resources> | undefined;
    for (let sample = -warmups; sample < samples; sample++) {
      const scene = new PanelScene({ tier });
      try {
        const start = performance.now();
        scene.sync(frame, 1);
        const firstMs = performance.now() - start;
        // Warm sync does the real scene/camera update, but no new geometry. No GPU work is submitted.
        const again = performance.now();
        scene.sync(frame, 1);
        const warmMs = performance.now() - again;
        if (sample >= 0) { first.push(firstMs); warm.push(warmMs); }
        if (sample === 0) counts = resources(scene, frame);
      } finally { scene.destroy(); }
    }
    cases.push({ tier, fixture: kind, fixtureHash: hash, ...counts!, firstSyncMs: summary(first), warmSyncMs: summary(warm) });
  }
  return {
    node: process.version, platform: process.platform, arch: process.arch, threeRevision: REVISION,
    sourceHash: digest(readFileSync(new URL('../src/overlay/scene3d.ts', import.meta.url))),
    benchmarkHash: digest(readFileSync(new URL(import.meta.url))), samples, warmups,
    scope: 'CPU PanelScene.sync after imports, fixture validation, timeline evaluation and PanelScene construction. Edges disabled to isolate solid reuse. Bytes are typed-array storage, not measured GPU memory. No first-visible-pixel or live-model verdict.',
    cases,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(benchmarkSolidSharing(), null, 2));
}
