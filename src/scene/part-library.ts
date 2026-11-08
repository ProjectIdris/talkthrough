// The ready-made parts as a library: their names, the other names they are known by, and the line the guide gives them. The kit parts come from their rows
// (src/scene/kit-presets.ts); the few drawn by their own code (a chip, a port, a wheel...) are listed here. A part name a scene writes is read as one of these
// in the way a material name is: its own name, another name it is known by, or one a slip or two away, with a note; nothing like any gives the nearest to list.

import { KIT_PRESETS } from './kit-presets.ts';
import { closest, norm } from './names.ts';

/** The parts that are not in the kit table (drawn by their own code); the kit parts follow, as the table has them. */
export const OTHER_PARTS = ['chip', 'header', 'port', 'lens', 'screen', 'button', 'fan', 'wheel'] as const;

type Info = { note?: string; aka?: readonly string[] };
const OTHER_INFO: Readonly<Record<(typeof OTHER_PARTS)[number], Info>> = {
  chip: { note: 'variant black or metal', aka: ['microchip', 'processor'] },
  header: { note: 'n pins per row', aka: ['pin header', 'pins'] },
  port: { note: 'variant usb, usb3, ethernet, hdmi, usbc', aka: ['socket', 'jack'] },
  lens: { aka: ['camera lens'] },
  screen: { aka: ['display', 'monitor'] },
  button: { aka: ['key', 'switch'] },
  fan: { note: 'n blades', aka: ['propeller', 'rotor'] },
  wheel: { note: 'n spokes, z', aka: ['tyre', 'tire'] },
};

const infoOf = (part: string): Info | undefined => (OTHER_INFO as Record<string, Info>)[part] ?? KIT_PRESETS[part];

/** Every part name, the others first and then the kit in the table's order (read when asked, so a row added to the table is a part). */
export const partNames = (): string[] => [...OTHER_PARTS, ...Object.keys(KIT_PRESETS)];

export type PartMatch = {
  /** The part the written name stands for. */
  name?: string;
  /** True when the written name is the part's own name (any case, spaces for hyphens). */
  exact: boolean;
  /** The nearest parts, best first, for a name nothing is close to. */
  near: string[];
};

/** The part a written name stands for: its own name; another name it is known by; one a slip, a plural or a word away; else the nearest to list. */
export function resolvePartName(written: unknown): PartMatch {
  if (typeof written !== 'string') return { exact: false, near: [] };
  const n = norm(written.slice(0, 60));
  if (!n) return { exact: false, near: [] };
  const names = partNames();
  const own = names.find((p) => norm(p) === n);
  if (own) return { name: own, exact: true, near: [] };
  const alias = names.find((p) => infoOf(p)?.aka?.some((a) => norm(a) === n));
  if (alias) return { name: alias, exact: false, near: [] };
  const c = closest(written.slice(0, 60), names, (p) => [p, ...(infoOf(p)?.aka ?? [])]);
  return c.pick ? { name: c.pick, exact: false, near: c.near } : { exact: false, near: c.near };
}

const labelled = (part: string): string => { const note = infoOf(part)?.note; return note ? `${part} (${note})` : part; };

/**
 * The guide's whole account of the ready-made parts: each with what its n or variant means, the kit's parts grouped by the points they offer (a point is
 * named once for the group that has it), so a part added as a row is listed, with its points, by being a row.
 */
export function partGuide(): string {
  const groups = new Map<string, string[]>();
  for (const [part, row] of Object.entries(KIT_PRESETS)) {
    const key = [...new Set(row.anchors.map((a) => a.name))].join(',');
    groups.set(key, [...(groups.get(key) ?? []), labelled(part)]);
  }
  const kit = [...groups].map(([anchors, parts]) => `${parts.join(', ')}: ${anchors || 'origin only'}`).join('; ');
  return `Axis y unless marked z. Electronics: ${OTHER_PARTS.map(labelled).join(', ')}. Mechanism (anchors): ${kit}.`;
}
