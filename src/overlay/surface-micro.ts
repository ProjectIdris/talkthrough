// The finest surface of a material, made in the shader from the object's own coordinates (no image, no UV, so it does not stretch with a part's size
// and costs no memory): a faint variation of roughness and a fine bump, which is what keeps a surface from looking computer-perfect (a machined
// metal catches the light unevenly, a moulded plastic has a grain), and, for a circuit board, the board itself: solder mask over copper traces, pads
// and silkscreen, drawn on the faces that look up and down. Each layer is a few arithmetic steps per pixel; a tier that does not ask for a layer
// compiles without it.

import type { BufferGeometry, MeshPhysicalMaterial } from 'three';

export type MicroSurface = {
  /** How far roughness swings about its recipe value (0 none, 0.3 a lot): the rest of the layer is one more number each. */
  rough: number;
  /** Cycles of the variation to a unit of the object. */
  grain: number;
  /** Strength of the fine bump (0 none). */
  bump: number;
  /** 0 nothing, 1 traces and pads, 2 traces, pads and silkscreen. */
  board: 0 | 1 | 2;
};

const COMMON = `
float microHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float microNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(microHash(i), microHash(i + vec3(1,0,0)), f.x), mix(microHash(i + vec3(0,1,0)), microHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(microHash(i + vec3(0,0,1)), microHash(i + vec3(1,0,1)), f.x), mix(microHash(i + vec3(0,1,1)), microHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float microHash2(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
`;

/**
 * A board seen from above: traces (runs of parallel lines in both directions with gaps, as routing leaves them), round pads with a hole, and
 * silkscreen outlines and bars. The result: a covering amount for each of three layers, and the height used for the bump.
 */
const BOARD = `
float boardLine(float across, float pitch, float width, float aa) {
  float f = (fract(across / pitch) - 0.5) * pitch;
  return 1.0 - smoothstep(width * 0.5 - aa, width * 0.5 + aa, abs(f));
}
// One direction of routing: rows of pitch p, each cut into runs of random length, some missing.
float boardRuns(vec2 q, float pitch, float width, float run, float seed, float aa) {
  float row = floor(q.y / pitch);
  float len = run * (0.7 + 0.9 * microHash2(vec2(row, seed)));
  float id = floor((q.x + len * microHash2(vec2(row, seed + 7.0))) / len);
  float on = step(0.62, microHash2(vec2(row * 1.7 + seed, id)));
  return on * boardLine(q.y, pitch, width, aa);
}
void boardLayers(vec2 q, float aa, out float trace, out float pad, out float hole, out float silk) {
  trace = max(boardRuns(q, 0.1, 0.03, 1.1, 1.0, aa), boardRuns(q.yx + 0.31, 0.1, 0.03, 1.1, 5.0, aa));
  // pads on a coarse grid, one in four present
  vec2 cell = q / 0.3; vec2 id = floor(cell); vec2 f = (fract(cell) - 0.5) * 0.3;
  float has = step(0.86, microHash2(id + 3.1));
  float d = length(f);
  pad = has * (1.0 - smoothstep(0.062 - aa, 0.062 + aa, d));
  hole = has * (1.0 - smoothstep(0.026 - aa, 0.026 + aa, d));
  // silkscreen: a thin outline of a part's footprint and a short bar, in cells where one lands
  vec2 sc = q / 0.52; vec2 sid = floor(sc); vec2 sf = (fract(sc) - 0.5) * 0.52;
  float r = microHash2(sid + 9.7);
  float box = step(0.9, r) * (1.0 - smoothstep(0.006 - aa, 0.006 + aa, abs(max(abs(sf.x) - 0.17, abs(sf.y) - 0.09))));
  box *= step(max(abs(sf.x) - 0.17, abs(sf.y) - 0.09), 0.012);
  float bar = step(0.95, r) * step(abs(sf.y + 0.2), 0.012) * step(abs(sf.x), 0.14 * (0.4 + microHash2(sid + 2.3)));
  silk = max(box, bar);
}
`;

export function applyMicroSurface(material: MeshPhysicalMaterial, o: MicroSurface): void {
  if (o.rough <= 0 && o.bump <= 0 && o.board === 0) return;
  const unit = { value: 1 };
  material.userData.boardUnit = unit;
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  const defines = [o.rough > 0 ? '#define MICRO_ROUGH' : '', o.bump > 0 ? '#define MICRO_BUMP' : '', o.board > 0 ? '#define MICRO_BOARD' : '', o.board > 1 ? '#define MICRO_SILK' : ''].join('\n');
  // The numbers go in as uniforms, not into the program: every material of a tier then shares one program (steel, iron, brass and cast differ only in three floats).
  const own = { microGrain: { value: o.grain }, microRoughAmt: { value: o.rough }, microBumpAmt: { value: o.bump }, boardUnit: unit };
  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    Object.assign(shader.uniforms, own);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vMicroP;\nvarying vec3 vMicroN;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vMicroP = position;\n  vMicroN = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${defines}\nuniform float microGrain;\nuniform float microRoughAmt;\nuniform float microBumpAmt;\nuniform float boardUnit;\nvarying vec3 vMicroP;\nvarying vec3 vMicroN;\n${COMMON}\n#ifdef MICRO_BOARD\n${BOARD}\n#endif\nvoid main() {
  float microRough = 1.0;
  float microHeight = 0.0;
  float boardMetal = 0.0;
  float boardRough = -1.0;
  float boardHeight = 0.0;
#ifdef MICRO_ROUGH
  float mn = microNoise(vMicroP * microGrain) * 0.65 + microNoise(vMicroP * microGrain * 2.7) * 0.35;
  // Out of reach of the pixels the variation fades to nothing (a surface seen from far has no grain, and aliasing would only crawl).
  float microFoot = max(length(dFdx(vMicroP)), length(dFdy(vMicroP)));
  microRough = 1.0 + microRoughAmt * (mn * 2.0 - 1.0) * (1.0 - smoothstep(0.2, 0.5, microFoot * microGrain * 2.7));
#endif
#ifdef MICRO_BUMP
  {
    float g2 = microGrain * 2.2;
    float fp = max(length(dFdx(vMicroP)), length(dFdy(vMicroP)));
    microHeight = (microNoise(vMicroP * g2) - 0.5) * microBumpAmt * 0.03 / g2 * (1.0 - smoothstep(0.2, 0.5, fp * g2));
  }
#endif`)
      .replace('#include <color_fragment>', `#include <color_fragment>
#ifdef MICRO_BOARD
  {
    float up = abs(vMicroN.y);
    if (up > 0.9) {
      vec2 q = vMicroP.xz / boardUnit;
      float aa = max(fwidth(q.x), fwidth(q.y)) * 0.7;
      float trace, pad, hole, silk;
      boardLayers(q, aa, trace, pad, hole, silk);
      // copper under the mask shows as a lighter, glossier green; a pad is bare gold; the hole is dark; silkscreen is white paint
      vec3 mask = diffuseColor.rgb;
      mask *= mix(1.0, 1.28, trace);
      boardHeight = trace * 0.5;
      vec3 gold = vec3(0.78, 0.55, 0.18);
      mask = mix(mask, gold, pad);
      boardMetal = pad;
      boardRough = mix(-1.0, 0.28, pad);
      boardHeight = max(boardHeight, pad * 0.8);
      mask = mix(mask, vec3(0.02), hole);
      boardHeight *= 1.0 - hole;
#ifdef MICRO_SILK
      mask = mix(mask, vec3(0.86, 0.88, 0.84), silk * (1.0 - pad));
      boardRough = mix(boardRough, 0.7, silk * (1.0 - pad));
      boardHeight = max(boardHeight, silk * 0.25 * (1.0 - pad));
#endif
      diffuseColor.rgb = mask;
      float fade = 1.0 - smoothstep(0.5, 1.2, aa / 0.03);
      boardMetal *= fade;
    }
  }
#endif`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = clamp(roughnessFactor * microRough, 0.03, 1.0);
#ifdef MICRO_BOARD
  if (boardRough >= 0.0) roughnessFactor = boardRough;
#endif`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
#ifdef MICRO_BOARD
  metalnessFactor = max(metalnessFactor, boardMetal);
#endif`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
#if defined(MICRO_BUMP) || defined(MICRO_BOARD)
  {
    float hgt = microHeight + boardHeight * 0.004 * boardUnit;
    vec2 dHdxy = vec2(dFdx(hgt), dFdy(hgt));
    vec3 q0 = dFdx(-vViewPosition.xyz);
    vec3 q1 = dFdy(-vViewPosition.xyz);
    vec3 R1 = cross(q1, normal);
    vec3 R2 = cross(normal, q0);
    float fDet = dot(q0, R1);
    vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
    normal = normalize(abs(fDet) * normal - vGrad);
  }
#endif`);
  };
  material.customProgramCacheKey = () => `${previousKey}|micro-v2|${defines.replace(/\s+/g, '')}`;
}

/** The pattern of a board is drawn for a board about 6 by 4; this sets its scale from the geometry so a board written at any size carries the same detail. */
export function fitBoardPattern(material: MeshPhysicalMaterial, geometry: BufferGeometry): void {
  const unit = material.userData.boardUnit as { value: number } | undefined;
  if (!unit) return;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return;
  const w = box.max.x - box.min.x, d = box.max.z - box.min.z;
  if (!(w > 0 && d > 0)) return;
  unit.value = Math.min(100, Math.max(0.01, Math.sqrt(w * d) / Math.sqrt(24)));
}
