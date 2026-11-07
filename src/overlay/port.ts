// Recognisable, recessed connector sockets. These are explanatory models, not connector CAD.
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AddPart, Vec2, Vec3 } from '../scene/types.ts';
import { boxGeometry } from './geometry.ts';
import type { Detail } from './geometry.ts';
import { BLACK, Builder, GOLD } from './parts-base.ts';
import type { Rgb } from './timeline.ts';

/** Counterclockwise outlines, shared by every depth ring so the shell needs no cap triangulation. */
function outline(variant: string, segments: number): Vec2[] {
  const points: Vec2[] = [];
  if (variant === 'hdmi') {
    const corners: Vec2[] = [[-.5, .5], [-.5, -.18], [-.33, -.5], [.33, -.5], [.5, -.18], [.5, .5]];
    for (let i = 0; i < corners.length; i++) {
      const a = corners[(i + corners.length - 1) % corners.length]!, b = corners[i]!, c = corners[(i + 1) % corners.length]!;
      const start: Vec2 = [b[0] + (a[0] - b[0]) * .08, b[1] + (a[1] - b[1]) * .08];
      const end: Vec2 = [b[0] + (c[0] - b[0]) * .08, b[1] + (c[1] - b[1]) * .08];
      for (let j = 0; j <= segments; j++) {
        const t = j / segments, u = 1 - t;
        points.push([u * u * start[0] + 2 * u * t * b[0] + t * t * end[0], u * u * start[1] + 2 * u * t * b[1] + t * t * end[1]]);
      }
    }
  } else {
    const rx = variant === 'usbc' ? .23 : .045, ry = variant === 'usbc' ? .5 : .07;
    for (let corner = 0; corner < 4; corner++) {
      const cx = (corner === 0 || corner === 3 ? 1 : -1) * (.5 - rx);
      const cy = (corner < 2 ? 1 : -1) * (.5 - ry);
      for (let j = 0; j <= segments; j++) {
        // The two half-circles of USB-C meet at their end points; don't duplicate those vertices.
        if (variant === 'usbc' && j === segments && (corner === 1 || corner === 3)) continue;
        const a = (corner + j / segments) * Math.PI / 2;
        points.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
      }
    }
  }
  return points;
}

function shell(variant: string, d: Detail): BufferGeometry {
  const points = outline(variant, Math.max(2, Math.round(d.curve / 8)));
  // Outer back, body, rounded front lip, inner lip and cavity wall, inner back.
  const rings: Vec3[] = [[.96, .96, -.5], [1, 1, -.46], [1, 1, .46], [.96, .96, .5], [.86, .76, .5], [.82, .70, .46], [.82, .70, -.46], [.86, .76, -.5]];
  const positions: number[] = [], indices: number[] = [], uv: number[] = [];
  for (const [sx, sy, z] of rings) for (const [x, y] of points) {
    positions.push(x * sx, y * sy, z);
    uv.push(x + .5, y + .5);
  }
  const n = points.length;
  for (let ring = 0; ring < rings.length; ring++) for (let i = 0; i < n; i++) {
    const a = ring * n + i, b = ring * n + (i + 1) % n;
    const c = ((ring + 1) % rings.length) * n + (i + 1) % n, e = ((ring + 1) % rings.length) * n + i;
    indices.push(a, b, c, a, c, e);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geo.setIndex(indices);
  const creased = toCreasedNormals(geo, .8);
  geo.dispose();
  return creased;
}

/** A solid back following the socket outline, including its rounded/tapered sides. */
function backing(variant: string, d: Detail): BufferGeometry {
  const points = outline(variant, Math.max(2, Math.round(d.curve / 8)));
  const positions: number[] = [], indices: number[] = [];
  for (const z of [-.5, -.42]) for (const [x, y] of points) positions.push(x * .86, y * .76, z);
  const n = points.length;
  positions.push(0, 0, -.5, 0, 0, -.42);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(i, j, n + j, i, n + j, n + i, 2 * n, j, i, 2 * n + 1, n + i, n + j);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  const creased = toCreasedNormals(geo, .8);
  geo.dispose();
  return creased;
}

export function buildPort(b: Builder, def: AddPart, d: Detail): void {
  const variant = def.variant ?? 'usb';
  // Construct in unit coordinates. Very small authored sizes must not collapse the normal helper's buckets.
  b.add(shell(variant, d), 'metal', { tint: true, edges: false });
  const box = (size: Vec3, pos: Vec3, surface: string, color: Rgb, bevel = .008) =>
    b.add(boxGeometry(size, Math.min(bevel, ...size.map(s => s * .2)), d), surface, { color, pos });
  // A recessed dark backing closes the cavity, rather than a black rectangle hiding a solid front.
  b.add(backing(variant, d), 'rubber', { color: BLACK });
  const contactGeometry: BufferGeometry[] = [];
  const contactDetail = { ...d, bevel: 1 };
  const contacts = (count: number, width: number, y: number, z: number, depth: number) => {
    for (let i = 0; i < count; i++) {
      const geo = boxGeometry([width / count * .48, .018, depth], .003, contactDetail);
      geo.translate(-width / 2 + width * (i + .5) / count, y, z);
      contactGeometry.push(geo);
    }
  };
  switch (variant) {
    case 'ethernet':
      // Lower ledges leave a centred latch recess; upper contacts have actual depth.
      box([.70, .08, .65], [0, .17, -.095], 'plastic', [38, 40, 46]);
      contacts(8, .57, .12, -.02, .48);
      for (const side of [-1, 1]) box([.20, .16, .68], [side * .25, -.27, -.08], 'plastic', [38, 40, 46]);
      break;
    case 'usbc':
      box([.60, .12, .64], [0, 0, -.10], 'plastic', [48, 51, 58], .025);
      contacts(12, .52, .066, -.04, .40);
      contacts(12, .52, -.066, -.04, .40);
      break;
    case 'hdmi':
      box([.68, .14, .64], [0, -.03, -.10], 'plastic', [43, 46, 52]);
      contacts(10, .60, .046, -.04, .42);
      contacts(9, .56, -.106, -.04, .42);
      break;
    default:
      box([.70, .16, .68], [0, -.12, -.08], 'plastic', variant === 'usb3' ? [44, 112, 232] : [226, 229, 236]);
      contacts(4, .59, -.032, .04, .36);
      if (variant === 'usb3') contacts(5, .61, -.032, -.29, .18);
      break;
  }
  // Disjoint closed contacts share a draw mesh and keep ordinary stencil-cap support.
  b.add(mergeGeometries(contactGeometry)!, 'metal', { color: GOLD });
  for (const geo of contactGeometry) geo.dispose();
  for (const piece of b.pieces) {
    piece.object.scale.set(...def.size);
    piece.object.position.multiply(piece.object.scale);
  }
}
