// Rounded edges for flat-faced shapes that have none (a convex hull, a tapered extrusion): where two faces meet at a sharp angle the shading
// turns from the face's normal toward the normal of the face beyond, over a narrow band beside the edge, so the edge catches a thin highlight the way a
// small fillet does. Nothing is added to the geometry but five small attributes (the same on a triangle's three corners), and the shader does a few steps
// per pixel. Boxes, extrusions and cylinders are rounded in their geometry already and do not use this.

import { BufferAttribute, Vector3 } from 'three';
import type { BufferGeometry, MeshPhysicalMaterial } from 'three';

/** Edges meeting at less than this angle stay as they are (a gentle bend is already smooth). */
const MIN_ANGLE = 28;
/** The width of the rounded band, as a fraction of the shape's size. */
const BAND = 0.045;

export const EDGE_ATTRIBUTES = ['edgeBary', 'edgeAlt', 'edgeNb0', 'edgeNb1', 'edgeNb2'] as const;

/** Makes the geometry's faces known to their neighbours. Returns the same geometry (made non-indexed), or undefined when it has no faces to work on. */
export function softenEdges(source: BufferGeometry): BufferGeometry | undefined {
  const geo = source.index ? source.toNonIndexed() : source;
  if (geo !== source) { Object.assign(geo.userData, source.userData); source.dispose(); }
  const pos = geo.getAttribute('position');
  if (!pos || pos.count < 3) return undefined;
  const tris = Math.floor(pos.count / 3);
  geo.computeBoundingBox();
  const size = geo.boundingBox ? geo.boundingBox.getSize(new Vector3()) : new Vector3(1, 1, 1);
  const band = BAND * Math.max(size.x, size.y, size.z, 1e-6);

  const p = (i: number): [number, number, number] => [pos.getX(i), pos.getY(i), pos.getZ(i)];
  const normals = new Float32Array(tris * 3);
  const area = new Float32Array(tris);
  for (let t = 0; t < tris; t++) {
    const a = p(t * 3), b = p(t * 3 + 1), c = p(t * 3 + 2);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    normals[t * 3] = nx / l; normals[t * 3 + 1] = ny / l; normals[t * 3 + 2] = nz / l;
    area[t] = l / 2;
  }
  // Which triangle lies across each edge: edges keyed by their two end points (to a fine grid), the same key from either side.
  const q = (v: [number, number, number]): string => `${Math.round(v[0] * 1e4)},${Math.round(v[1] * 1e4)},${Math.round(v[2] * 1e4)}`;
  const across = new Map<string, number[]>();
  const edgeKey = (a: [number, number, number], b: [number, number, number]): string => { const ka = q(a), kb = q(b); return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`; };
  for (let t = 0; t < tris; t++) {
    const v = [p(t * 3), p(t * 3 + 1), p(t * 3 + 2)] as const;
    for (let e = 0; e < 3; e++) {
      const k = edgeKey(v[(e + 1) % 3]!, v[(e + 2) % 3]!);
      const list = across.get(k);
      if (list) list.push(t); else across.set(k, [t]);
    }
  }
  const cos = Math.cos((MIN_ANGLE * Math.PI) / 180);
  const bary = new Float32Array(pos.count * 3), alt = new Float32Array(pos.count * 4);
  const nb: Float32Array[] = [new Float32Array(pos.count * 3), new Float32Array(pos.count * 3), new Float32Array(pos.count * 3)];
  let any = false;
  for (let t = 0; t < tris; t++) {
    const v = [p(t * 3), p(t * 3 + 1), p(t * 3 + 2)] as const;
    const own = [normals[t * 3]!, normals[t * 3 + 1]!, normals[t * 3 + 2]!];
    for (let e = 0; e < 3; e++) {
      // The edge opposite corner e, and the altitude of that corner over it.
      const a = v[(e + 1) % 3]!, b = v[(e + 2) % 3]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
      const height = (2 * area[t]!) / len;
      const others = (across.get(edgeKey(a, b)) ?? []).filter((o) => o !== t);
      let n: number[] | undefined;
      // Only an edge shared with one other face is a crease of the surface; where several meet, or none, the shading is left alone.
      if (others.length === 1) {
        const o = others[0]!;
        const m = [normals[o * 3]!, normals[o * 3 + 1]!, normals[o * 3 + 2]!];
        if (own[0]! * m[0]! + own[1]! * m[1]! + own[2]! * m[2]! < cos) { n = m; any = true; }
      }
      for (let k = 0; k < 3; k++) {
        const i = t * 3 + k;
        alt[i * 4 + e] = height;
        nb[e]![i * 3] = n ? n[0]! : 0; nb[e]![i * 3 + 1] = n ? n[1]! : 0; nb[e]![i * 3 + 2] = n ? n[2]! : 0;
      }
    }
    for (let k = 0; k < 3; k++) {
      const i = t * 3 + k;
      bary[i * 3 + k] = 1;
      alt[i * 4 + 3] = band;
    }
  }
  if (!any) return undefined;
  geo.setAttribute('edgeBary', new BufferAttribute(bary, 3));
  geo.setAttribute('edgeAlt', new BufferAttribute(alt, 4));
  geo.setAttribute('edgeNb0', new BufferAttribute(nb[0]!, 3));
  geo.setAttribute('edgeNb1', new BufferAttribute(nb[1]!, 3));
  geo.setAttribute('edgeNb2', new BufferAttribute(nb[2]!, 3));
  return geo;
}

/** Makes a surface read the attributes above (a surface on a geometry without them must not be given this). */
export function applyEdgeSoften(material: MeshPhysicalMaterial): void {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `attribute vec3 edgeBary;\nattribute vec4 edgeAlt;\nattribute vec3 edgeNb0;\nattribute vec3 edgeNb1;\nattribute vec3 edgeNb2;
varying vec3 vEdgeBary;\nvarying vec4 vEdgeAlt;\nvarying vec3 vEdgeN0;\nvarying vec3 vEdgeN1;\nvarying vec3 vEdgeN2;\nvoid main() {
  vEdgeBary = edgeBary; vEdgeAlt = edgeAlt;
  // (a zero neighbour means no crease on that side; normalising a zero vector would be NaN, so it stays zero)
  vEdgeN0 = normalMatrix * edgeNb0; vEdgeN1 = normalMatrix * edgeNb1; vEdgeN2 = normalMatrix * edgeNb2;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying vec3 vEdgeBary;\nvarying vec4 vEdgeAlt;\nvarying vec3 vEdgeN0;\nvarying vec3 vEdgeN1;\nvarying vec3 vEdgeN2;\nvoid main() {')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    float edgeW = max(vEdgeAlt.w, 1e-6);
    vec3 edgeAdd = vec3(0.0);
    float t0 = 1.0 - smoothstep(0.0, edgeW, vEdgeBary.x * vEdgeAlt.x);
    float t1 = 1.0 - smoothstep(0.0, edgeW, vEdgeBary.y * vEdgeAlt.y);
    float t2 = 1.0 - smoothstep(0.0, edgeW, vEdgeBary.z * vEdgeAlt.z);
    // A bent normal on a mirror finish picks up whatever dark part of the room is there and draws a grey band: polished metal takes much less of it.
    float soft = mix(1.0, 0.25, clamp(metalnessFactor, 0.0, 1.0));
    edgeAdd += (t0 * t0 * vEdgeN0 + t1 * t1 * vEdgeN1 + t2 * t2 * vEdgeN2) * 1.2 * soft;
    if (dot(edgeAdd, edgeAdd) > 0.0) normal = normalize(normal + edgeAdd);
    // the thin light line a small fillet shows along its length
    float rim = max(t0 * t0, max(t1 * t1, t2 * t2)) * step(0.0001, dot(edgeAdd, edgeAdd));
    diffuseColor.rgb *= 1.0 + 0.22 * rim * soft;
    roughnessFactor = max(0.05, roughnessFactor - 0.12 * rim);
  }`);
  };
  material.customProgramCacheKey = () => `${previousKey}|edge-soften-v4`;
}
