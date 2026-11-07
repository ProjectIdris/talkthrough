// An offline discovery index over existing public built-ins, not new geometry or assemblies.
import { PARTS, VARIANTS } from '../../src/scene/spec.ts';
import type { ComponentCard } from './catalogue-retrieval.ts';

type PartName = typeof PARTS[number];
interface Description { summary: string; tags: string[]; n?: string; variants?: string[] }
const descriptions: Record<PartName, Description> = {
  chip: { summary: 'Electronic package. Metal variant gives a metal top.', tags: ['electronics', 'processor', 'integrated circuit'], variants: ['black', 'metal'] },
  header: { summary: 'Two rows of exposed electrical pins. n is pins per row.', tags: ['electronics', 'pins', 'connector'], n: 'pins per row' },
  port: { summary: 'Electronic socket facing +z. Variant chooses the connector family; schematic, not dimensioned CAD.', tags: ['electronics', 'usb', 'usb-c', 'usbc', 'ethernet', 'hdmi', 'socket'], variants: ['usb', 'usb3', 'ethernet', 'hdmi', 'usbc'] },
  lens: { summary: 'Round lens facing +z.', tags: ['camera', 'optics', 'glass'] },
  screen: { summary: 'Rectangular display facing +z.', tags: ['display', 'monitor', 'electronics'] },
  button: { summary: 'Round push button oriented along y.', tags: ['switch', 'control', 'electronics'] },
  fan: { summary: 'Fan blades around the y axis. n is blade count.', tags: ['cooling', 'blades', 'ventilation'], n: 'blades' },
  wheel: { summary: 'Tyre and wheel around the z axis. n is spoke count.', tags: ['tyre', 'tire', 'spokes', 'wheels', 'mechanical'], n: 'spokes' },
  'cylinder-block': { summary: 'Engine cylinder along y, with a round bore in x,z.', tags: ['engine', 'bore', 'cylinder'], variants: ['cutaway', 'finned'] },
  piston: { summary: 'Piston along y. Use ordinary crank actions for motion.', tags: ['engine', 'reciprocating', 'mechanical'] },
  'connecting-rod': { summary: 'Rod along y with its small end up.', tags: ['engine', 'rod', 'linkage', 'mechanical'] },
  crankshaft: { summary: 'Crankshaft around z. n is throw count.', tags: ['engine', 'crank', 'mechanical'], n: 'throws' },
  valve: { summary: 'Valve along y with its head down.', tags: ['engine', 'intake', 'exhaust', 'mechanical'] },
  camshaft: { summary: 'Camshaft around z. n is lobe count.', tags: ['engine', 'cam', 'lobes', 'mechanical'], n: 'lobes' },
  'spark-plug': { summary: 'Spark plug along y with its tip down.', tags: ['engine', 'spark', 'ignition'] },
  gear: { summary: 'Toothed gear around z. n is tooth count. Motion is an ordinary spin or coupling action.', tags: ['cog', 'gears', 'teeth', 'mechanical'], n: 'teeth' },
  spring: { summary: 'Coil spring along y. n is coil count.', tags: ['coil', 'coils', 'suspension', 'mechanical'], n: 'coils' },
  bearing: { summary: 'Bearing around z. n is ball count.', tags: ['axle', 'balls', 'mechanical'], n: 'balls' },
  pipe: { summary: 'Straight pipe along y. For a custom curved path, use the ordinary tube primitive instead.', tags: ['plumbing', 'flow', 'conduit', 'mechanical'] },
  elbow: { summary: 'Pipe elbow oriented from the y axis.', tags: ['plumbing', 'bend', 'flow', 'mechanical'] },
  housing: { summary: 'Mechanical housing along y, optionally cut away.', tags: ['case', 'enclosure', 'mechanical'], variants: ['cutaway'] },
};

const fields = VARIANTS.find(v => v.name === 'addPart')!.fields;
export const partCards: readonly ComponentCard[] = PARTS.map(part => {
  const description = descriptions[part];
  return {
    id: part,
    summary: description.summary,
    tags: description.tags,
    parameters: {
      size: fields.size!,
      ...(description.n ? { n: fields.n!, nMeaning: description.n, nNote: 'Validator bounds; individual renderers may use a narrower count range.' } : {}),
      ...(description.variants ? { variant: { k: 'enum', values: description.variants, opt: true } } : {}),
    },
    example: { op: 'add', shape: 'part', part, id: 'example', size: [2, 2, 1] },
  };
});
