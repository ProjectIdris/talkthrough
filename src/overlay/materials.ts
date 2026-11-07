// The named surfaces the scene language offers, as three.js materials, and the quality tiers the
// renderer runs at. A surface is physically based (roughness, metalness, a little clear coat) and
// is lit by the environment, so it reads as a real object, not a flat colour.

import { Color, DoubleSide, MeshPhysicalMaterial } from 'three';
import type { Material } from 'three';
import type { SurfaceFinish } from '../scene/types.ts';
import type { Rgb } from './timeline.ts';

export type Tier = 'low' | 'mid' | 'high';

export type TierSettings = {
  /** Multisample antialiasing on the 3D canvas. */
  msaa: boolean;
  /** Real shadows on the page (the soft blob under the model is always there). */
  shadows: boolean;
  shadowMapSize: number;
  /** Dark edge lines on solids. */
  edges: boolean;
  /** Most device pixels per CSS pixel the 3D layer renders at. */
  maxPixelRatio: number;
  /** Clear coat on glossy surfaces. */
  clearcoat: boolean;
};

export const TIERS: Record<Tier, TierSettings> = {
  low: { msaa: false, shadows: false, shadowMapSize: 512, edges: false, maxPixelRatio: 1, clearcoat: false },
  mid: { msaa: true, shadows: true, shadowMapSize: 1024, edges: true, maxPixelRatio: 1.5, clearcoat: true },
  high: { msaa: true, shadows: true, shadowMapSize: 2048, edges: true, maxPixelRatio: 2, clearcoat: true },
};

/** The surfaces a scene can name, and two the parts kit uses inside itself: painted metal and rough cast metal. */
export type SurfaceName = 'plastic' | 'metal' | 'rubber' | 'pcb' | 'glass' | 'glow' | 'bead' | 'paper' | 'tissue' | 'enamel' | 'cast' | 'section';

type Recipe = {
  roughness: number; metalness: number; clearcoat?: number; clearcoatRoughness?: number;
  /** The opacity the surface has at full strength. */
  opacity?: number; envMapIntensity?: number; emissive?: number; doubleSided?: boolean;
  /** A soft light along the edges that turn from the viewer (cloth, skin, tissue). */
  sheen?: number;
};

const RECIPES: Record<SurfaceName, Recipe> = {
  plastic: { roughness: 0.46, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.4 },
  metal: { roughness: 0.3, metalness: 1, envMapIntensity: 1.1 },
  rubber: { roughness: 0.92, metalness: 0 },
  pcb: { roughness: 0.52, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.3 },
  glass: { roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, opacity: 0.34, envMapIntensity: 1.5, doubleSided: true },
  glow: { roughness: 0.6, metalness: 0, emissive: 1.25 },
  // A marker that travels along a pipe: a little self-light so it stays bright, but shaded and glossy so it reads as a bead on a pale or see-through tube.
  bead: { roughness: 0.3, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.1, emissive: 0.4 },
  paper: { roughness: 0.96, metalness: 0, doubleSided: true },
  // Living tissue: soft and a little wet, a gentle sheen over a matte body.
  tissue: { roughness: 0.62, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.55, sheen: 0.8 },
  // Painted metal: a little of the metal under the paint shows in the shine, and the lacquer over it is glassy.
  enamel: { roughness: 0.34, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1.1 },
  // Sand-cast metal: rough and even, with no mirror in it.
  cast: { roughness: 0.42, metalness: 1, envMapIntensity: 1.05 },
  // The flat cut face of a part drawn already cut open (hatched, see `hatched`).
  section: { roughness: 0.7, metalness: 0.1 },
};

export type Surface = MeshPhysicalMaterial & { userData: { base: number; glow: number } };

export function makeSurface(name: string | undefined, tier: TierSettings, finish: SurfaceFinish = {}): Surface {
  const r = RECIPES[(name as SurfaceName) in RECIPES ? (name as SurfaceName) : 'plastic'];
  const m = new MeshPhysicalMaterial({
    color: 0xffffff, roughness: finish.roughness ?? r.roughness, metalness: finish.metalness ?? r.metalness,
    clearcoat: tier.clearcoat ? finish.clearcoat ?? r.clearcoat ?? 0 : 0,
    clearcoatRoughness: finish.clearcoatRoughness ?? r.clearcoatRoughness ?? 0,
    envMapIntensity: r.envMapIntensity ?? 1, transparent: true, side: r.doubleSided ? DoubleSide : 0,
  }) as Surface;
  if (r.sheen) {
    m.sheen = r.sheen;
    m.sheenRoughness = 0.5;
    m.sheenColor.setRGB(1, 0.9, 0.88);
  }
  m.userData = { base: r.opacity ?? 1, glow: r.emissive ?? 0 };
  if (name === 'glass') m.depthWrite = false;
  if (name === 'section') hatched(m);
  return m;
}

const scratch = new Color();

/** Sets a surface's tint, strength and glow for the moment. `alpha` is the object's own opacity. */
export function applySurface(m: Surface, rgb: Rgb, alpha: number, pulse: number, pulseRgb: Rgb | undefined): void {
  m.color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, 'srgb');
  m.opacity = alpha * m.userData.base;
  if (m.userData.glow > 0 || pulse > 0) {
    const glow = pulseRgb ?? rgb;
    scratch.setRGB(glow[0] / 255, glow[1] / 255, glow[2] / 255, 'srgb');
    m.emissive.copy(scratch);
    m.emissiveIntensity = Math.max(m.userData.glow, 0.9 * pulse);
  } else {
    m.emissiveIntensity = 0;
  }
  if (m.userData.base < 1) m.depthWrite = false;
  else m.depthWrite = alpha >= 0.999;
}

/**
 * A cut face reads as a section, not as more of the part: a warm, light cut-metal tone (a fifth of the part's own colour
 * in it, so two parts of different colours still differ) with fine diagonal hatching, the way a drawing marks a cut.
 */
export const SECTION: Rgb = [236, 190, 122];
export function sectionTone(rgb: readonly number[], out: Color): void {
  const mix = (i: number): number => Math.min(1, (SECTION[i]! * 0.8 + rgb[i]! * 0.2) / 255);
  out.setRGB(mix(0), mix(1), mix(2), 'srgb');
}

// Integral of the stripe minus its 0.24 mean, restricted to one period. Keeping
// this periodic avoids subtracting large accumulated integrals at distant origins.
const SECTION_FILTER = `
float sectionHatchPrimitive(float x) {
  float a = clamp((x - 0.38) / 0.12, 0.0, 1.0);
  float b = clamp((x - 0.62) / 0.12, 0.0, 1.0);
  return 0.12 * (a*a*a*(1.0 - 0.5*a) - b*b*b*(1.0 - 0.5*b))
    + max(x - 0.50, 0.0) - max(x - 0.74, 0.0) - 0.24*x;
}
float filteredSectionHatch(float phase, float footprint) {
  float p = fract(phase);
  // At magnification retain the original soft stripe without cancellation noise.
  if (footprint < 0.001) {
    return smoothstep(0.38, 0.5, p) * (1.0 - smoothstep(0.62, 0.74, p));
  }
  float halfWidth = 0.5 * footprint;
  float coverage = 0.24 + (sectionHatchPrimitive(fract(p + halfWidth))
    - sectionHatchPrimitive(fract(p - halfWidth))) / footprint;
  return clamp(coverage, 0.0, 1.0);
}
`;

/** World-space section stripes, averaged over their projected pixel footprint. */
export function hatched(material: Material): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vCapWorld;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vCapWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `varying vec3 vCapWorld;\n${SECTION_FILTER}\nvoid main() {\n  float capPhase = dot(vCapWorld, vec3(0.78, 0.55, 0.3)) / 0.16;\n  float capCoverage = filteredSectionHatch(capPhase, fwidth(capPhase));`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= mix(1.0, 0.55, capCoverage);');
  };
  material.customProgramCacheKey = () => 'section-hatch-filtered-v1';
}
