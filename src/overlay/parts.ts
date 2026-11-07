// The small kit of ready-made parts the scene language can name (chip, header, port, lens, screen,
// button, fan, wheel). Each is built from the same generic pieces a model could write itself, fitted
// to the box size it is given, so a scene says "port, usb3" instead of listing a dozen boxes.

import { Group, InstancedMesh, Matrix4, Mesh, SphereGeometry, TorusGeometry } from 'three';
import type { AddPart } from '../scene/types.ts';
import { boxGeometry, defaultBevel } from './geometry.ts';
import type { Detail } from './geometry.ts';
import { buildMechanismPart } from './mechanism-parts.ts';
import { Builder, GOLD, cyl } from './parts-base.ts';
import type { BuiltPart, Piece } from './parts-base.ts';
import { buildPort } from './port.ts';

export type { BuiltPart, Piece };

function chip(b: Builder, def: AddPart, d: Detail): void {
  const [sx, sy, sz] = def.size;
  const r = defaultBevel(def.size);
  if (def.variant === 'metal') {
    b.add(boxGeometry([sx, sy * 0.4, sz], r * 0.6, d), 'plastic', { color: [30, 32, 38], pos: [0, -sy * 0.3, 0] });
    b.add(boxGeometry([sx * 0.94, sy * 0.62, sz * 0.94], r, d), 'metal', { tint: true, pos: [0, sy * 0.19, 0], edges: true });
    return;
  }
  b.add(boxGeometry(def.size, r, d), 'plastic', { tint: true, edges: true });
  b.add(boxGeometry([sx * 0.52, 0.01, sz * 0.4], 0, d), 'rubber', { color: [66, 70, 80], pos: [0, sy / 2 + 0.004, 0] });
  b.add(new SphereGeometry(Math.min(sx, sz) * 0.045, 10, 6), 'rubber', { color: [66, 70, 80], pos: [-sx * 0.36, sy / 2 + 0.006, sz * 0.32] });
}

function header(b: Builder, def: AddPart, d: Detail): void {
  const [sx, sy, sz] = def.size;
  const n = def.n ?? 20;
  const base = sy * 0.34;
  b.add(boxGeometry([sx, base, sz], 0.02, d), 'plastic', { tint: true, pos: [0, -sy / 2 + base / 2, 0], edges: true });
  const pw = Math.min((sx / n) * 0.34, sz * 0.24);
  const ph = sy - base;
  const geo = new Mesh(boxGeometry([pw, ph, pw], 0, d)).geometry;
  const rows = 2;
  const pins = new InstancedMesh(geo, undefined as never, n * rows);
  const m = new Matrix4();
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < n; i++) {
      m.makeTranslation(-sx / 2 + (i + 0.5) * (sx / n), -sy / 2 + base + ph / 2, (r - 0.5) * (sz / 2));
      pins.setMatrixAt(r * n + i, m);
    }
  }
  pins.instanceMatrix.needsUpdate = true;
  b.root.add(pins);
  b.pieces.push({ object: pins, surface: 'metal', tint: false, color: GOLD, edges: false, closed: false });
}

function lens(b: Builder, def: AddPart, d: Detail): void {
  const [sx, , sz] = def.size;
  const seg = d.curve;
  b.add(cyl(sx / 2, sx / 2, sz * 0.72, seg), 'rubber', { tint: true, rot: [90, 0, 0], pos: [0, 0, -sz * 0.14], edges: true });
  b.add(cyl(sx * 0.4, sx * 0.4, sz * 0.3, seg), 'metal', { color: [150, 156, 168], rot: [90, 0, 0], pos: [0, 0, sz * 0.22], edges: true });
  const face = b.add(new SphereGeometry(sx * 0.32, seg, 12), 'glass', { color: [34, 54, 110], pos: [0, 0, sz * 0.34] });
  face.scale.z = 0.35;
  b.add(new SphereGeometry(sx * 0.05, 10, 8), 'glow', { color: [210, 226, 255], pos: [sx * 0.1, sx * 0.1, sz * 0.42] });
}

function screen(b: Builder, def: AddPart, d: Detail): void {
  const [sx, sy, sz] = def.size;
  b.add(boxGeometry(def.size, defaultBevel(def.size), d), 'plastic', { tint: true, edges: true });
  b.add(boxGeometry([sx * 0.9, sy * 0.88, 0.01], 0, d), 'glow', { color: [38, 66, 118], pos: [0, 0, sz / 2 + 0.003] });
}

function button(b: Builder, def: AddPart, d: Detail): void {
  const [sx, sy] = def.size;
  const seg = d.curve;
  b.add(cyl(sx / 2, sx / 2, sy * 0.35, seg), 'metal', { color: [176, 182, 194], pos: [0, -sy * 0.325, 0], edges: true });
  b.add(cyl(sx * 0.4, sx * 0.43, sy * 0.65, seg), 'plastic', { tint: true, pos: [0, sy * 0.175, 0], edges: true });
}

function fan(b: Builder, def: AddPart, d: Detail): void {
  const [sx, sy] = def.size;
  const n = def.n ?? 7;
  const seg = d.curve;
  b.add(cyl(sx * 0.12, sx * 0.12, sy, seg), 'plastic', { tint: true, edges: true });
  const bladeLen = sx * 0.34;
  for (let i = 0; i < n; i++) {
    const hold = b.group(b.root, [0, 0, 0], (360 / n) * i);
    const blade = new Mesh(boxGeometry([bladeLen, sy * 0.14, sx * 0.17], sy * 0.05, d));
    blade.position.set(sx * 0.12 + bladeLen / 2, 0, 0);
    blade.rotation.x = (24 * Math.PI) / 180;
    hold.add(blade);
    b.pieces.push({ object: blade, surface: 'plastic', tint: true, edges: true });
  }
  const ring = new Mesh(new TorusGeometry(sx / 2 - sy * 0.2, sy * 0.2, 12, seg * 2).rotateX(Math.PI / 2));
  b.root.add(ring);
  b.pieces.push({ object: ring, surface: 'metal', tint: false, color: [186, 192, 204], edges: false });
}

function wheel(b: Builder, def: AddPart, d: Detail): void {
  const [sx, , sz] = def.size;
  const n = def.n ?? 5;
  const seg = d.curve;
  const outer = sx / 2;
  const tube = Math.min(sz / 2, outer * 0.4);
  const tire = new Mesh(new TorusGeometry(outer - tube, tube, 14, seg * 2));
  b.root.add(tire);
  b.pieces.push({ object: tire, surface: 'rubber', tint: false, color: [32, 34, 40], edges: false });
  b.add(cyl(outer - tube * 1.5, outer - tube * 1.5, sz * 0.5, seg), 'metal', { tint: true, rot: [90, 0, 0], edges: true });
  b.add(cyl(outer * 0.16, outer * 0.16, sz * 0.8, seg), 'metal', { color: [150, 156, 168], rot: [90, 0, 0], edges: true });
  for (let i = 0; i < n; i++) {
    const hold = new Group();
    hold.rotation.z = ((360 / n) * i * Math.PI) / 180;
    b.root.add(hold);
    const spoke = new Mesh(boxGeometry([outer * 0.74, outer * 0.12, sz * 0.62], 0.01, d));
    spoke.position.set(outer * 0.4, 0, 0);
    hold.add(spoke);
    b.pieces.push({ object: spoke, surface: 'metal', tint: false, color: [214, 218, 226], edges: false });
  }
}

export function buildPart(def: AddPart, detail: Detail): BuiltPart {
  const b = new Builder();
  switch (def.part) {
    case 'chip': chip(b, def, detail); break;
    case 'header': header(b, def, detail); break;
    case 'port': buildPort(b, def, detail); break;
    case 'lens': lens(b, def, detail); break;
    case 'screen': screen(b, def, detail); break;
    case 'button': button(b, def, detail); break;
    case 'fan': fan(b, def, detail); break;
    case 'wheel': wheel(b, def, detail); break;
    default: buildMechanismPart(b, def, detail);
  }
  return { root: b.root, pieces: b.pieces, anchors: b.anchors };
}
