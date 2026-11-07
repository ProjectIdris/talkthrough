// An open-spoke wheel assembled from closed rings and bevelled spokes. The spaces between the
// spokes are real gaps, so the wheel reads from either side and when another object sits behind it.
import { Matrix4, Mesh } from 'three';
import { extrudeGeometry, latheGeometry, roundedCylinderGeometry } from './geometry.ts';
import type { Detail } from './geometry.ts';
import type { AddPart, Vec2 } from '../scene/types.ts';
import { Builder } from './parts-base.ts';

export function buildWheel(b: Builder, def: AddPart, d: Detail): void {
  // Normal generation hashes vertices in fixed-size buckets. Building at authored tiny
  // sizes collapses those buckets and makes normal smoothing quadratic. Keep every buffer
  // at unit size, then scale the child meshes (PanelScene owns the root transform).
  const outer = 1, depth = 0.8;
  const radius = def.size[0] / 2;
  const fit = new Matrix4().makeScale(radius, radius, Math.min(def.size[2], radius * depth) / depth);
  const n = def.n ?? 5;
  // The tyre has a broad tread and rolled shoulders, rather than a circular doughnut section.
  // Profile coordinates are fractions of radius and depth; the repeated end closes the inner wall.
  const tyre: Vec2[] = [
    [0.72, -0.32], [0.74, -0.42], [0.80, -0.48], [0.87, -0.5],
    [0.93, -0.46], [0.975, -0.36], [0.995, -0.24], [1, -0.12],
    [1, 0.12], [0.995, 0.24], [0.975, 0.36], [0.93, 0.46],
    [0.87, 0.5], [0.80, 0.48], [0.74, 0.42], [0.72, 0.32], [0.72, -0.32],
  ];
  b.add(latheGeometry(tyre.map(([r, z]) => [r * outer, z * depth]), d.curve * 2), 'rubber', {
    color: [32, 34, 40], rot: [90, 0, 0],
  });

  // A rounded annular barrel overlaps the tyre's inner wall. It never fills the centre.
  const inner = outer * 0.62, rim = outer * 0.79, lip = Math.min(outer * 0.035, depth * 0.08);
  const half = depth * 0.38;
  const profile: Vec2[] = [
    [inner + lip, -half], [rim - lip, -half], [rim, -half + lip],
    [rim, half - lip], [rim - lip, half], [inner + lip, half],
    [inner, half - lip], [inner, -half + lip], [inner + lip, -half],
  ];
  b.add(latheGeometry(profile, d.curve), 'metal', { tint: true, rot: [90, 0, 0] });

  // Spokes widen towards the rim. Their angular width shrinks with n, preserving an open gap
  // even at the language's largest spoke count. The bevel is bounded by the narrow root.
  const root = outer * 0.14, tip = inner + lip * 1.5;
  const halfAngle = Math.min(0.18, Math.PI / n * 0.34);
  const rootWidth = root * Math.tan(halfAngle), tipWidth = tip * Math.tan(halfAngle);
  const spokeDepth = depth * 0.46;
  const bevel = Math.min(outer * 0.018, spokeDepth * 0.18, rootWidth * 0.45);
  const outline: Vec2[] = [[root, -rootWidth], [tip, -tipWidth], [tip, tipWidth], [root, rootWidth]];
  const spokeGeometry = extrudeGeometry(outline, spokeDepth, bevel, d);
  for (let i = 0; i < n; i++) {
    const spoke = new Mesh(i === 0 ? spokeGeometry : spokeGeometry.clone());
    spoke.rotation.z = i * 2 * Math.PI / n;
    b.root.add(spoke);
    b.pieces.push({ object: spoke, surface: 'metal', tint: true, edges: false });
  }

  // A barrel through the wheel, then a smaller rounded cap on each face: no front-only sticker.
  b.add(roundedCylinderGeometry(outer * 0.40, depth * 0.68, outer * 0.40, d.curve), 'metal', {
    tint: true, rot: [90, 0, 0],
  });
  for (const side of [-1, 1]) {
    b.add(roundedCylinderGeometry(outer * 0.25, depth * 0.1, outer * 0.25, d.curve), 'metal', {
      color: [196, 202, 212], rot: [90, 0, 0], pos: [0, 0, side * depth * 0.36],
    });
  }
  // All wheel pieces are direct children. Their rotations are about z or exactly 90° about
  // x, so this radial/axial scale introduces no shear and retains correct normal transforms.
  for (const piece of b.pieces) piece.object.applyMatrix4(fit);

}
