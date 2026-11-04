// The named surfaces the scene language offers, as three.js materials, and the quality tiers the
// renderer runs at. A surface is physically based (roughness, metalness, a little clear coat) and
// is lit by the environment, so it reads as a real object, not a flat colour.

import { Color, DoubleSide, MeshPhysicalMaterial } from 'three';
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

export type SurfaceName = 'plastic' | 'metal' | 'rubber' | 'pcb' | 'glass' | 'glow' | 'paper';

type Recipe = {
  roughness: number; metalness: number; clearcoat?: number; clearcoatRoughness?: number;
  /** The opacity the surface has at full strength. */
  opacity?: number; envMapIntensity?: number; emissive?: number; doubleSided?: boolean;
};

const RECIPES: Record<SurfaceName, Recipe> = {
  plastic: { roughness: 0.46, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.4 },
  metal: { roughness: 0.3, metalness: 1, envMapIntensity: 1.1 },
  rubber: { roughness: 0.92, metalness: 0 },
  pcb: { roughness: 0.52, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.3 },
  glass: { roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, opacity: 0.34, envMapIntensity: 1.5, doubleSided: true },
  glow: { roughness: 0.6, metalness: 0, emissive: 1.25 },
  paper: { roughness: 0.96, metalness: 0, doubleSided: true },
};

export type Surface = MeshPhysicalMaterial & { userData: { base: number; glow: number } };

export function makeSurface(name: string | undefined, tier: TierSettings): Surface {
  const r = RECIPES[(name as SurfaceName) in RECIPES ? (name as SurfaceName) : 'plastic'];
  const m = new MeshPhysicalMaterial({
    color: 0xffffff, roughness: r.roughness, metalness: r.metalness,
    clearcoat: tier.clearcoat ? r.clearcoat ?? 0 : 0, clearcoatRoughness: r.clearcoatRoughness ?? 0,
    envMapIntensity: r.envMapIntensity ?? 1, transparent: true, side: r.doubleSided ? DoubleSide : 0,
  }) as Surface;
  m.userData = { base: r.opacity ?? 1, glow: r.emissive ?? 0 };
  if (name === 'glass') m.depthWrite = false;
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
