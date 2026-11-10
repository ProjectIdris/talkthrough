// The finest surface of a material, made in the shader from the object's own coordinates (no image, no UV, so it does not stretch with a part's size
// and costs no memory): a faint variation of roughness and a fine bump, which is what keeps a surface from looking computer-perfect (a machined
// metal catches the light unevenly, a moulded plastic has a grain), a pattern on the colour where a material has one (the grain of wood, the speckle of stone, the veins
// of marble, a weave, the courses of a brick wall), and, for a circuit board, the board itself: solder mask over copper traces, pads
// and silkscreen, drawn on the faces that look up and down. Each layer is a few arithmetic steps per pixel; a tier that does not ask for a layer
// compiles without it.

import { Vector4 } from 'three';
import type { BufferGeometry, MeshPhysicalMaterial } from 'three';

/** The patterns a material can wear on its colour. Each is a number between -1 and 1 over the surface, made from the part's own coordinates. */
export type PatternKind = 'grain' | 'speckle' | 'veins' | 'weave' | 'twill' | 'bricks' | 'mottle' | 'pores' | 'fibre' | 'glitter' | 'organ' | 'skin' | 'rind' | 'venation';
const PATTERN_ID: Record<PatternKind, number> = { grain: 1, speckle: 2, veins: 3, weave: 4, twill: 5, bricks: 6, mottle: 7, pores: 8, fibre: 9, glitter: 10, organ: 11, skin: 12, rind: 13, venation: 14 };

export type MicroSurface = {
  /** How far roughness swings about its recipe value (0 none, 0.3 a lot): the rest of the layer is one more number each. */
  rough: number;
  /** Cycles of the variation to a unit of the object. */
  grain: number;
  /** Strength of the fine bump (0 none). */
  bump: number;
  /** 0 nothing, 1 traces and pads, 2 traces, pads and silkscreen. */
  board: 0 | 1 | 2;
  /** A pattern drawn on the colour: its kind, how many cycles to a unit of the object, and how strongly (0.3: the colour varies by about a third). */
  pattern?: { kind: PatternKind; scale: number; amount: number };
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
 * The patterns, each a value from about -1 (darker) to 1 (lighter) for a point of the object. `q` is the point in cycles, `n` the surface normal (a flat pattern is
 * laid on the two axes across it), `fade` how much of the pattern the pixels can still tell apart (a surface seen from far has its average colour, not a crawl).
 */
const PATTERNS = `
vec2 patPlane(vec3 q, vec3 n) {
  vec3 a = abs(n);
  return a.x > a.y && a.x > a.z ? q.zy : (a.y > a.z ? q.xz : q.xy);
}
float patGrain(vec3 q, float foot) {
  // streaks along x: noise that varies quickly across the part and slowly along it, with dark lines where the noise crosses a level; each scale of it
  // fades out on its own when the pixels can no longer tell it apart (a surface seen from far has its average colour, not a crawl)
  float g1 = microNoise(vec3(q.x * 0.25, q.y * 1.2, q.z * 1.2));
  float g2 = microNoise(vec3(q.x * 0.4, q.y * 5.0, q.z * 5.0));
  float line = 1.0 - smoothstep(0.0, 0.25, abs(fract(g1 * 5.0) - 0.5) * 2.0);
  float tone = (g1 - 0.5) * 3.0 * (1.0 - smoothstep(0.25, 0.5, foot * 1.2));
  float fine = (g2 - 0.5) * 2.0 * (1.0 - smoothstep(0.25, 0.5, foot * 5.0));
  return clamp(tone * 0.6 + fine * 0.5 - 0.9 * line * (1.0 - smoothstep(0.25, 0.5, foot * 6.0)), -1.0, 1.0);
}
float patSpeckle(vec3 q, float fade) {
  float c = microHash(floor(q * 3.0));
  return ((microNoise(q * 3.0) - 0.5) * 1.2 + (c - 0.5) * 0.8) * fade;
}
float patVeins(vec3 q, float fade) {
  float w = microNoise(q * 0.7) * 4.0 + microNoise(q * 1.9);
  float v = abs(sin(q.x * 0.8 + q.y * 0.5 + w * 1.6));
  float line = 1.0 - smoothstep(0.0, 0.1, v);
  return (-line + (microNoise(q * 0.9) - 0.5) * 0.3) * fade;
}
float patWeave(vec3 q, vec3 n, float fade) {
  vec2 uv = patPlane(q, n);
  float f = 0.3 * (sin(uv.x * 6.2832) + sin(uv.y * 6.2832)) + (microHash2(floor(uv)) - 0.5) * 0.4;
  return f * fade;
}
float patTwill(vec3 q, vec3 n, float fade) {
  vec2 uv = patPlane(q, n);
  float f = 0.5 * sin((uv.x + uv.y) * 6.2832) + 0.3 * sin((uv.x - uv.y) * 3.1416);
  return f * fade;
}
float patBricks(vec3 q, vec3 n, float fade) {
  vec2 uv = patPlane(q, n);
  vec2 b = vec2(uv.x * 0.5 + 0.5 * mod(floor(uv.y), 2.0), uv.y);
  vec2 fr = fract(b);
  float mx = min(fr.x, 1.0 - fr.x) * 2.0;
  float my = min(fr.y, 1.0 - fr.y);
  float mortar = 1.0 - smoothstep(0.04, 0.07, min(mx, my));
  float tone = (microHash2(floor(b)) - 0.5) * 0.5 + (microNoise(q * 6.0) - 0.5) * 0.4;
  // from far the courses blend to their average; the mortar is the light line, so its average is a little above the brick
  return mix(0.15, mix(tone, 1.6, mortar), fade);
}
// Soft clouds of lighter and darker: the uneven colour of an organ, a petal or a block of wax.
float patMottle(vec3 q, float fade) {
  float n = microNoise(q * 0.8) * 0.6 + microNoise(q * 2.1 + 7.0) * 0.4;
  return (n - 0.5) * 2.4 * fade;
}
// Fine dimples, one in a few cells: the pores of a skin or a rind.
float patPores(vec3 q, float fade) {
  vec3 c = q * 4.0;
  vec3 i = floor(c);
  vec3 off = (vec3(microHash(i + 1.7), microHash(i + 3.1), microHash(i + 5.3)) - 0.5) * 0.5;
  float d = length(fract(c) - 0.5 - off);
  float dimple = (1.0 - smoothstep(0.08, 0.2, d)) * step(0.45, microHash(i));
  return (-dimple + (microNoise(q * 1.1) - 0.5) * 0.5) * fade;
}
// Fine streaks along x: muscle and nerve fibres, the brush marks of a satin metal. Each of its two scales fades on its own.
float patFibre(vec3 q, float foot) {
  float a = microNoise(vec3(q.x * 0.15, q.y * 9.0, q.z * 9.0));
  float b = microNoise(vec3(q.x * 0.3, q.y * 22.0, q.z * 22.0));
  return (a - 0.5) * 1.4 * (1.0 - smoothstep(0.25, 0.6, foot * 9.0)) + (b - 0.5) * 0.9 * (1.0 - smoothstep(0.25, 0.6, foot * 22.0));
}
// Crystals that catch the light one at a time: bright and dark specks (sugar, salt, frost).
float patGlitter(vec3 q, float fade) {
  float c = microHash(floor(q * 4.0));
  float spark = step(0.9, c) - 0.5 * step(c, 0.1);
  return (spark + (microNoise(q * 4.0) - 0.5) * 0.4) * fade;
}
float patternValue(float kind, vec3 q, vec3 n, float foot) {
  float v = 0.0;
  if (kind < 1.5) v = patGrain(q, foot);
  else if (kind < 2.5) v = patSpeckle(q, 1.0 - smoothstep(0.25, 0.7, foot * 3.0));
  else if (kind < 3.5) v = patVeins(q, 1.0 - smoothstep(0.25, 0.7, foot * 1.9));
  else if (kind < 4.5) v = patWeave(q, n, 1.0 - smoothstep(0.2, 0.5, foot * 1.0));
  else if (kind < 5.5) v = patTwill(q, n, 1.0 - smoothstep(0.2, 0.5, foot * 1.0));
  else if (kind < 6.5) v = patBricks(q, n, 1.0 - smoothstep(0.3, 0.8, foot * 0.7));
  else if (kind < 7.5) v = patMottle(q, 1.0 - smoothstep(0.25, 0.7, foot * 2.1));
  else if (kind < 8.5) v = patPores(q, 1.0 - smoothstep(0.25, 0.7, foot * 4.0));
  else if (kind < 9.5) v = patFibre(q, foot);
  else v = patGlitter(q, 1.0 - smoothstep(0.25, 0.7, foot * 4.0));
  return v;
}
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

/**
 * The patterns of living things (an organ's vessels, skin, a fruit's blush, a leaf's veins). Each is compiled only into the programs of the material that
 * wears it: such a program holds one of them and none of the patterns above, so it is no slower to build than a plain one. All of them together in every
 * program made each program several times slower to compile, which shows as a pause the first time a material is drawn.
 */
const LIVING_HEAD = `
// The patterns of living things also shift the hue: above zero warmer (a flush, a vein of a leaf), below cooler (a vessel under an organ's skin).
float patHue = 0.0;
`;
const LIVING: Partial<Record<PatternKind, string>> = {
  organ: `
// An organ: clouds of lighter and darker, and the vessels that run over it, a large net and a finer one.
float patOrgan(vec3 q, float foot) {
  float m = microNoise(q * 0.8) * 0.6 + microNoise(q * 2.1 + 7.0) * 0.4;
  vec3 w = q + (vec3(microNoise(q * 0.7 + 3.1), microNoise(q * 0.7 + 9.2), microNoise(q * 0.7 + 5.7)) - 0.5) * 1.6;
  float a = abs(microNoise(w * 0.75) - 0.5);
  float b = abs(microNoise(w * 2.2 + 4.0) - 0.5);
  float la = (1.0 - smoothstep(0.012, 0.04, a)) * (1.0 - smoothstep(0.08, 0.25, foot * 0.75));
  float lb = (1.0 - smoothstep(0.012, 0.045, b)) * 0.55 * (1.0 - smoothstep(0.08, 0.25, foot * 2.2));
  float vessels = max(la, lb);
  float cloud = (m - 0.5) * (1.0 - smoothstep(0.25, 0.7, foot * 2.1));
  patHue = -0.9 * vessels + cloud * 0.6;
  return cloud * 1.8 - vessels * 0.9;
}
float patLiving(vec3 p, vec3 n, float foot) { return patOrgan(p * patScale, foot); }
`,
  skin: `
// Skin: flushed and paler patches, and the fine lines of its surface where the eye is near enough to tell them apart.
float patSkin(vec3 q, float foot) {
  float m = microNoise(q * 0.6 + 2.0) * 0.6 + microNoise(q * 1.7 + 11.0) * 0.4;
  float fine = abs(microNoise(q * 9.0) - 0.5) + abs(microNoise(q * 9.0 + 3.3) - 0.5);
  float lines = (1.0 - smoothstep(0.03, 0.12, fine)) * (1.0 - smoothstep(0.2, 0.5, foot * 9.0));
  float cloud = (m - 0.5) * (1.0 - smoothstep(0.25, 0.7, foot * 1.7));
  patHue = cloud * 1.5;
  return -cloud * 0.8 - lines * 0.5;
}
float patLiving(vec3 p, vec3 n, float foot) { return patSkin(p * patScale, foot); }
`,
  rind: `
// A fruit's skin: a blush that deepens on one side and in patches, and small pale specks.
float patRind(vec3 q, vec3 n, float foot) {
  float m = microNoise(q * 0.35 + 5.0) * 0.65 + microNoise(q * 1.1 + 1.0) * 0.35;
  float blush = smoothstep(0.38, 0.72, m + n.x * 0.16 + n.y * 0.1);
  vec3 c = q * 5.0; vec3 i = floor(c);
  vec3 off = (vec3(microHash(i + 1.7), microHash(i + 3.1), microHash(i + 5.3)) - 0.5) * 0.6;
  float speck = (1.0 - smoothstep(0.06, 0.16, length(fract(c) - 0.5 - off))) * step(0.55, microHash(i)) * (1.0 - smoothstep(0.25, 0.7, foot * 5.0));
  patHue = blush * 1.6;
  return -blush * 0.9 + speck * 1.2;
}
float patLiving(vec3 p, vec3 n, float foot) { return patRind(p * patScale, n, foot); }
`,
  venation: `
uniform vec4 patA;
uniform vec4 patB;
uniform vec4 patC;
// A leaf: the midrib, the side veins that leave it toward the tip (the two sides out of step), and the net between them. p is the point in the leaf's own
// units; patA is the base and the length, patB the way to the tip and the half width, patC the way across.
float patVenation(vec3 p, float px) {
  vec3 r = p - patA.xyz;
  float len = patA.w, wide = patB.w;
  float y = dot(r, patB.xyz);
  float x = dot(r, patC.xyz);
  float ax = abs(x);
  float t = clamp(y / len, 0.0, 1.0);
  float wm = len * 0.011 * (1.5 - t);
  float mid = 1.0 - smoothstep(wm, wm * 1.8 + px, ax);
  float gap = len / 8.5;
  float run = y - ax * 0.75 - ax * ax * 0.35 / wide;
  float dv = abs(fract(run / gap + (x > 0.0 ? 0.5 : 0.0)) - 0.5) * gap;
  float ws = len * 0.0055 * (1.0 - 0.6 * clamp(ax / wide, 0.0, 1.0));
  float side = (1.0 - smoothstep(ws, ws * 1.8 + px, dv)) * (1.0 - smoothstep(0.2, 0.45, px / gap));
  float cells = 26.0 / len;
  float net = (1.0 - smoothstep(0.02, 0.07, abs(microNoise(p * cells) - 0.5))) * 0.45 * (1.0 - smoothstep(0.1, 0.3, px * cells));
  float v = max(mid, max(side, net));
  patHue = v * 1.2;
  return v * 1.6 + (microNoise(p * (3.0 / len) + 4.0) - 0.5) * 0.5;
}
float patLiving(vec3 p, vec3 n, float foot) { return patVenation(p, foot / patScale); }
`,
};

export function applyMicroSurface(material: MeshPhysicalMaterial, o: MicroSurface): void {
  if (o.rough <= 0 && o.bump <= 0 && o.board === 0 && !o.pattern) return;
  const unit = { value: 1 };
  material.userData.boardUnit = unit;
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  const living = o.pattern ? LIVING[o.pattern.kind] : undefined;
  const defines = [o.rough > 0 ? '#define MICRO_ROUGH' : '', o.bump > 0 ? '#define MICRO_BUMP' : '', o.board > 0 ? '#define MICRO_BOARD' : '', o.board > 1 ? '#define MICRO_SILK' : '', o.pattern && !living ? '#define MICRO_PATTERN' : '', living ? `#define MICRO_LIVING ${PATTERN_ID[o.pattern!.kind]}` : ''].join('\n');
  // The numbers go in as uniforms, not into the program: every material of a tier then shares one program (steel, iron, brass and cast differ only in three floats).
  const own = { microGrain: { value: o.grain }, microRoughAmt: { value: o.rough }, microBumpAmt: { value: o.bump }, boardUnit: unit, patKind: { value: o.pattern ? PATTERN_ID[o.pattern.kind] : 0 }, patScale: { value: o.pattern?.scale ?? 1 }, patAmt: { value: o.pattern?.amount ?? 0 }, patA: { value: new Vector4(0, 0, 0, 1) }, patB: { value: new Vector4(0, 1, 0, 1) }, patC: { value: new Vector4(1, 0, 0, 0) } };
  // A pattern laid along a part (a leaf's veins) is fitted to the part when it is built (see fitLeafPattern); until then it is not shown.
  if (o.pattern?.kind === 'venation') { own.patAmt.value = 0; material.userData.leaf = { amount: own.patAmt, full: o.pattern.amount, a: own.patA.value, b: own.patB.value, c: own.patC.value }; }
  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    Object.assign(shader.uniforms, own);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vMicroP;\nvarying vec3 vMicroN;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vMicroP = position;\n  vMicroN = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${defines}\nuniform float microGrain;\nuniform float microRoughAmt;\nuniform float microBumpAmt;\nuniform float boardUnit;\nuniform float patKind;\nuniform float patScale;\nuniform float patAmt;\nvarying vec3 vMicroP;\nvarying vec3 vMicroN;\n${COMMON}\n#ifdef MICRO_PATTERN\n${PATTERNS}\n#endif\n${living ? LIVING_HEAD + living : ''}\n#ifdef MICRO_BOARD\n${BOARD}\n#endif\nvoid main() {
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
#ifdef MICRO_PATTERN
  {
    float patFoot = max(length(dFdx(vMicroP)), length(dFdy(vMicroP))) * patScale;
    float pv = patternValue(patKind, vMicroP * patScale, normalize(vMicroN), patFoot);
    diffuseColor.rgb *= max(vec3(0.0), vec3(1.0 + patAmt * pv));
  }
#endif
#ifdef MICRO_LIVING
  {
    float patFoot = max(length(dFdx(vMicroP)), length(dFdy(vMicroP))) * patScale;
    float pv = patLiving(vMicroP, normalize(vMicroN), patFoot);
    diffuseColor.rgb *= max(vec3(0.0), vec3(1.0 + patAmt * pv));
    diffuseColor.rgb *= max(vec3(0.0), vec3(1.0 + patAmt * patHue * 0.6, 1.0, 1.0 - patAmt * patHue * 0.6));
  }
#endif
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
  material.customProgramCacheKey = () => `${previousKey}|micro-v6|${defines.replace(/\s+/g, '')}`;
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

/**
 * A leaf's veins run from its base to its tip: this sets where those are for one part. `base` and `tip` are points of the part (its own space), `normal` the
 * way its face looks and `half` half its width; a part that is no sheet (a ball of leaf material, a stem) wears no veins.
 */
export function fitLeafPattern(material: MeshPhysicalMaterial, base?: readonly [number, number, number], tip?: readonly [number, number, number], normal?: readonly [number, number, number], half?: number): void {
  const leaf = material.userData.leaf as { amount: { value: number }; full: number; a: Vector4; b: Vector4; c: Vector4 } | undefined;
  if (!leaf) return;
  if (!base || !tip || !normal || !half) { leaf.amount.value = 0; return; }
  const ax = tip[0] - base[0], ay = tip[1] - base[1], az = tip[2] - base[2];
  const len = Math.hypot(ax, ay, az);
  if (!(len > 1e-6)) { leaf.amount.value = 0; return; }
  const ux = ax / len, uy = ay / len, uz = az / len;
  // across: in the sheet, at right angles to the midrib
  let cx = uy * normal[2] - uz * normal[1], cy = uz * normal[0] - ux * normal[2], cz = ux * normal[1] - uy * normal[0];
  const cl = Math.hypot(cx, cy, cz) || 1;
  cx /= cl; cy /= cl; cz /= cl;
  leaf.amount.value = leaf.full;
  leaf.a.set(base[0], base[1], base[2], len);
  leaf.b.set(ux, uy, uz, Math.max(half, len * 0.05));
  leaf.c.set(cx, cy, cz, 0);
}
