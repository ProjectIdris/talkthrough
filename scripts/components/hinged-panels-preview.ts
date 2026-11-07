// Exports the real Three.js scene graph for optional CPU visual inspection in Blender.
// This does not capture Electron/WebGL, its shaders, shadows, labels or the user's screen.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { Matrix3, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { validateScene } from '../../src/scene/validate.ts';
import { frameAt } from '../../src/overlay/timeline.ts';
import { PanelScene } from '../../src/overlay/scene3d.ts';

const [input, output, rawStep = '0'] = process.argv.slice(2);
if (!input || !output) throw new Error('usage: node scripts/components/hinged-panels-preview.ts scene.json meshes.json [step]');
const source = readFileSync(input);
const validated = validateScene(JSON.parse(source.toString('utf8')));
if (!validated.scene || validated.issues.length) throw new Error(`scene refused: ${JSON.stringify(validated.issues)}`);
const step = Number(rawStep);
if (!Number.isInteger(step) || step < 0 || step >= validated.scene.steps.length) throw new Error('step is outside the scene');
const frame = frameAt(validated.scene.steps, step, 99);
const panel = new PanelScene({ tier: 'high' });
try {
  panel.sync(frame, 1);
  panel.scene.updateMatrixWorld(true);
  const meshes: unknown[] = [];
  for (const object of frame.objects) {
    const root = panel.nodeOf(object.key)!;
    // A primitive's node is its mesh; children belong to separately addressable scene objects.
    for (const mesh of [root]) {
      if (!(mesh instanceof Mesh) || !(mesh.material instanceof MeshStandardMaterial) || !mesh.visible) continue;
      const geo = mesh.geometry, position = geo.getAttribute('position'), normal = geo.getAttribute('normal'), index = geo.getIndex();
      const normalMatrix = new Matrix3().getNormalMatrix(mesh.matrixWorld), vector = new Vector3();
      const vertices: number[][] = [], normals: number[][] = [], faces: number[][] = [];
      for (let i = 0; i < position.count; i++) {
        vertices.push(vector.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).toArray());
        normals.push(vector.fromBufferAttribute(normal, i).applyNormalMatrix(normalMatrix).toArray());
      }
      for (let i = 0; i < (index?.count ?? position.count); i += 3) faces.push([0, 1, 2].map((j) => index ? index.getX(i + j) : i + j));
      meshes.push({ id: object.id, vertices, normals, faces, color: mesh.material.color.toArray(), metalness: mesh.material.metalness, roughness: mesh.material.roughness });
    }
  }
  if (!meshes.length) throw new Error('no visible component meshes');
  writeFileSync(output, JSON.stringify({ sourceSha256: createHash('sha256').update(source).digest('hex'), step, tier: 'high', boundary: 'Exact Three.js world-space mesh geometry and normals; CPU preview is not Electron/WebGL acceptance.', meshes }));
} finally { panel.destroy(); }
