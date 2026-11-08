// The named surfaces the scene language offers, as three.js materials, and the quality tiers the
// renderer runs at. A surface is physically based (roughness, metalness, a little clear coat) and
// is lit by the environment, so it reads as a real object, not a flat colour.

import { Color, DoubleSide, MeshPhysicalMaterial } from 'three';
import type { Material } from 'three';
import type { SurfaceFinish } from '../scene/types.ts';
import { applyMicroSurface } from './surface-micro.ts';
import type { PatternKind } from './surface-micro.ts';
import { fitTint } from '../scene/material-library.ts';
import type { MaterialName } from '../scene/material-library.ts';
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
  /** The finest surface (surface-micro.ts): 0 none, 1 a variation of roughness, 2 that and a fine bump. */
  micro: 0 | 1 | 2;
  /** A circuit board's own surface: 0 plain, 1 traces and pads, 2 with silkscreen. */
  board: 0 | 1 | 2;
  /** A real model's textured materials (model-surface.ts): its colour map only, or that with its normal, roughness, metal and occlusion maps. */
  modelMaps: 'colour' | 'full';
  /** The longest side, in pixels, a real model's texture keeps on this tier (larger ones are reduced when the model loads). */
  modelTexture: number;
};

export const TIERS: Record<Tier, TierSettings> = {
  low: { msaa: false, shadows: false, shadowMapSize: 512, edges: false, maxPixelRatio: 1, clearcoat: false, micro: 0, board: 1, modelMaps: 'colour', modelTexture: 1024 },
  mid: { msaa: true, shadows: true, shadowMapSize: 1024, edges: true, maxPixelRatio: 1.5, clearcoat: true, micro: 1, board: 2, modelMaps: 'full', modelTexture: 2048 },
  high: { msaa: true, shadows: true, shadowMapSize: 2048, edges: true, maxPixelRatio: 2, clearcoat: true, micro: 2, board: 2, modelMaps: 'full', modelTexture: 2048 },
};

/** The surfaces a scene can name, and two the parts kit uses inside itself: painted metal and rough cast metal. */
export type SurfaceName = MaterialName | 'bead' | 'enamel' | 'cast' | 'section';

type Recipe = {
  roughness: number; metalness: number; clearcoat?: number; clearcoatRoughness?: number;
  /** The opacity the surface has at full strength. */
  opacity?: number; envMapIntensity?: number; emissive?: number; doubleSided?: boolean;
  /** A soft light along the edges that turn from the viewer (cloth, skin, tissue). */
  sheen?: number;
  /** The finest surface: how far roughness swings, how many cycles to a unit, and the strength of the fine bump. */
  micro?: { rough: number; grain: number; bump: number };
  /** The surface is a circuit board's (solder mask, traces, pads, silkscreen). */
  board?: boolean;
  /** How strongly the surface bends light (glass 1.5 is the default): ice 1.31, water 1.33, a gem 2.4. Changes how bright its reflections are. */
  ior?: number;
  /** How rough the soft edge light is (cloth 0.5; velvet, which glows right at its edge, less). */
  sheenRoughness?: number;
  /** A pattern drawn on the colour from the part's own coordinates (wood grain, stone speckle, marble veins, weave, brick courses): its kind, cycles to a unit, and strength. */
  pattern?: { kind: PatternKind; scale: number; amount: number };
};

const RECIPES: Record<SurfaceName, Recipe> = {
  plastic: { roughness: 0.4, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.35, micro: { rough: 0.14, grain: 26, bump: 0.5 } },
  metal: { roughness: 0.32, metalness: 1, envMapIntensity: 1.1, micro: { rough: 0.1, grain: 70, bump: 0.3 } },
  rubber: { roughness: 0.88, metalness: 0, micro: { rough: 0.1, grain: 34, bump: 0.9 } },
  pcb: { roughness: 0.38, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.3, micro: { rough: 0.1, grain: 30, bump: 0.3 }, board: true },
  glass: { roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, opacity: 0.34, envMapIntensity: 1.5, doubleSided: true },
  glow: { roughness: 0.6, metalness: 0, emissive: 1.25 },
  // A marker that travels along a pipe: a little self-light so it stays bright, but shaded and glossy so it reads as a bead on a pale or see-through tube.
  bead: { roughness: 0.3, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.1, emissive: 0.4 },
  paper: { roughness: 0.96, metalness: 0, doubleSided: true },
  // Living tissue: soft and a little wet, a gentle sheen over a matte body.
  tissue: { roughness: 0.62, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.55, sheen: 0.8, micro: { rough: 0.07, grain: 12, bump: 0.15 } },
  // Living and organic: matte to softly wet, in the colours their names ask for, none of them shiny plastic.
  bone: { roughness: 0.58, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.55, micro: { rough: 0.07, grain: 12, bump: 0.15 } },
  muscle: { roughness: 0.55, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.45, sheen: 0.5, micro: { rough: 0.07, grain: 12, bump: 0.15 } },
  tendon: { roughness: 0.38, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.3, sheen: 0.4 },
  skin: { roughness: 0.6, metalness: 0, clearcoat: 0.18, clearcoatRoughness: 0.6, sheen: 0.7, micro: { rough: 0.07, grain: 12, bump: 0.15 } },
  // Metals and their kin: the plain metal's recipe, tuned.
  steel: { roughness: 0.3, metalness: 1, envMapIntensity: 1.1, micro: { rough: 0.1, grain: 70, bump: 0.3 } },
  iron: { roughness: 0.5, metalness: 0.92, envMapIntensity: 0.95, micro: { rough: 0.16, grain: 36, bump: 0.8 } },
  brass: { roughness: 0.28, metalness: 1, envMapIntensity: 1.1, micro: { rough: 0.1, grain: 66, bump: 0.25 } },
  copper: { roughness: 0.3, metalness: 1, envMapIntensity: 1.1, micro: { rough: 0.1, grain: 66, bump: 0.25 } },
  wood: { roughness: 0.75, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.7, micro: { rough: 0.14, grain: 22, bump: 0.6 } },
  rope: { roughness: 0.95, metalness: 0, sheen: 0.4 },
  water: { roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, opacity: 0.58, envMapIntensity: 1.3, doubleSided: true },
  // The wider library (see material-library.ts for the names, families and aliases). Metals: smooth to cast, each with the fine unevenness of its finish.
  stainless: { roughness: 0.22, metalness: 1, envMapIntensity: 1.1, micro: { rough: 0.1, grain: 80, bump: 0.15 } },
  aluminium: { roughness: 0.36, metalness: 1, envMapIntensity: 1.1, micro: { rough: 0.1, grain: 60, bump: 0.3 } },
  'cast-iron': { roughness: 0.62, metalness: 0.92, envMapIntensity: 0.95, micro: { rough: 0.2, grain: 28, bump: 1 } },
  bronze: { roughness: 0.32, metalness: 1, envMapIntensity: 1.1, micro: { rough: 0.1, grain: 62, bump: 0.3 } },
  gold: { roughness: 0.2, metalness: 1, envMapIntensity: 1.2, micro: { rough: 0.08, grain: 80, bump: 0.12 } },
  silver: { roughness: 0.14, metalness: 1, envMapIntensity: 1.2, micro: { rough: 0.08, grain: 90, bump: 0.1 } },
  chrome: { roughness: 0.05, metalness: 1, envMapIntensity: 1.35, micro: { rough: 0.03, grain: 90, bump: 0 } },
  rust: { roughness: 0.9, metalness: 0.35, envMapIntensity: 0.7, micro: { rough: 0.28, grain: 20, bump: 1.2 }, pattern: { kind: 'speckle', scale: 6, amount: 0.5 } },
  titanium: { roughness: 0.4, metalness: 1, envMapIntensity: 1.1, micro: { rough: 0.1, grain: 70, bump: 0.2 } },
  lead: { roughness: 0.55, metalness: 0.95, micro: { rough: 0.18, grain: 26, bump: 0.8 } },
  mirror: { roughness: 0.02, metalness: 1, envMapIntensity: 1.5 },
  // Woods: a varnish where the wood is finished, and the grain along the part.
  'light-wood': { roughness: 0.7, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.65, micro: { rough: 0.12, grain: 22, bump: 0.5 }, pattern: { kind: 'grain', scale: 5, amount: 0.22 } },
  'dark-wood': { roughness: 0.62, metalness: 0, clearcoat: 0.2, clearcoatRoughness: 0.5, micro: { rough: 0.12, grain: 22, bump: 0.5 }, pattern: { kind: 'grain', scale: 5, amount: 0.25 } },
  oak: { roughness: 0.72, metalness: 0, clearcoat: 0.1, clearcoatRoughness: 0.7, micro: { rough: 0.12, grain: 22, bump: 0.5 }, pattern: { kind: 'grain', scale: 4, amount: 0.25 } },
  pine: { roughness: 0.78, metalness: 0, clearcoat: 0.08, clearcoatRoughness: 0.7, micro: { rough: 0.12, grain: 22, bump: 0.5 }, pattern: { kind: 'grain', scale: 6, amount: 0.28 } },
  walnut: { roughness: 0.55, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.45, micro: { rough: 0.12, grain: 22, bump: 0.5 }, pattern: { kind: 'grain', scale: 4, amount: 0.22 } },
  birch: { roughness: 0.72, metalness: 0, clearcoat: 0.1, clearcoatRoughness: 0.7, micro: { rough: 0.12, grain: 22, bump: 0.5 }, pattern: { kind: 'grain', scale: 7, amount: 0.15 } },
  plywood: { roughness: 0.8, metalness: 0, clearcoat: 0, clearcoatRoughness: 0, micro: { rough: 0.12, grain: 22, bump: 0.5 }, pattern: { kind: 'grain', scale: 8, amount: 0.2 } },
  bamboo: { roughness: 0.6, metalness: 0, clearcoat: 0.2, clearcoatRoughness: 0.5, micro: { rough: 0.12, grain: 22, bump: 0.5 }, pattern: { kind: 'grain', scale: 3, amount: 0.25 } },
  // Plastics and rubbers.
  'glossy-plastic': { roughness: 0.12, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.08, micro: { rough: 0.04, grain: 26, bump: 0.2 } },
  'matte-plastic': { roughness: 0.8, metalness: 0, micro: { rough: 0.12, grain: 26, bump: 0.6 } },
  'clear-plastic': { roughness: 0.08, metalness: 0, clearcoat: 0.9, clearcoatRoughness: 0.06, opacity: 0.45, envMapIntensity: 1.4, doubleSided: true },
  abs: { roughness: 0.42, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.4, micro: { rough: 0.1, grain: 40, bump: 0.4 } },
  nylon: { roughness: 0.5, metalness: 0, sheen: 0.15, micro: { rough: 0.1, grain: 30, bump: 0.4 } },
  foam: { roughness: 1, metalness: 0, micro: { rough: 0.2, grain: 16, bump: 1.4 }, pattern: { kind: 'speckle', scale: 10, amount: 0.12 } },
  acrylic: { roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, opacity: 0.4, envMapIntensity: 1.4, doubleSided: true },
  silicone: { roughness: 0.5, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.5, sheen: 0.3, micro: { rough: 0.05, grain: 14, bump: 0.15 } },
  // Glass: see-through (not refractive), clear to frosted to tinted, and the stones that are cut from it.
  'frosted-glass': { roughness: 0.55, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.5, opacity: 0.62, envMapIntensity: 1.1, doubleSided: true },
  'tinted-glass': { roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, opacity: 0.52, envMapIntensity: 1.5, doubleSided: true },
  crystal: { roughness: 0.02, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, opacity: 0.42, envMapIntensity: 1.6, doubleSided: true, ior: 1.55 },
  gem: { roughness: 0.02, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, opacity: 0.8, envMapIntensity: 1.7, doubleSided: true, ior: 2.4 },
  // Ceramics, stone and earth.
  ceramic: { roughness: 0.22, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.1, micro: { rough: 0.04, grain: 20, bump: 0.15 } },
  porcelain: { roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06 },
  terracotta: { roughness: 0.86, metalness: 0, micro: { rough: 0.16, grain: 22, bump: 0.9 }, pattern: { kind: 'speckle', scale: 8, amount: 0.12 } },
  stone: { roughness: 0.86, metalness: 0, micro: { rough: 0.15, grain: 14, bump: 1.2 }, pattern: { kind: 'speckle', scale: 5, amount: 0.28 } },
  granite: { roughness: 0.42, metalness: 0, clearcoat: 0.2, clearcoatRoughness: 0.4, micro: { rough: 0.1, grain: 20, bump: 0.5 }, pattern: { kind: 'speckle', scale: 7, amount: 0.4 } },
  slate: { roughness: 0.7, metalness: 0, micro: { rough: 0.12, grain: 18, bump: 0.9 }, pattern: { kind: 'speckle', scale: 3, amount: 0.18 } },
  marble: { roughness: 0.16, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.2, micro: { rough: 0.04, grain: 12, bump: 0.1 }, pattern: { kind: 'veins', scale: 3, amount: 0.5 } },
  concrete: { roughness: 0.94, metalness: 0, micro: { rough: 0.16, grain: 16, bump: 1.4 }, pattern: { kind: 'speckle', scale: 6, amount: 0.22 } },
  brick: { roughness: 0.9, metalness: 0, micro: { rough: 0.14, grain: 18, bump: 1 }, pattern: { kind: 'bricks', scale: 4, amount: 0.55 } },
  sand: { roughness: 1, metalness: 0, micro: { rough: 0.2, grain: 36, bump: 1.2 }, pattern: { kind: 'speckle', scale: 14, amount: 0.3 } },
  soil: { roughness: 1, metalness: 0, micro: { rough: 0.2, grain: 26, bump: 1.6 }, pattern: { kind: 'speckle', scale: 9, amount: 0.45 } },
  clay: { roughness: 0.72, metalness: 0, clearcoat: 0.08, clearcoatRoughness: 0.6, micro: { rough: 0.1, grain: 16, bump: 0.5 } },
  asphalt: { roughness: 0.95, metalness: 0, micro: { rough: 0.2, grain: 30, bump: 1.4 }, pattern: { kind: 'speckle', scale: 10, amount: 0.4 } },
  // Fabrics: the soft edge light of cloth, and the weave.
  cotton: { roughness: 0.98, metalness: 0, sheen: 0.5, doubleSided: true, micro: { rough: 0.08, grain: 40, bump: 0.5 }, pattern: { kind: 'weave', scale: 24, amount: 0.1 } },
  denim: { roughness: 0.95, metalness: 0, sheen: 0.3, doubleSided: true, pattern: { kind: 'twill', scale: 30, amount: 0.22 } },
  leather: { roughness: 0.5, metalness: 0, clearcoat: 0.18, clearcoatRoughness: 0.5, sheen: 0.25, micro: { rough: 0.14, grain: 20, bump: 1 } },
  wool: { roughness: 1, metalness: 0, sheen: 0.8, micro: { rough: 0.2, grain: 30, bump: 1.6 } },
  canvas: { roughness: 0.96, metalness: 0, sheen: 0.2, doubleSided: true, pattern: { kind: 'weave', scale: 16, amount: 0.18 } },
  silk: { roughness: 0.28, metalness: 0, clearcoat: 0.15, clearcoatRoughness: 0.3, sheen: 1, sheenRoughness: 0.35, doubleSided: true },
  felt: { roughness: 1, metalness: 0, sheen: 0.3, micro: { rough: 0.25, grain: 40, bump: 1.4 } },
  velvet: { roughness: 1, metalness: 0, sheen: 1, sheenRoughness: 0.25, doubleSided: true },
  // Other solids that explanations meet.
  cardboard: { roughness: 0.96, metalness: 0, doubleSided: true, micro: { rough: 0.1, grain: 26, bump: 0.6 }, pattern: { kind: 'grain', scale: 12, amount: 0.1 } },
  cork: { roughness: 0.92, metalness: 0, micro: { rough: 0.2, grain: 22, bump: 1.4 }, pattern: { kind: 'speckle', scale: 10, amount: 0.35 } },
  sponge: { roughness: 1, metalness: 0, micro: { rough: 0.3, grain: 14, bump: 2 }, pattern: { kind: 'speckle', scale: 6, amount: 0.3 } },
  hair: { roughness: 0.42, metalness: 0, clearcoat: 0.1, clearcoatRoughness: 0.4, sheen: 0.7 },
  wax: { roughness: 0.38, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.35, sheen: 0.3 },
  // Liquids: wet and clear, from thin to thick.
  oil: { roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, opacity: 0.62, envMapIntensity: 1.3, doubleSided: true },
  blood: { roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, opacity: 0.88, envMapIntensity: 1.2, doubleSided: true },
  milk: { roughness: 0.2, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.25 },
  honey: { roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, opacity: 0.78, envMapIntensity: 1.2, doubleSided: true },
  // The body: matte to wet, each with the sheen of living tissue.
  cartilage: { roughness: 0.45, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.4, sheen: 0.3, micro: { rough: 0.05, grain: 12, bump: 0.1 } },
  fat: { roughness: 0.5, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.5, sheen: 0.5 },
  organ: { roughness: 0.42, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.35, sheen: 0.55, micro: { rough: 0.06, grain: 12, bump: 0.15 } },
  nerve: { roughness: 0.4, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.35, sheen: 0.3 },
  vessel: { roughness: 0.38, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.3, sheen: 0.3 },
  tooth: { roughness: 0.12, metalness: 0, clearcoat: 0.9, clearcoatRoughness: 0.08 },
  mucosa: { roughness: 0.2, metalness: 0, clearcoat: 0.9, clearcoatRoughness: 0.15, sheen: 0.4 },
  // Plants.
  leaf: { roughness: 0.55, metalness: 0, clearcoat: 0.2, clearcoatRoughness: 0.5, sheen: 0.3, doubleSided: true },
  bark: { roughness: 1, metalness: 0, micro: { rough: 0.25, grain: 12, bump: 2 }, pattern: { kind: 'grain', scale: 6, amount: 0.3 } },
  petal: { roughness: 0.6, metalness: 0, sheen: 0.7, doubleSided: true },
  fruit: { roughness: 0.32, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.2, sheen: 0.2 },
  grass: { roughness: 0.85, metalness: 0, sheen: 0.3, doubleSided: true, micro: { rough: 0.2, grain: 40, bump: 1 } },
  // Foods.
  bread: { roughness: 0.96, metalness: 0, micro: { rough: 0.25, grain: 18, bump: 1.8 }, pattern: { kind: 'speckle', scale: 8, amount: 0.3 } },
  cheese: { roughness: 0.5, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.5, micro: { rough: 0.05, grain: 14, bump: 0.3 }, pattern: { kind: 'speckle', scale: 5, amount: 0.1 } },
  chocolate: { roughness: 0.28, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.2 },
  sugar: { roughness: 0.5, metalness: 0, micro: { rough: 0.2, grain: 60, bump: 1 }, pattern: { kind: 'speckle', scale: 40, amount: 0.2 } },
  butter: { roughness: 0.35, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.4, sheen: 0.2 },
  // Ice, snow, carbon fibre; and what gives light.
  ice: { roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, opacity: 0.62, envMapIntensity: 1.4, doubleSided: true, ior: 1.31 },
  snow: { roughness: 1, metalness: 0, sheen: 0.5, micro: { rough: 0.25, grain: 40, bump: 1.4 } },
  'carbon-fibre': { roughness: 0.26, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, micro: { rough: 0.04, grain: 10, bump: 0 }, pattern: { kind: 'twill', scale: 18, amount: 0.8 } },
  led: { roughness: 0.22, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.08, emissive: 1.6 },
  neon: { roughness: 0.3, metalness: 0, emissive: 1.9 },
  screen: { roughness: 0.15, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.06, emissive: 0.9 },
  ember: { roughness: 0.9, metalness: 0, emissive: 1.4 },
  // Painted metal: a little of the metal under the paint shows in the shine, and the lacquer over it is glassy.
  enamel: { roughness: 0.34, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1.1, micro: { rough: 0.06, grain: 30, bump: 0.2 } },
  // Sand-cast metal: rough and even, with no mirror in it.
  cast: { roughness: 0.46, metalness: 1, envMapIntensity: 1.05, micro: { rough: 0.18, grain: 30, bump: 0.9 } },
  // The flat cut face of a part drawn already cut open (hatched, see `hatched`).
  section: { roughness: 0.7, metalness: 0.1 },
};

/** Every surface the renderer has a recipe for (the library's materials and the kit's own). */
export const SURFACE_NAMES = Object.keys(RECIPES) as SurfaceName[];

export type Surface = MeshPhysicalMaterial & { userData: { base: number; glow: number; name?: string } };

export function makeSurface(name: string | undefined, tier: TierSettings, finish: SurfaceFinish = {}): Surface {
  const r = RECIPES[(name as SurfaceName) in RECIPES ? (name as SurfaceName) : 'plastic'];
  const m = new MeshPhysicalMaterial({
    color: 0xffffff, roughness: finish.roughness ?? r.roughness, metalness: finish.metalness ?? r.metalness,
    clearcoat: tier.clearcoat ? finish.clearcoat ?? r.clearcoat ?? 0 : 0,
    clearcoatRoughness: finish.clearcoatRoughness ?? r.clearcoatRoughness ?? 0,
    envMapIntensity: r.envMapIntensity ?? 1, transparent: (r.opacity ?? 1) < 1, side: r.doubleSided ? DoubleSide : 0,
  }) as Surface;
  if (r.sheen) {
    m.sheen = r.sheen;
    m.sheenRoughness = r.sheenRoughness ?? 0.5;
    m.sheenColor.setRGB(1, 0.9, 0.88);
  }
  if (r.ior !== undefined) m.ior = r.ior;
  m.userData = { base: r.opacity ?? 1, glow: r.emissive ?? 0, name };
  m.opacity = m.userData.base;
  m.depthWrite = !m.transparent;
  if (name === 'section') hatched(m);
  else if ((tier.micro > 0 && (r.micro || r.pattern)) || (tier.board > 0 && r.board)) {
    if ((r.opacity ?? 1) >= 1 && !r.emissive) applyMicroSurface(m, { rough: tier.micro > 0 && r.micro ? r.micro.rough : 0, grain: r.micro?.grain ?? 30, bump: tier.micro > 1 && r.micro ? r.micro.bump : 0, board: r.board ? tier.board : 0, ...(tier.micro > 0 && r.pattern ? { pattern: r.pattern } : {}) });
  }
  return m;
}

const scratch = new Color();

/** Fully solid surfaces must write depth before glass is blended over them. Sorting
 * both by whole-object priority/depth can erase glass covering a solid's rear portion.
 * This also handles opacity inherited from the ends of a connector or path. */
export function setSurfaceOpacity(m: Surface, opacity: number): void {
  m.opacity = opacity;
  const transparent = opacity < 1;
  if (m.transparent !== transparent) {
    m.transparent = transparent;
    // Three's opaque shader forces alpha to one, so a pass change needs its
    // corresponding shader variant as well as a different render queue.
    m.needsUpdate = true;
  }
  m.depthWrite = !transparent;
}

/** Sets a surface's tint, strength and glow for the moment. `alpha` is the object's own opacity.
 * Endpoint-held paths defer classification until their flow update supplies the final opacity. */
export function applySurface(m: Surface, rgb: Rgb, alpha: number, pulse: number, pulseRgb: Rgb | undefined, deferOpacity = false): void {
  // A tint gives the material a hue but stays within the material's own range of lightness (bone does not go white), so it reads on a light page and a dark one.
  const tint = fitTint(m.userData.name, rgb);
  m.color.setRGB(tint[0] / 255, tint[1] / 255, tint[2] / 255, 'srgb');
  if (deferOpacity) m.opacity = alpha * m.userData.base;
  else setSurfaceOpacity(m, alpha * m.userData.base);
  if (m.userData.glow > 0 || pulse > 0) {
    const glow = pulseRgb ?? rgb;
    scratch.setRGB(glow[0] / 255, glow[1] / 255, glow[2] / 255, 'srgb');
    m.emissive.copy(scratch);
    m.emissiveIntensity = Math.max(m.userData.glow, 0.9 * pulse);
  } else {
    m.emissiveIntensity = 0;
  }
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
