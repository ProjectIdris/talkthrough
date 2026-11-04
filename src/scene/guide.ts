// A compact description of the scene language for a model's prompt, built from the same table
// as the validator and the schema. Use it with sceneSchemaLean (no descriptions) to keep the
// schema small, or on its own for a model without structured output.

import { LIMITS, PALETTE, RESERVED_IDS, VARIANTS } from './spec.ts';
import type { Field, Variant } from './spec.ts';

function fieldList(v: Variant): string {
  const parts = Object.entries(v.fields).map(([name, f]: [string, Field]) => {
    if (name === 'op') return '';
    if (name === 'shape' && f.k === 'enum') return `shape:${f.values.join('|')}`;
    return 'opt' in f && f.opt ? `${name}?` : name;
  });
  return parts.filter(Boolean).join(' ');
}

const EXAMPLE = {
  steps: [
    {
      say: 'This table lists your orders. The total is in the last column.',
      actions: [
        { op: 'box', id: 'orders', x: 120, y: 260, w: 700, h: 300, color: 'blue' },
        { op: 'circle', id: 'total', x: 700, y: 260, w: 120, h: 80, color: 'red', at: 1.5 },
      ],
    },
    {
      say: 'Here is the board a camera plugs into, with its chip and its pins.',
      actions: [
        { op: 'panel', x: 560, y: 200, w: 420, h: 460 },
        { op: 'add', shape: 'group', id: 'board' },
        { op: 'add', shape: 'box', id: 'pcb', parent: 'board', size: [10, 0.2, 6], material: 'pcb', color: '#17803f' },
        { op: 'add', shape: 'part', id: 'chip', parent: 'board', part: 'chip', variant: 'metal', size: [2, 0.3, 2], pos: [0, 0.25, 0], at: 0.3 },
        { op: 'add', shape: 'part', id: 'pins', parent: 'board', part: 'header', size: [6, 1, 0.6], n: 20, pos: [0, 0.6, -2.5], at: 0.4 },
        { op: 'explode', id: 'board', to: 0.6, dur: 0 },
        { op: 'explode', id: 'board', to: 0, at: 0.8, dur: 1.5 },
        { op: 'pin', id: 'chiptag', on: 'chip', text: 'Processor', at: 2.4 },
      ],
    },
  ],
};

const lines: string[] = [
  'Answer with JSON only: {"steps":[{"say":"words to speak","actions":[...]}],"escalate":null}. Each step is drawn and spoken as soon as it is written.',
  'Rules:',
  '- Keep step 1 short and put its marks first, so something appears at once; add detail in later steps.',
  `- Screen coordinates run 0 to 1000 across the screenshot (x right, y down). Each size is along its own axis, so a round shape on a 16:9 screen has w about 9/16 of h.`,
  '- 3D: units x right, y up, z toward the viewer, a solid centred on its pos. The panel is only the rectangle the model is fitted to; the model floats over the page with a shadow and may reach past it. At zoom 1, 12 units fit across the shorter side, so draw things about 6 to 12 units big and use zoom 1 to 1.5. Angles are degrees. Never zoom past about 1.6 on one part if the rest should stay legible.',
  '- Build models from parts, not primitives alone: box with a bevel for housings, material (plastic metal rubber pcb glass glow paper) for the surface, part (chip header port lens screen button fan wheel) for ready-made bits, array for repeats (one blade, count 9, turn 40), extrude for wings and plates, lathe for round bodies, tube for cables. Group the model, add its parts at small staggered at times, then explode to 0.5 at dur 0 and back to 0 to assemble it in view.',
  '- Label parts with pin (on the object id, text; leave off out, the tag is placed for you clear of the model and of page text), not with floating text: it follows the part when the model turns. Use card for a short list or timeline, and image to crop part of the screenshot.',
  `- Every mark and object has a unique id (a letter, then up to 31 letters, digits, - or _; not ${RESERVED_IDS.join(', ')}). Use the id later to change or clear it. Ids from earlier answers stay valid until cleared.`,
  '- at = seconds after the step starts, dur = seconds a change takes. Time the actions to the words.',
  `- Colours: ${PALETTE.join(', ')}. Opacity 0 to 1. Text up to ${LIMITS.maxText} characters; say up to ${LIMITS.maxSay}. At most ${LIMITS.maxActionsPerStep} actions a step.`,
  '- A ? after a field name means optional (null).',
  `- If the question is beyond what you can answer well here (long research, deep reasoning, something you cannot see), add "escalate" with a short reason (up to ${LIMITS.maxEscalate} characters); steps may then be empty or hold a brief partial answer. The user is then offered a slower, deeper helper. Otherwise escalate is null.`,
  'Actions:',
  ...VARIANTS.map((v) => `- ${v.op} {${fieldList(v)}}: ${v.doc}`),
  'Example:',
  JSON.stringify(EXAMPLE),
];

export const sceneGuide: string = lines.join('\n');

/** The example in the guide, so a test can hold it to the validator. */
export const sceneGuideExample: unknown = EXAMPLE;
