// The named materials a 3D object can be made of: one row per name, data only (no renderer), so the schema's enum, the colour an object has when none is
// written, the guide's list and the renderer's recipes are all made from the same names. The recipes (the physically based numbers) are in the overlay's
// materials.ts, typed over these names.
//
// The model picks a material by name and may tint it with `color`. A tint gives the material a hue; it never takes it out of its own `band`, the range of
// lightness (relative luminance, 0 to 1) in which the material still reads on a light page and a dark one: a bone tinted white is the palest bone, not a
// white shape on a white page. A material with no band is drawn exactly as the colour says (plastic, metal, rubber and the rest that scenes already use).

export type Rgb3 = readonly [number, number, number];

export type MaterialRow = {
  name: string;
  /** The colour an object of this material has when the scene gives none, sRGB 0..255. */
  color: Rgb3;
  /** The lightness range (relative luminance) a tint is held to; absent: no limit. */
  band?: readonly [number, number];
  /** The surface layer a path-shaped object (tube, connector) of this material wears when the scene names none: fibres along a muscle, a tendon, a rope. */
  treatment?: 'fibres';
};

export const MATERIAL_LIBRARY = [
  { name: 'plastic', color: [140, 150, 172] },
  { name: 'metal', color: [196, 202, 212] },
  { name: 'rubber', color: [96, 100, 112] },
  { name: 'pcb', color: [22, 122, 70] },
  { name: 'glass', color: [168, 200, 232] },
  { name: 'glow', color: [255, 214, 10] },
  { name: 'paper', color: [246, 241, 229] },
  { name: 'tissue', color: [226, 140, 138] },
  { name: 'bone', color: [172, 148, 108], band: [0.07, 0.35] },
  { name: 'muscle', color: [168, 52, 56], band: [0.05, 0.25], treatment: 'fibres' },
  { name: 'tendon', color: [160, 154, 134], band: [0.07, 0.33], treatment: 'fibres' },
  { name: 'skin', color: [206, 142, 112], band: [0.06, 0.37] },
  { name: 'steel', color: [150, 160, 174], band: [0.14, 0.66] },
  { name: 'iron', color: [104, 108, 116], band: [0.135, 0.3] },
  { name: 'brass', color: [196, 156, 62], band: [0.15, 0.6] },
  { name: 'copper', color: [196, 112, 70], band: [0.14, 0.55] },
  { name: 'wood', color: [158, 108, 62], band: [0.075, 0.35] },
  { name: 'rope', color: [176, 148, 100], band: [0.08, 0.38], treatment: 'fibres' },
  { name: 'water', color: [72, 150, 220], band: [0.12, 0.34] },
] as const satisfies readonly MaterialRow[];

export type MaterialName = (typeof MATERIAL_LIBRARY)[number]['name'];

export const MATERIAL_NAMES = MATERIAL_LIBRARY.map((m) => m.name) as readonly MaterialName[];

const BY_NAME: ReadonlyMap<string, MaterialRow> = new Map(MATERIAL_LIBRARY.map((m) => [m.name, m]));

export const materialRow = (name: string | undefined): MaterialRow | undefined => (name === undefined ? undefined : BY_NAME.get(name));


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
