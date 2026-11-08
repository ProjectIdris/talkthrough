// The named materials a 3D object can be made of: one row per name, data only (no renderer), so the schema's enum, the colour an object has when none is
// written, the guide's list and the renderer's recipes are all made from the same names. The recipes (the physically based numbers) are in the overlay's
// materials.ts, typed over these names.
//
// The model picks a material by name and may tint it with `color`. A tint gives the material a hue; it never takes it out of its own `band`, the range of
// lightness (relative luminance, 0 to 1) in which the material still reads on a light page and a dark one: a bone tinted white is the palest bone, not a
// white shape on a white page. A material with no band is drawn exactly as the colour says (plastic, metal, rubber and the rest that scenes already use).
//
// The library is wide (metals, woods, plastics, glass, stone and earth, fabrics, liquids, the body, plants, foods, ice and light), so the guide lists its families and a
// few names of each, and `resolveMaterial` takes any other name to the nearest one: an alias ("stainless steel", "aluminum", "denim jeans") or a close name is taken with a
// note, and a name nothing is close to is refused with the nearest.

import { closest, norm } from './names.ts';

export type Rgb3 = readonly [number, number, number];

export type MaterialFamily = 'metal' | 'wood' | 'plastic' | 'rubber' | 'glass' | 'stone' | 'earth' | 'fabric' | 'paper' | 'liquid' | 'body' | 'plant' | 'food' | 'ice' | 'electronics' | 'light';

export type MaterialRow = {
  name: string;
  /** What kind of thing it is made of: the guide names the families, and a name that is no material's is looked for among the others. */
  family: MaterialFamily;
  /** Other names for it (a synonym, a plural, a thing that is made of it): taken for it, with a note. */
  aliases?: readonly string[];
  /** The colour an object of this material has when the scene gives none, sRGB 0..255. */
  color: Rgb3;
  /** The lightness range (relative luminance) a tint is held to; absent: no limit. */
  band?: readonly [number, number];
  /** The surface layer a path-shaped object (tube, connector) of this material wears when the scene names none: fibres along a muscle, a tendon, a rope. */
  treatment?: 'fibres';
};

export const MATERIAL_LIBRARY = [
  { name: 'plastic', family: 'plastic', color: [140, 150, 172], aliases: ['plastics'] },
  { name: 'metal', family: 'metal', color: [196, 202, 212], aliases: ['metallic'] },
  { name: 'rubber', family: 'rubber', color: [96, 100, 112], aliases: ['tyre', 'tire'] },
  { name: 'pcb', family: 'electronics', color: [22, 122, 70], aliases: ['circuit board', 'circuit', 'printed circuit board'] },
  { name: 'glass', family: 'glass', color: [168, 200, 232], aliases: ['window', 'clear glass', 'glassware'] },
  { name: 'glow', family: 'light', color: [255, 214, 10], aliases: ['glowing', 'emissive', 'lamp'] },
  { name: 'paper', family: 'paper', color: [246, 241, 229], aliases: ['page', 'tissue paper'] },
  { name: 'tissue', family: 'body', color: [226, 140, 138], aliases: ['flesh', 'soft tissue', 'body tissue'] },
  { name: 'bone', family: 'body', color: [172, 148, 108], band: [0.07, 0.35], aliases: ['bones', 'skeleton', 'skull'] },
  { name: 'muscle', family: 'body', color: [168, 52, 56], band: [0.05, 0.25], treatment: 'fibres', aliases: ['muscles', 'meat'] },
  { name: 'tendon', family: 'body', color: [160, 154, 134], band: [0.07, 0.33], treatment: 'fibres', aliases: ['tendons', 'ligament', 'sinew'] },
  { name: 'skin', family: 'body', color: [206, 142, 112], band: [0.06, 0.37], aliases: ['dermis', 'epidermis', 'hide'] },
  { name: 'steel', family: 'metal', color: [150, 160, 174], band: [0.14, 0.66], aliases: ['mild steel', 'carbon steel'] },
  { name: 'iron', family: 'metal', color: [104, 108, 116], band: [0.135, 0.3], aliases: ['wrought iron'] },
  { name: 'brass', family: 'metal', color: [196, 156, 62], band: [0.15, 0.6] },
  { name: 'copper', family: 'metal', color: [196, 112, 70], band: [0.14, 0.55], aliases: ['copper wire'] },
  { name: 'wood', family: 'wood', color: [158, 108, 62], band: [0.075, 0.35], aliases: ['timber', 'wooden', 'plank', 'lumber'] },
  { name: 'rope', family: 'fabric', color: [176, 148, 100], band: [0.08, 0.38], treatment: 'fibres', aliases: ['string', 'cord', 'twine'] },
  { name: 'water', family: 'liquid', color: [72, 150, 220], band: [0.12, 0.34], aliases: ['aqua', 'sea', 'lake', 'river'] },
  { name: 'stainless', family: 'metal', color: [184, 188, 194], band: [0.275, 0.851], aliases: ['stainless steel', 'inox'] },
  { name: 'aluminium', family: 'metal', color: [200, 204, 210], band: [0.331, 0.95], aliases: ['aluminum', 'alloy', 'duralumin'] },
  { name: 'cast-iron', family: 'metal', color: [78, 80, 84], band: [0.044, 0.136], aliases: ['pig iron'] },
  { name: 'bronze', family: 'metal', color: [160, 112, 64], band: [0.107, 0.33] },
  { name: 'gold', family: 'metal', color: [232, 184, 64], band: [0.285, 0.881], aliases: ['golden', 'gilt'] },
  { name: 'silver', family: 'metal', color: [220, 222, 226], band: [0.401, 0.95], aliases: ['silvery', 'sterling'] },
  { name: 'chrome', family: 'metal', color: [208, 214, 222], band: [0.367, 0.95], aliases: ['chromium', 'chrome plated', 'nickel', 'nickel plated'] },
  { name: 'rust', family: 'metal', color: [150, 76, 44], band: [0.065, 0.201], aliases: ['rusty', 'rusted', 'corroded', 'corrosion', 'iron oxide'] },
  { name: 'titanium', family: 'metal', color: [140, 144, 150], band: [0.152, 0.471] },
  { name: 'lead', family: 'metal', color: [110, 114, 122], band: [0.092, 0.285], aliases: ['solder', 'pewter', 'zinc', 'tin'] },
  { name: 'mirror', family: 'metal', color: [214, 224, 232], aliases: ['mirrored', 'reflective'] },
  { name: 'light-wood', family: 'wood', color: [214, 176, 120], band: [0.257, 0.794], aliases: ['pale wood', 'maple'] },
  { name: 'dark-wood', family: 'wood', color: [92, 58, 36], band: [0.03, 0.092], aliases: ['ebony', 'mahogany', 'teak'] },
  { name: 'oak', family: 'wood', color: [176, 134, 84], band: [0.148, 0.458], aliases: ['oak wood', 'oaken'] },
  { name: 'pine', family: 'wood', color: [212, 170, 112], band: [0.242, 0.747], aliases: ['pine wood', 'spruce', 'fir', 'softwood'] },
  { name: 'walnut', family: 'wood', color: [94, 64, 44], band: [0.034, 0.106], aliases: ['walnut wood', 'cherry'] },
  { name: 'birch', family: 'wood', color: [226, 200, 156], band: [0.329, 0.95], aliases: ['birch wood', 'beech'] },
  { name: 'plywood', family: 'wood', color: [200, 160, 104], band: [0.211, 0.653], aliases: ['ply', 'chipboard', 'mdf', 'particle board', 'hardboard'] },
  { name: 'bamboo', family: 'wood', color: [206, 176, 98], band: [0.248, 0.766], aliases: ['cane', 'rattan'] },
  { name: 'glossy-plastic', family: 'plastic', color: [120, 150, 205], aliases: ['gloss plastic', 'shiny plastic', 'polished plastic', 'lacquer'] },
  { name: 'matte-plastic', family: 'plastic', color: [150, 156, 168], aliases: ['matt plastic', 'rough plastic', 'dull plastic'] },
  { name: 'clear-plastic', family: 'plastic', color: [200, 220, 235], aliases: ['transparent plastic', 'polycarbonate', 'cellophane'] },
  { name: 'abs', family: 'plastic', color: [232, 230, 222], aliases: ['abs plastic', 'lego', 'hard plastic', 'pvc', 'polystyrene'] },
  { name: 'nylon', family: 'plastic', color: [236, 232, 214], aliases: ['polyamide', 'delrin', 'acetal', 'ptfe', 'teflon'] },
  { name: 'foam', family: 'plastic', color: [228, 206, 120], aliases: ['polyurethane foam', 'packing foam', 'styrofoam', 'memory foam'] },
  { name: 'acrylic', family: 'plastic', color: [210, 226, 240], aliases: ['plexiglass', 'pmma', 'perspex'] },
  { name: 'silicone', family: 'rubber', color: [214, 222, 230], aliases: ['silicon rubber', 'gel', 'jelly'] },
  { name: 'frosted-glass', family: 'glass', color: [214, 226, 236], aliases: ['frosted', 'etched glass', 'ground glass', 'opal glass', 'milk glass'] },
  { name: 'tinted-glass', family: 'glass', color: [96, 150, 140], aliases: ['tinted', 'coloured glass', 'green glass', 'smoked glass', 'bottle glass', 'stained glass'] },
  { name: 'ceramic', family: 'stone', color: [226, 222, 212], band: [0.402, 0.95], aliases: ['ceramics', 'china', 'pottery', 'tile', 'glazed'] },
  { name: 'porcelain', family: 'stone', color: [244, 244, 240], band: [0.496, 0.95], aliases: ['bone china', 'enamelled'] },
  { name: 'terracotta', family: 'stone', color: [190, 100, 64], band: [0.112, 0.347], aliases: ['earthenware', 'flowerpot', 'clay pot'] },
  { name: 'stone', family: 'stone', color: [140, 138, 132], band: [0.14, 0.432], aliases: ['rock', 'pebble', 'boulder', 'cobble', 'gravel'] },
  { name: 'granite', family: 'stone', color: [128, 124, 122], band: [0.112, 0.347], aliases: ['granite stone', 'worktop'] },
  { name: 'slate', family: 'stone', color: [74, 82, 92], band: [0.045, 0.14], aliases: ['shale', 'basalt', 'charcoal', 'coal'] },
  { name: 'marble', family: 'stone', color: [232, 230, 224], band: [0.435, 0.95], aliases: ['marble stone', 'limestone', 'alabaster', 'chalk', 'plaster', 'gypsum'] },
  { name: 'concrete', family: 'stone', color: [150, 150, 146], band: [0.167, 0.516], aliases: ['cement', 'mortar', 'pavement', 'render'] },
  { name: 'brick', family: 'stone', color: [166, 84, 64], band: [0.081, 0.252], aliases: ['bricks', 'brickwork', 'red brick', 'masonry'] },
  { name: 'sand', family: 'earth', color: [214, 186, 128], band: [0.28, 0.867], aliases: ['sandy', 'beach', 'dune', 'grit'] },
  { name: 'soil', family: 'earth', color: [98, 70, 46], band: [0.039, 0.122], aliases: ['earth', 'dirt', 'mud', 'compost', 'loam'] },
  { name: 'clay', family: 'earth', color: [176, 112, 84], band: [0.118, 0.365], aliases: ['modelling clay', 'plasticine', 'putty'] },
  { name: 'asphalt', family: 'earth', color: [54, 56, 60], band: [0.022, 0.069], aliases: ['tarmac', 'bitumen', 'tar', 'road'] },
  { name: 'cotton', family: 'fabric', color: [236, 232, 222], band: [0.445, 0.95], aliases: ['cloth', 'fabric', 'linen', 'textile', 'towel'] },
  { name: 'denim', family: 'fabric', color: [58, 84, 128], band: [0.048, 0.15], aliases: ['jeans', 'blue jeans'] },
  { name: 'leather', family: 'fabric', color: [124, 76, 44], band: [0.053, 0.164], aliases: ['suede', 'leatherette', 'vinyl'] },
  { name: 'wool', family: 'fabric', color: [214, 206, 190], band: [0.342, 0.95], aliases: ['woollen', 'woolen', 'knit', 'knitted', 'yarn', 'fleece', 'fur'] },
  { name: 'canvas', family: 'fabric', color: [200, 186, 152], band: [0.273, 0.844], aliases: ['tarpaulin', 'sacking', 'burlap', 'hessian', 'tent'] },
  { name: 'silk', family: 'fabric', color: [214, 190, 206], band: [0.306, 0.945], aliases: ['satin', 'silky', 'ribbon'] },
  { name: 'felt', family: 'fabric', color: [112, 120, 132], band: [0.102, 0.315], aliases: ['carpet', 'rug', 'baize'] },
  { name: 'velvet', family: 'fabric', color: [120, 32, 60], band: [0.029, 0.091], aliases: ['velour', 'plush'] },
  { name: 'cardboard', family: 'paper', color: [176, 138, 92], band: [0.155, 0.479], aliases: ['carton', 'corrugated', 'corrugated cardboard', 'kraft'] },
  { name: 'cork', family: 'paper', color: [196, 150, 100], band: [0.19, 0.586], aliases: ['cork board', 'corkboard'] },
  { name: 'sponge', family: 'paper', color: [226, 196, 86], band: [0.31, 0.95], aliases: ['loofah', 'pumice', 'porous'] },
  { name: 'hair', family: 'body', color: [58, 40, 30], band: [0.02, 0.055], aliases: ['bristle', 'eyelash', 'whisker'] },
  { name: 'wax', family: 'paper', color: [236, 224, 186], band: [0.411, 0.95], aliases: ['candle', 'candle wax', 'paraffin', 'beeswax', 'soap'] },
  { name: 'oil', family: 'liquid', color: [210, 160, 40], band: [0.214, 0.663], aliases: ['olive oil', 'cooking oil', 'petrol', 'fuel', 'lubricant', 'grease', 'diesel'] },
  { name: 'blood', family: 'liquid', color: [138, 12, 22], band: [0.031, 0.097], aliases: ['bloody', 'red blood'] },
  { name: 'milk', family: 'liquid', color: [246, 244, 236], band: [0.497, 0.95], aliases: ['cream', 'yoghurt', 'yogurt', 'lotion'] },
  { name: 'honey', family: 'liquid', color: [214, 140, 24], band: [0.182, 0.563], aliases: ['syrup', 'amber', 'caramel', 'treacle', 'resin'] },
  { name: 'cartilage', family: 'body', color: [218, 224, 214], band: [0.402, 0.95], aliases: ['gristle', 'meniscus', 'spinal disc'] },
  { name: 'fat', family: 'body', color: [240, 216, 150], band: [0.384, 0.95], aliases: ['adipose', 'fatty tissue', 'blubber', 'lard'] },
  { name: 'organ', family: 'body', color: [150, 48, 52], band: [0.049, 0.15], aliases: ['liver', 'kidney', 'spleen', 'organ tissue', 'heart muscle', 'lung', 'brain', 'viscera'] },
  { name: 'nerve', family: 'body', color: [236, 224, 170], band: [0.407, 0.95], aliases: ['nerves', 'neuron', 'spinal cord', 'axon'] },
  { name: 'vessel', family: 'body', color: [196, 60, 70], band: [0.085, 0.262], aliases: ['blood vessel', 'artery', 'vein', 'capillary', 'vessels'] },
  { name: 'tooth', family: 'body', color: [240, 236, 224], band: [0.461, 0.95], aliases: ['enamel', 'tooth enamel', 'teeth', 'dentine', 'ivory'] },
  { name: 'mucosa', family: 'body', color: [218, 110, 120], band: [0.151, 0.466], aliases: ['mucus', 'mucous membrane', 'gum', 'tongue', 'epithelium'] },
  { name: 'leaf', family: 'plant', color: [64, 128, 52], band: [0.092, 0.285], aliases: ['leaves', 'foliage', 'green leaf', 'herb'] },
  { name: 'bark', family: 'plant', color: [88, 64, 46], band: [0.033, 0.101], aliases: ['tree bark', 'trunk', 'twig', 'branch', 'root'] },
  { name: 'petal', family: 'plant', color: [232, 110, 150], band: [0.168, 0.519], aliases: ['flower', 'blossom', 'petals', 'bloom'] },
  { name: 'fruit', family: 'plant', color: [230, 150, 60], band: [0.214, 0.662], aliases: ['fruit flesh', 'pulp', 'apple', 'orange', 'vegetable', 'tomato'] },
  { name: 'grass', family: 'plant', color: [92, 150, 60], band: [0.134, 0.415], aliases: ['lawn', 'turf', 'moss', 'hay', 'straw', 'crop'] },
  { name: 'bread', family: 'food', color: [204, 150, 84], band: [0.194, 0.6], aliases: ['loaf', 'toast', 'pastry', 'cake', 'biscuit', 'dough', 'crust'] },
  { name: 'cheese', family: 'food', color: [236, 190, 70], band: [0.303, 0.937], aliases: ['cheddar', 'egg yolk'] },
  { name: 'chocolate', family: 'food', color: [78, 44, 30], band: [0.02, 0.065], aliases: ['cocoa', 'dark chocolate'] },
  { name: 'sugar', family: 'food', color: [238, 236, 228], band: [0.461, 0.95], aliases: ['salt', 'flour', 'powder', 'rice', 'granules'] },
  { name: 'butter', family: 'food', color: [246, 226, 140], band: [0.417, 0.95], aliases: ['margarine', 'custard', 'pasta', 'egg'] },
  { name: 'ice', family: 'ice', color: [188, 222, 240], band: [0.381, 0.95], aliases: ['frozen', 'frost', 'icicle', 'ice cube', 'glacier'] },
  { name: 'snow', family: 'ice', color: [238, 242, 248], band: [0.487, 0.95], aliases: ['snowy', 'snowflake', 'cloud', 'steam', 'smoke'] },
  { name: 'carbon-fibre', family: 'electronics', color: [34, 36, 40], band: [0.016, 0.048], aliases: ['carbon fiber', 'carbon', 'kevlar', 'graphite'] },
  { name: 'crystal', family: 'glass', color: [226, 236, 244], aliases: ['quartz', 'crystalline', 'cut glass', 'lead crystal', 'salt crystal'] },
  { name: 'gem', family: 'glass', color: [196, 32, 72], aliases: ['gemstone', 'ruby', 'jewel', 'diamond', 'sapphire', 'emerald'] },
  { name: 'led', family: 'light', color: [90, 240, 120], aliases: ['diode', 'led light', 'indicator', 'bulb', 'indicator light'] },
  { name: 'neon', family: 'light', color: [255, 90, 200], aliases: ['neon light', 'neon sign', 'fluorescent'] },
  { name: 'screen', family: 'light', color: [150, 200, 255], aliases: ['display', 'monitor', 'lcd', 'tv', 'phone screen', 'backlight'] },
  { name: 'ember', family: 'light', color: [255, 110, 30], aliases: ['embers', 'fire', 'flame', 'lava', 'molten', 'hot metal', 'glowing metal', 'coals'] },
] as const satisfies readonly MaterialRow[];

export type MaterialName = (typeof MATERIAL_LIBRARY)[number]['name'];

export const MATERIAL_NAMES = MATERIAL_LIBRARY.map((m) => m.name) as readonly MaterialName[];

/** The families, in the order the library lists them. */
export const MATERIAL_FAMILIES: readonly MaterialFamily[] = [...new Set(MATERIAL_LIBRARY.map((m) => m.family as MaterialFamily))];

/**
 * What the guide says of the library: each family with a few of its names (the rest are found by the name written, see `resolveMaterial`). The names are the
 * library's own; a test holds the list to it.
 */
export const MATERIAL_GUIDE_ROWS: ReadonlyArray<readonly [family: string, names: readonly MaterialName[]]> = [
  ['metals', ['steel', 'brass', 'gold', 'chrome', 'rust']],
  ['woods', ['oak', 'pine', 'walnut']],
  ['plastics', ['abs', 'foam', 'acrylic']],
  ['rubber', []],
  ['glass', ['frosted-glass', 'tinted-glass', 'crystal']],
  ['stone and earth', ['marble', 'concrete', 'brick', 'sand', 'soil']],
  ['fabrics', ['denim', 'leather', 'wool', 'silk']],
  ['paper', ['cardboard', 'wax']],
  ['liquids', ['water', 'oil', 'blood']],
  ['the body', ['bone', 'muscle', 'tendon', 'skin', 'fat', 'organ', 'tooth']],
  ['plants', ['leaf', 'bark']],
  ['foods', ['bread', 'cheese']],
  ['others', ['ice', 'carbon-fibre', 'pcb']],
  ['light', ['glow', 'led', 'screen']],
];
export const MATERIAL_GUIDE: string = MATERIAL_GUIDE_ROWS.map(([family, names]) => (names.length ? `${family} (${names.join(' ')})` : family)).join(', ');

const BY_NAME: ReadonlyMap<string, MaterialRow> = new Map(MATERIAL_LIBRARY.map((m) => [m.name, m]));

export const materialRow = (name: string | undefined): MaterialRow | undefined => (name === undefined ? undefined : BY_NAME.get(name));

/** The words that stand alone for a whole family: a name that holds one of these and a more particular material ("oak wood") is that material. */
const GENERIC: ReadonlySet<string> = new Set(['plastic', 'metal', 'wood', 'glass', 'stone', 'fabric', 'rubber', 'paper', 'tissue']);

const LABELS: ReadonlyArray<{ row: MaterialRow; labels: readonly string[] }> = MATERIAL_LIBRARY.map((row: MaterialRow) => ({ row, labels: [row.name, ...(row.aliases ?? [])].map(norm) }));
/** A name in sentences like "dark oak wood": the longest of the names and aliases it holds, as whole words. */
const holds = (written: string, label: string): boolean => ` ${written} `.includes(` ${label} `);

export type MaterialMatch = {
  /** The material meant, when it is plain which: its own name, an alias, a name that holds one, or a slip of one. */
  name?: MaterialName;
  /** The name written is the material's own name, so nothing needs saying. */
  exact: boolean;
  /** The nearest materials, best first, for a name nothing is close to. */
  near: MaterialName[];
};

/**
 * The material a written name stands for. Its own name, in any case or with spaces for hyphens, is taken as it is; an alias ("stainless steel", "aluminum", "jeans") is
 * taken with a note; a longer name that holds a name or alias ("polished oak wood", "dark red brick") is the longest one it holds, a particular material before a
 * whole family; and a name a slip or two away ("aluminium" written "alumninium") is taken too. A name nothing is close to gives the nearest to list.
 */
export function resolveMaterial(written: unknown): MaterialMatch {
  if (typeof written !== 'string') return { exact: false, near: [] };
  const n = norm(written.slice(0, 60));
  if (!n) return { exact: false, near: [] };
  const own = LABELS.find((x) => x.labels[0] === n);
  if (own) return { name: own.row.name as MaterialName, exact: true, near: [] };
  const alias = LABELS.find((x) => x.labels.includes(n));
  if (alias) return { name: alias.row.name as MaterialName, exact: false, near: [] };
  // The longest name or alias the written name holds as whole words; a generic one gives way to a particular one of the same length or longer.
  let best: { row: MaterialRow; size: number; generic: boolean } | undefined;
  let tie = false;
  for (const x of LABELS) {
    for (const label of x.labels) {
      if (!holds(n, label)) continue;
      const cand = { row: x.row, size: label.length, generic: GENERIC.has(x.row.name) };
      if (!best || (best.generic && !cand.generic) || (best.generic === cand.generic && cand.size > best.size)) { best = cand; tie = false; }
      else if (best.row !== cand.row && best.generic === cand.generic && best.size === cand.size) tie = true;
    }
  }
  if (best && !tie) return { name: best.row.name as MaterialName, exact: false, near: [] };
  const c = closest(written.slice(0, 60), MATERIAL_LIBRARY as readonly MaterialRow[], (m) => [m.name, ...(m.aliases ?? [])]);
  const near = c.near.map((m) => m.name as MaterialName);
  return c.pick ? { name: c.pick.name as MaterialName, exact: false, near } : { exact: false, near };
}


const toLinear = (v: number): number => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const toSrgb = (v: number): number => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

/** Relative luminance (0 black to 1 white) of an sRGB colour. */
export function luminance(c: Rgb3): number {
  return 0.2126 * toLinear(c[0]) + 0.7152 * toLinear(c[1]) + 0.0722 * toLinear(c[2]);
}

/**
 * The colour a tint gives a material: the tint itself while its lightness is inside the material's band, otherwise the tint drawn toward the material's own
 * colour (in linear light, so the lightness moves in a straight line) just far enough to stand at the nearest edge of the band. A tint can give the
 * material a hue; it cannot make bone white or muscle black. A material with no band, or an unknown one, takes the tint as written.
 */
export function fitTint(name: string | undefined, tint: Rgb3): Rgb3 {
  const row = materialRow(name);
  if (!row?.band) return tint;
  const [lo, hi] = row.band;
  const y = luminance(tint);
  const target = y > hi ? hi : y < lo ? lo : undefined;
  if (target === undefined) return tint;
  const home = luminance(row.color);
  // Where the material's own colour stands against the edge decides which way to draw; the default is always inside the band.
  const t = Math.min(1, Math.max(0, (target - y) / (home - y)));
  const mix = (i: 0 | 1 | 2): number => Math.max(0, Math.min(255, toSrgb(toLinear(tint[i]) + t * (toLinear(row.color[i]) - toLinear(tint[i])))));
  return [mix(0), mix(1), mix(2)];
}
