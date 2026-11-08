// The surface of a real model's own material: the artist's colour map (and, on the tiers that can afford them, the normal, roughness, metal and occlusion
// maps) drawn through the same physical material the rest of the overlay uses, so lighting, shadows and finishing treat it like anything else. A material
// that is glass in the source (transmission, or blended transparency) is drawn as the overlay's own glass; a flat-colour surface is never made here.

import { DoubleSide, MeshPhysicalMaterial } from 'three';
import type { Material, MeshStandardMaterial } from 'three';
import { makeSurface } from './materials.ts';
import type { Surface, TierSettings } from './materials.ts';

/** The name a textured surface carries. A textured part's colour is white, so its texture shows as it is; a style colour multiplies it (a tint). */
export const TEXTURED = 'textured';

/** Whether the source meant this material to be seen through. */
export function seeThrough(source: Material): boolean {
  const m = source as MeshStandardMaterial & { transmission?: number };
  return (m.transmission ?? 0) > 0 || m.transparent === true;
}

/**
 * A surface for one piece of a textured model. The source material and its textures are the store's and are shared: the surface only points at them, so
 * letting the surface go (disposing the material) never takes a texture from another part.
 */
export function modelSurface(source: Material, tier: TierSettings): Surface {
  if (seeThrough(source)) return makeSurface('glass', tier);
  const s = source as MeshStandardMaterial;
  const full = tier.modelMaps === 'full';
  // Where the source's roughness and metal come from a map and this tier does not draw maps, the factors alone would mislead (a glTF's metal factor of 1 would
  // turn a plain colour map to dark chrome), so the surface takes a plain, slightly glossy finish.
  const plain = !full && (s.metalnessMap !== null || s.roughnessMap !== null);
  const m = new MeshPhysicalMaterial({
    color: 0xffffff, map: s.map ?? null, roughness: plain ? 0.6 : s.roughness ?? 0.6, metalness: plain ? 0.1 : s.metalness ?? 0,
    side: s.side === DoubleSide ? DoubleSide : 0, envMapIntensity: 1,
    ...(full ? { normalMap: s.normalMap ?? null, roughnessMap: s.roughnessMap ?? null, metalnessMap: s.metalnessMap ?? null, aoMap: s.aoMap ?? null } : {}),
  }) as Surface;
  if (full && s.normalMap) m.normalScale.copy(s.normalScale);
  m.userData = { base: 1, glow: 0, name: TEXTURED };
  return m;
}
