// The named surfaces the scene language offers, as three.js materials, and the quality tiers the
// renderer runs at. A surface is physically based (roughness, metalness, a little clear coat) and
// is lit by the environment, so it reads as a real object, not a flat colour.

import { Color, DoubleSide, MeshPhysicalMaterial, Vector2, Vector4 } from 'three';
import type { Material } from 'three';
import type { SurfaceFinish } from '../scene/types.ts';
import { applyMicroSurface } from './surface-micro.ts';
import type { PatternKind } from './surface-micro.ts';
import { fitTint } from '../scene/material-library.ts';
import { applyLook } from './surface-look.ts';
import type { GlowShape } from './surface-look.ts';
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
  /** What light does inside a material (surface-look.ts): the glow of flesh and wax, the depth of a liquid, the shape of what shines. Off, a surface keeps the stock shader. */
  look: boolean;
  /** A circuit board's own surface: 0 plain, 1 traces and pads, 2 with silkscreen. */
  board: 0 | 1 | 2;
  /** A real model's textured materials (model-surface.ts): its colour map only, or that with its normal, roughness, metal and occlusion maps. */
  modelMaps: 'colour' | 'full';
  /** The longest side, in pixels, a real model's texture keeps on this tier (larger ones are reduced when the model loads). */
  modelTexture: number;
};

export const TIERS: Record<Tier, TierSettings> = {
  low: { msaa: false, shadows: false, shadowMapSize: 512, edges: false, maxPixelRatio: 1, clearcoat: false, micro: 0, look: false, board: 1, modelMaps: 'colour', modelTexture: 1024 },
  mid: { msaa: true, shadows: true, shadowMapSize: 1024, edges: true, maxPixelRatio: 1.5, clearcoat: true, micro: 1, look: true, board: 2, modelMaps: 'full', modelTexture: 2048 },
  high: { msaa: true, shadows: true, shadowMapSize: 2048, edges: true, maxPixelRatio: 2, clearcoat: true, micro: 2, look: true, board: 2, modelMaps: 'full', modelTexture: 2048 },
};

/** The surfaces a scene can name, and two the parts kit uses inside itself: painted metal and rough cast metal. */
export type SurfaceName = MaterialName | 'bead' | 'enamel' | 'cast' | 'section';

type Recipe = {
  roughness: number; metalness: number; clearcoat?: number; clearcoatRoughness?: number;
  /** The opacity the surface has at full strength. */
  opacity?: number; emissive?: number; doubleSided?: boolean;
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
  /** Light that scatters inside (flesh, wax, fruit, petal): the strength of its glow, 0 to 1. */
  subsurface?: number;
  /** The depth of a liquid: clear in the middle, richer and more reflective towards the edge, 0 to 1. */
  liquid?: number;
  /** What shape the glow takes: a lens, a tube or a cracked crust. */
  glowShape?: GlowShape;
  /** How strongly the room's reflections show, against 1 (a surface's own `envMapIntensity` does nothing when the room is the scene's environment, so this is the one place it is set; see surface-look.ts). */
  env?: number;
};

const RECIPES: Record<SurfaceName, Recipe> = {
  plastic: { roughness: 0.4, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.35, micro: { rough: 0.14, grain: 26, bump: 0.5 } },
  metal: { roughness: 0.32, metalness: 1, micro: { rough: 0.1, grain: 70, bump: 0.3 } },
  rubber: { roughness: 0.88, metalness: 0, micro: { rough: 0.1, grain: 34, bump: 0.9 } },
  pcb: { roughness: 0.38, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.3, micro: { rough: 0.1, grain: 30, bump: 0.3 }, board: true },
  glass: { roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, opacity: 0.34, doubleSided: true },
  glow: { roughness: 0.6, metalness: 0, emissive: 1.25 },
  // A marker that travels along a pipe: a little self-light so it stays bright, but shaded and glossy so it reads as a bead on a pale or see-through tube.
  bead: { roughness: 0.3, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.1, emissive: 0.4 },
  paper: { roughness: 0.96, metalness: 0, doubleSided: true },
  // Living tissue: soft and a little wet, a gentle sheen over a matte body.
  tissue: { roughness: 0.62, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.55, sheen: 0.8, subsurface: 0.5, micro: { rough: 0.07, grain: 12, bump: 0.15 } },
  // Living and organic: matte to softly wet, in the colours their names ask for, none of them shiny plastic.
  bone: { roughness: 0.58, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.55, micro: { rough: 0.07, grain: 12, bump: 0.15 } },
  muscle: { roughness: 0.55, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.45, sheen: 0.5, subsurface: 0.5, micro: { rough: 0.07, grain: 12, bump: 0.15 }, pattern: { kind: 'fibre', scale: 2.5, amount: 0.22 } },
  tendon: { roughness: 0.38, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.3, sheen: 0.4 },
  skin: { roughness: 0.6, metalness: 0, clearcoat: 0.18, clearcoatRoughness: 0.6, sheen: 0.7, subsurface: 0.6, micro: { rough: 0.07, grain: 12, bump: 0.15 }, pattern: { kind: 'skin', scale: 1.5, amount: 0.16 } },
  // Metals and their kin: the plain metal's recipe, tuned.
  steel: { roughness: 0.3, metalness: 1, micro: { rough: 0.1, grain: 70, bump: 0.3 } },
  iron: { roughness: 0.5, metalness: 0.92, micro: { rough: 0.16, grain: 36, bump: 0.8 } },
  brass: { roughness: 0.28, metalness: 1, micro: { rough: 0.1, grain: 66, bump: 0.25 } },
  copper: { roughness: 0.3, metalness: 1, micro: { rough: 0.1, grain: 66, bump: 0.25 } },
  wood: { roughness: 0.75, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.7, micro: { rough: 0.14, grain: 22, bump: 0.6 } },
  rope: { roughness: 0.95, metalness: 0, sheen: 0.4 },
  water: { roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, opacity: 0.5, doubleSided: true, ior: 1.33, liquid: 1 },
  // The wider library (see material-library.ts for the names, families and aliases). Metals: smooth to cast, each with the fine unevenness of its finish.
  stainless: { roughness: 0.27, metalness: 1, micro: { rough: 0.1, grain: 80, bump: 0.15 }, pattern: { kind: 'fibre', scale: 2, amount: 0.14 } },
  aluminium: { roughness: 0.36, metalness: 1, micro: { rough: 0.1, grain: 60, bump: 0.2 }, pattern: { kind: 'fibre', scale: 1.5, amount: 0.1 } },
  'cast-iron': { roughness: 0.62, metalness: 0.92, micro: { rough: 0.2, grain: 28, bump: 1 } },
  bronze: { roughness: 0.32, metalness: 1, micro: { rough: 0.1, grain: 62, bump: 0.3 } },
  gold: { roughness: 0.2, metalness: 1, micro: { rough: 0.08, grain: 80, bump: 0.12 } },
  silver: { roughness: 0.22, metalness: 1, env: 1, micro: { rough: 0.1, grain: 70, bump: 0.12 } },
  chrome: { roughness: 0.04, metalness: 1, env: 1.15, micro: { rough: 0.02, grain: 90, bump: 0 } },
  rust: { roughness: 0.9, metalness: 0.35, micro: { rough: 0.28, grain: 20, bump: 1.2 }, pattern: { kind: 'speckle', scale: 6, amount: 0.5 } },
  titanium: { roughness: 0.4, metalness: 1, micro: { rough: 0.1, grain: 70, bump: 0.2 }, pattern: { kind: 'fibre', scale: 1.8, amount: 0.08 } },
  lead: { roughness: 0.55, metalness: 0.95, micro: { rough: 0.18, grain: 26, bump: 0.8 } },
  mirror: { roughness: 0.01, metalness: 1, env: 1.3 },
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
  'clear-plastic': { roughness: 0.08, metalness: 0, clearcoat: 0.9, clearcoatRoughness: 0.06, opacity: 0.45, doubleSided: true },
  abs: { roughness: 0.42, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.4, micro: { rough: 0.1, grain: 40, bump: 0.4 } },
  nylon: { roughness: 0.5, metalness: 0, sheen: 0.15, micro: { rough: 0.1, grain: 30, bump: 0.4 } },
  foam: { roughness: 1, metalness: 0, micro: { rough: 0.2, grain: 16, bump: 1.4 }, pattern: { kind: 'speckle', scale: 10, amount: 0.12 } },
  acrylic: { roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, opacity: 0.4, doubleSided: true },
  silicone: { roughness: 0.5, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.5, sheen: 0.3, micro: { rough: 0.05, grain: 14, bump: 0.15 } },
  // Glass: see-through (not refractive), clear to frosted to tinted, and the stones that are cut from it.
  'frosted-glass': { roughness: 0.55, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.5, opacity: 0.62, doubleSided: true },
  'tinted-glass': { roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, opacity: 0.52, doubleSided: true },
  crystal: { roughness: 0.02, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, opacity: 0.42, doubleSided: true, ior: 1.55 },
  gem: { roughness: 0.02, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, opacity: 0.8, doubleSided: true, ior: 2.4 },
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
  wax: { roughness: 0.38, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.35, sheen: 0.3, subsurface: 1, micro: { rough: 0.04, grain: 14, bump: 0.08 }, pattern: { kind: 'mottle', scale: 4, amount: 0.12 } },
  // Liquids: wet and clear, from thin to thick.
  oil: { roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, opacity: 0.62, doubleSided: true, liquid: 0.6 },
  blood: { roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, opacity: 0.88, doubleSided: true, liquid: 0.7 },
  milk: { roughness: 0.2, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.25 },
  honey: { roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, opacity: 0.78, doubleSided: true, liquid: 0.8 },
  // The body: matte to wet, each with the sheen of living tissue.
  cartilage: { roughness: 0.45, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.4, sheen: 0.3, subsurface: 0.4, micro: { rough: 0.05, grain: 12, bump: 0.1 } },
  fat: { roughness: 0.5, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.5, sheen: 0.5, subsurface: 0.9, micro: { rough: 0.06, grain: 14, bump: 0.12 }, pattern: { kind: 'mottle', scale: 5, amount: 0.2 } },
  organ: { roughness: 0.36, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.25, sheen: 0.55, subsurface: 0.9, micro: { rough: 0.12, grain: 14, bump: 0.2 }, pattern: { kind: 'organ', scale: 1.2, amount: 0.34 } },
  nerve: { roughness: 0.4, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.35, sheen: 0.3, subsurface: 0.5, micro: { rough: 0.06, grain: 16, bump: 0.1 }, pattern: { kind: 'fibre', scale: 2.5, amount: 0.26 } },
  vessel: { roughness: 0.36, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.3, sheen: 0.3, subsurface: 0.8, micro: { rough: 0.08, grain: 16, bump: 0.12 }, pattern: { kind: 'mottle', scale: 6, amount: 0.26 } },
  tooth: { roughness: 0.12, metalness: 0, clearcoat: 0.9, clearcoatRoughness: 0.08 },
  mucosa: { roughness: 0.2, metalness: 0, clearcoat: 0.9, clearcoatRoughness: 0.15, sheen: 0.4, subsurface: 0.6 },
  // Plants.
  leaf: { roughness: 0.5, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.45, sheen: 0.3, subsurface: 0.5, doubleSided: true, pattern: { kind: 'venation', scale: 1, amount: 0.3 } },
  bark: { roughness: 1, metalness: 0, micro: { rough: 0.25, grain: 12, bump: 2 }, pattern: { kind: 'grain', scale: 6, amount: 0.3 } },
  petal: { roughness: 0.6, metalness: 0, sheen: 0.7, subsurface: 0.6, doubleSided: true, micro: { rough: 0.06, grain: 30, bump: 0.1 }, pattern: { kind: 'mottle', scale: 5, amount: 0.22 } },
  fruit: { roughness: 0.3, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.2, sheen: 0.2, subsurface: 0.5, micro: { rough: 0.08, grain: 20, bump: 0.25 }, pattern: { kind: 'rind', scale: 1, amount: 0.26 } },
  grass: { roughness: 0.85, metalness: 0, sheen: 0.3, doubleSided: true, micro: { rough: 0.2, grain: 40, bump: 1 } },
  // Foods.
  bread: { roughness: 0.96, metalness: 0, micro: { rough: 0.25, grain: 18, bump: 1.8 }, pattern: { kind: 'speckle', scale: 8, amount: 0.3 } },
  cheese: { roughness: 0.5, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.5, micro: { rough: 0.05, grain: 14, bump: 0.3 }, pattern: { kind: 'speckle', scale: 5, amount: 0.1 } },
  chocolate: { roughness: 0.28, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.2 },
  sugar: { roughness: 0.5, metalness: 0, sheen: 0.25, micro: { rough: 0.25, grain: 40, bump: 1.2 }, pattern: { kind: 'glitter', scale: 6, amount: 0.35 } },
  butter: { roughness: 0.35, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.4, sheen: 0.2, subsurface: 1, micro: { rough: 0.04, grain: 14, bump: 0.1 }, pattern: { kind: 'mottle', scale: 4, amount: 0.12 } },
  // Ice, snow, carbon fibre; and what gives light.
  ice: { roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, opacity: 0.62, doubleSided: true, ior: 1.31 },
  snow: { roughness: 1, metalness: 0, sheen: 0.5, micro: { rough: 0.25, grain: 40, bump: 1.4 } },
  'carbon-fibre': { roughness: 0.26, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, micro: { rough: 0.04, grain: 10, bump: 0 }, pattern: { kind: 'twill', scale: 18, amount: 0.8 } },
  led: { roughness: 0.22, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.08, env: 0.25, emissive: 1.6, glowShape: 'lens' },
  neon: { roughness: 0.3, metalness: 0, env: 0.2, emissive: 1.9, glowShape: 'tube' },
  screen: { roughness: 0.15, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.06, emissive: 0.9 },
  ember: { roughness: 0.9, metalness: 0, env: 0.4, emissive: 1.6, glowShape: 'crust' },
  // Painted metal: a little of the metal under the paint shows in the shine, and the lacquer over it is glassy.
  enamel: { roughness: 0.34, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.12, micro: { rough: 0.06, grain: 30, bump: 0.2 } },
  // Sand-cast metal: rough and even, with no mirror in it.
  cast: { roughness: 0.46, metalness: 1, micro: { rough: 0.18, grain: 30, bump: 0.9 } },
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
    transparent: (r.opacity ?? 1) < 1, side: r.doubleSided ? DoubleSide : 0,
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
  // Every surface reads a colour for each vertex, and a geometry that has none is given white for all of them. A part that gains its own colours (a
  // softened edge, a patch of a living body's skin: organic-bodies.ts) is then drawn by the program the surface already has, built before any answer
  // (the page's warm-up), instead of by a second one that would be built, with a pause, the first time such a part is drawn.
  m.vertexColors = true;
  (m as { defaultAttributeValues?: Record<string, number[]> }).defaultAttributeValues = { color: [1, 1, 1] };
  if (name === 'section') hatched(m);
  else if ((tier.micro > 0 && (r.micro || r.pattern)) || (tier.board > 0 && r.board)) {
    if ((r.opacity ?? 1) >= 1 && !r.emissive) applyMicroSurface(m, { rough: tier.micro > 0 && r.micro ? r.micro.rough : 0, grain: r.micro?.grain ?? 30, bump: tier.micro > 1 && r.micro ? r.micro.bump : 0, board: r.board ? tier.board : 0, ...(tier.micro > 0 && r.pattern ? { pattern: r.pattern } : {}) });
  }
  if (tier.look && name !== 'section' && (r.subsurface || r.liquid || r.glowShape || r.env !== undefined)) applyLook(m, { subsurface: r.subsurface, liquid: r.liquid, glow: r.glowShape, env: r.env });
  return m;
}

/**
 * What a living or soft material is under its surface: read for the face of a cut through it and for the wall of a hollow part (organic-bodies.ts). A row
 * of numbers for each material, as its surface is; depths are shares of the part's own thickness.
 */
export type Inside = {
  /** The skin (a rind, a crust, a bone's hard shell): how deep it goes, and its shade against the part's colour (1 the same, less is darker). */
  rim: number; rimShade: number;
  /** The flesh under it: its own colour, and how much of the part's colour is kept in it (1 all the part's, 0 all its own). No colour: the part's. */
  flesh?: Rgb; keep: number;
  /** What the flesh goes over to deeper in, reached at `coreAt` of the thickness (a fruit paler to its middle, fat over muscle, a tooth's pulp). */
  core?: Rgb; coreAt?: number;
  /** A hollow part's wall, and the shade of the cavity's lining against the part's colour. */
  wall: number; lining: number;
  /** A grain on the cut face: its pattern, cycles to a unit and strength. */
  grain?: { kind: PatternKind; scale: number; amount: number };
};

const PLAIN_INSIDE: Inside = { rim: 0, rimShade: 1, keep: 1, wall: 0.12, lining: 0.7 };

const INSIDES: Partial<Record<SurfaceName, Inside>> = {
  // The body: a thin darker skin over flesh of the part's own hue; fat lies under skin and muscle under that; bone is a hard pale shell round red marrow.
  tissue: { rim: 0.03, rimShade: 0.8, flesh: [222, 128, 124], keep: 0.6, wall: 0.12, lining: 0.72 },
  muscle: { rim: 0.02, rimShade: 0.75, flesh: [158, 44, 50], keep: 0.5, wall: 0.16, lining: 0.7, grain: { kind: 'fibre', scale: 3, amount: 0.2 } },
  skin: { rim: 0.03, rimShade: 0.8, flesh: [240, 208, 150], keep: 0.15, core: [172, 58, 60], coreAt: 0.2, wall: 0.1, lining: 0.75 },
  fat: { rim: 0.02, rimShade: 0.9, flesh: [246, 226, 164], keep: 0.5, wall: 0.12, lining: 0.8, grain: { kind: 'mottle', scale: 6, amount: 0.14 } },
  organ: { rim: 0.03, rimShade: 0.7, flesh: [170, 56, 60], keep: 0.7, core: [206, 108, 100], coreAt: 0.5, wall: 0.13, lining: 0.62, grain: { kind: 'mottle', scale: 5, amount: 0.14 } },
  vessel: { rim: 0.05, rimShade: 0.82, flesh: [226, 150, 140], keep: 0.5, wall: 0.15, lining: 0.6 },
  mucosa: { rim: 0.03, rimShade: 0.85, flesh: [234, 146, 154], keep: 0.6, wall: 0.12, lining: 0.75 },
  nerve: { rim: 0.04, rimShade: 0.85, flesh: [242, 232, 196], keep: 0.5, wall: 0.12, lining: 0.8, grain: { kind: 'fibre', scale: 4, amount: 0.12 } },
  bone: { rim: 0.09, rimShade: 1.04, flesh: [188, 128, 104], keep: 0.3, wall: 0.14, lining: 0.6, grain: { kind: 'pores', scale: 9, amount: 0.4 } },
  tooth: { rim: 0.12, rimShade: 1.05, flesh: [236, 218, 176], keep: 0.4, core: [204, 96, 96], coreAt: 0.5, wall: 0.2, lining: 0.7 },
  cartilage: { rim: 0.02, rimShade: 0.92, keep: 1, wall: 0.14, lining: 0.8 },
  tendon: { rim: 0.02, rimShade: 0.9, keep: 1, wall: 0.16, lining: 0.75, grain: { kind: 'fibre', scale: 4, amount: 0.16 } },
  // Plants: a leaf is paler inside, bark is a dark shell round pale wood, a fruit a thin peel over flesh that pales to its middle.
  leaf: { rim: 0.08, rimShade: 0.8, flesh: [176, 206, 120], keep: 0.5, wall: 0.14, lining: 0.8 },
  bark: { rim: 0.08, rimShade: 0.7, flesh: [212, 176, 128], keep: 0.1, wall: 0.14, lining: 0.7, grain: { kind: 'grain', scale: 7, amount: 0.22 } },
  petal: { rim: 0.04, rimShade: 0.9, flesh: [250, 226, 232], keep: 0.6, wall: 0.12, lining: 0.85 },
  fruit: { rim: 0.022, rimShade: 0.78, flesh: [252, 230, 160], keep: 0.4, core: [255, 244, 206], coreAt: 0.5, wall: 0.1, lining: 0.8, grain: { kind: 'mottle', scale: 7, amount: 0.08 } },
  grass: { rim: 0.06, rimShade: 0.85, flesh: [190, 214, 130], keep: 0.5, wall: 0.14, lining: 0.8 },
  // Foods: a crust over crumb, a rind over paste.
  bread: { rim: 0.05, rimShade: 0.62, flesh: [244, 226, 186], keep: 0.12, wall: 0.1, lining: 0.8, grain: { kind: 'pores', scale: 7, amount: 0.3 } },
  cheese: { rim: 0.02, rimShade: 0.86, flesh: [250, 222, 130], keep: 0.75, core: [252, 232, 160], coreAt: 0.5, wall: 0.1, lining: 0.85, grain: { kind: 'mottle', scale: 6, amount: 0.07 } },
  chocolate: { rim: 0, rimShade: 1, keep: 1, wall: 0.1, lining: 0.8 },
  butter: { rim: 0, rimShade: 1, keep: 1, wall: 0.1, lining: 0.9 },
};

/** A material's inside: its own row, or a plain one (the part's colour right through). */
export function insideOf(name: string | undefined): Inside {
  return INSIDES[name as SurfaceName] ?? PLAIN_INSIDE;
}

export type SectionSurface = MeshPhysicalMaterial & { userData: { inside: Inside; rim: Vector2; flesh: Vector4; core: Vector4; lining: Vector2 } };

/**
 * The face of a cut through living or soft material: not a drawing's hatch but what a knife shows, in layers. The mesh gives each point its colour (the
 * part's own, running into its neighbour's) and two depths (`inside`: how far under the skin, how far from the cavity); the material's row says what lies
 * at each depth, so a skin a hundredth of the part thick is a clean line however coarse the face's mesh. `fitSection` sets the depths for a part's size.
 */
export function makeSectionSurface(name: string | undefined, tier: TierSettings): SectionSurface {
  const row = insideOf(name);
  const m = new MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.66, metalness: 0, clearcoat: tier.clearcoat ? 0.22 : 0, clearcoatRoughness: 0.5, vertexColors: true, side: DoubleSide }) as SectionSurface;
  if (tier.micro > 0 && row.grain) applyMicroSurface(m, { rough: 0, grain: 30, bump: 0, board: 0, pattern: row.grain });
  const linear = (rgb: Rgb | undefined, w: number): Vector4 => {
    const c = new Color();
    if (rgb) c.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, 'srgb');
    return new Vector4(c.r, c.g, c.b, w);
  };
  const rim = new Vector2(0, row.rimShade), flesh = linear(row.flesh, row.flesh ? row.keep : 1), core = linear(row.core, 0), lining = new Vector2(0, row.lining);
  m.userData = { inside: row, rim, flesh, core, lining };
  const own = { capRim: { value: rim }, capFlesh: { value: flesh }, capCore: { value: core }, capLining: { value: lining } };
  const previous = m.onBeforeCompile;
  const previousKey = m.customProgramCacheKey();
  m.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    Object.assign(shader.uniforms, own);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'attribute vec2 inside;\nvarying vec2 vInside;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vInside = inside;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec2 capRim;\nuniform vec4 capFlesh;\nuniform vec4 capCore;\nuniform vec2 capLining;\nvarying vec2 vInside;\nvoid main() {')
      .replace('#include <color_fragment>', `#include <color_fragment>
  {
    vec3 base = diffuseColor.rgb;
    float depth = vInside.x;
    float aa = max(fwidth(depth), 1e-6);
    vec3 flesh = mix(capFlesh.rgb, base, capFlesh.a);
    if (capCore.a > 0.0) flesh = mix(flesh, mix(capCore.rgb, base, capFlesh.a * 0.5), smoothstep(capRim.x, capCore.a, depth));
    vec3 c = mix(base * capRim.y, flesh, smoothstep(capRim.x - aa, capRim.x + aa, depth));
    c = mix(base * capLining.y, c, smoothstep(capLining.x - aa, capLining.x + aa, vInside.y));
    diffuseColor.rgb = c;
  }`);
  };
  m.customProgramCacheKey = () => `${previousKey}|section-layers-v1`;
  return m;
}

/** Sets a cut face's depths for a part `size` thick (in the units of the face's `inside` attribute). */
export function fitSection(m: SectionSurface, size: number): void {
  const row = m.userData.inside;
  m.userData.rim.x = row.rim * size;
  m.userData.core.w = row.core ? (row.coreAt ?? 0.5) * size : 0;
  m.userData.lining.x = 0.03 * size;
}

const scratch = new Color();
const WHITE: Rgb = [255, 255, 255];

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
export function applySurface(m: Surface, rgb: Rgb, alpha: number, pulse: number, pulseRgb: Rgb | undefined, deferOpacity = false, ownColour = false): void {
  // A tint gives the material a hue but stays within the material's own range of lightness (bone does not go white), so it reads on a light page and a dark one.
  // A living body's skin carries its colour in its vertices (it runs from one part into the next), so the surface itself is white.
  const tint = ownColour ? WHITE : fitTint(m.userData.name, rgb);
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

/** The cut face of a part that is living or soft, or sits inside something living (a stone in a fruit): its own colour, a little paler, with no hatching. */
export function plainSection(rgb: readonly number[], out: Color): void {
  const mix = (i: number): number => Math.min(1, (rgb[i]! * 0.78 + 255 * 0.22) / 255);
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
