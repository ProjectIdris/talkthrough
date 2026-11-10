// The look of what light does inside a material, made in the shader on top of the stock physical one (no image, no extra pass, no extra object): the soft
// glow of light scattered inside flesh, wax and fruit (a subsurface look), the depth of a liquid (clear in the middle, richer and more reflective towards its
// edges, with a little focused light low down and a slow ripple on its face), the shape of what shines (a lens bright at its centre, a neon tube white-hot
// in its core, an ember dark crust cracked with light), and how strongly a surface shows the room (a mirror more, a lamp's lens much less). Only the code a
// material asks for is put in the shader, and a tier that does not ask for the look compiles without it; the numbers are uniforms, so every material of a tier
// that asks for the same layers shares one program.

import type { MeshPhysicalMaterial } from 'three';

/** What shines, and how: a lens (centre hot, edge the colour), a tube (a white-hot core in a coloured ring), or a crust cracked with light. */
export type GlowShape = 'lens' | 'tube' | 'crust';
const GLOW_ID: Record<GlowShape, number> = { lens: 1, tube: 2, crust: 3 };

export type Look = {
  /** Light scattered inside (flesh, wax, fruit, petal): 0 none, 1 strong. A glow of the material's own deeper colour that the shade and the edges keep. */
  subsurface?: number;
  /** The depth of a liquid: 0 none, 1 full (more opaque and darker towards the edge, focused light low down, a ripple). */
  liquid?: number;
  glow?: GlowShape;
  /** How strongly the surface shows the room's reflections, against the stock 1 (a mirror more, a lamp's lens much less). Three ignores a material's own envMapIntensity when the room is the scene's environment, so this is where it is set. */
  env?: number;
};

const NOISE = `
float lookHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float lookNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(lookHash(i), lookHash(i + vec3(1,0,0)), f.x), mix(lookHash(i + vec3(0,1,0)), lookHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(lookHash(i + vec3(0,0,1)), lookHash(i + vec3(1,0,1)), f.x), mix(lookHash(i + vec3(0,1,1)), lookHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
`;

// An ember: the colour is the glow of its cracks, the crust between is nearly black. The cracks are where a smooth noise crosses its middle value.
const CRUST_COLOUR = `
  {
    float cs = 6.0;
    float n = lookNoise(vLookP * cs) * 0.62 + lookNoise(vLookP * cs * 2.3 + 5.0) * 0.38;
    float ridge = 1.0 - abs(n * 2.0 - 1.0);
    float foot = max(length(dFdx(vLookP)), length(dFdy(vLookP))) * cs * 2.3;
    // from far the cracks blend to their average, so the surface does not crawl
    lookCrack = mix(smoothstep(0.8, 0.95, ridge), 0.18, smoothstep(0.3, 0.7, foot));
    diffuseColor.rgb = mix(vec3(0.045, 0.03, 0.026), diffuseColor.rgb, lookCrack);
  }`;
// A lens or a tube is lit from inside: its body takes little of the room's light, so the glow carries the colour.
const BODY_DARK = `
  diffuseColor.rgb *= 0.3;`;

// A slow ripple on the face: the highlights wander a little, as they do on a moving surface.
const RIPPLE = `
  {
    float g = 2.6;
    float foot = max(length(dFdx(vLookP)), length(dFdy(vLookP))) * g;
    float hgt = (lookNoise(vLookP * g) * 0.65 + lookNoise(vLookP * g * 2.3) * 0.35 - 0.5) * 0.03 * lookLiquid * (1.0 - smoothstep(0.2, 0.5, foot));
    vec2 dHdxy = vec2(dFdx(hgt), dFdy(hgt));
    vec3 q0 = dFdx(-vViewPosition.xyz);
    vec3 q1 = dFdy(-vViewPosition.xyz);
    vec3 R1 = cross(q1, normal);
    vec3 R2 = cross(normal, q0);
    float fDet = dot(q0, R1);
    vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
    normal = normalize(abs(fDet) * normal - vGrad);
  }`;

const ENV = `
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
  radiance *= lookEnv;
#ifdef USE_CLEARCOAT
  clearcoatRadiance *= lookEnv;
#endif
#endif`;

const glowCode = (shape: GlowShape): string => {
  const head = `
  {
    float ndv = clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0);
    vec3 e = totalEmissiveRadiance;`;
  // a lens: the centre is the hottest and nearest white, the rim keeps the colour
  if (shape === 'lens') return `${head}
    totalEmissiveRadiance = mix(e * 0.55, mix(e, vec3(1.0), 0.75) * 1.3, pow(ndv, 6.0));
  }`;
  // a tube: the core is white-hot, the ring round it is the gas's colour
  if (shape === 'tube') return `${head}
    totalEmissiveRadiance = mix(e * 0.6, vec3(1.0) * 1.2 + e * 0.3, pow(ndv, 9.0));
  }`;
  // the cracks are hottest in their middle (yellow-white), the crust only warm
  return `${head}
    vec3 hot = e / max(max(e.r, e.g), max(e.b, 0.001));
    totalEmissiveRadiance = mix(hot * 0.06, mix(hot, vec3(1.0, 0.75, 0.3), 0.35) * 0.95, lookCrack * lookCrack) * min(1.0, length(e));
  }`;
};

export function applyLook(material: MeshPhysicalMaterial, o: Look): void {
  const sss = o.subsurface ?? 0, liquid = o.liquid ?? 0;
  const env = o.env !== undefined && o.env !== 1 ? o.env : undefined;
  if (sss <= 0 && liquid <= 0 && !o.glow && env === undefined) return;
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  const defines = [sss > 0 ? '#define LOOK_SSS' : '', liquid > 0 ? '#define LOOK_LIQUID' : '', o.glow ? '#define LOOK_GLOW' : '', o.glow === 'crust' ? '#define LOOK_CRUST' : '', env !== undefined ? '#define LOOK_ENV' : ''].filter(Boolean).join('\n');
  const own = { lookSss: { value: sss }, lookLiquid: { value: liquid }, lookGlow: { value: o.glow ? GLOW_ID[o.glow] : 0 }, lookEnv: { value: env ?? 1 } };
  // The code of each stage, only for the layers this material has.
  const colour = `${o.glow === 'lens' || o.glow === 'tube' ? BODY_DARK : ''}${o.glow === 'crust' ? CRUST_COLOUR : ''}`;
  const bump = liquid > 0 ? RIPPLE : '';
  const reflect = env !== undefined ? ENV : '';
  const emit = o.glow ? glowCode(o.glow) : '';
  const scatter = sss > 0 ? `
  {
    // light that went in and came out again: the colour's own deeper shade, kept in the shadow and at the edges where the flesh is thin
    float edge = 1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0);
    vec3 c = diffuseColor.rgb;
    vec3 deep = pow(c, vec3(1.5)) / max(max(c.r, max(c.g, c.b)), 0.25);
    outgoingLight += deep * lookSss * (0.3 + 0.7 * pow(edge, 1.6)) * 0.45;
    // seen through, living tissue is a wall: thin where it faces the eye, thick where it turns away (in a solid surface the alpha is not used)
    diffuseColor.a *= min(mix(0.6, 2.4, pow(edge, 1.7)), 1.0 / max(diffuseColor.a, 0.001));
  }` : '';
  const depth = liquid > 0 ? `
  {
    float edge = 1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0);
    float fr = pow(edge, 2.2);
    // thin in the middle (clear), deep at the edge (more opaque, richer, more reflective)
    diffuseColor.a = clamp(diffuseColor.a * mix(0.6, 1.3, fr), 0.0, 1.0);
    outgoingLight *= mix(1.0, 0.7, fr * lookLiquid);
    // light that the volume focuses low down: a bright glow near the bottom of the body
    outgoingLight += diffuseColor.rgb * smoothstep(0.1, 0.85, -normal.y) * (1.0 - fr) * 0.3 * lookLiquid;
  }` : '';
  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    Object.assign(shader.uniforms, own);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vLookP;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vLookP = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${defines}\nuniform float lookSss;\nuniform float lookLiquid;\nuniform float lookGlow;\nuniform float lookEnv;\nvarying vec3 vLookP;\n${NOISE}\nvoid main() {\n  float lookCrack = 1.0;`)
      .replace('#include <color_fragment>', `#include <color_fragment>${colour}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>${bump}`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>${reflect}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>${emit}`)
      .replace('#include <opaque_fragment>', `${scatter}${depth}\n#include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => `${previousKey}|look-v4|${defines.replace(/\s+/g, '')}`;
}
