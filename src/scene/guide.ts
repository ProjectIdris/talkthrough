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
      say: 'This table lists your orders; the total is in the last column.',
      actions: [
        { op: 'box', id: 'orders', x: 120, y: 260, w: 700, h: 300, color: 'blue' },
        { op: 'circle', id: 'total', x: 700, y: 260, w: 120, h: 80, color: 'red', at: 1.5 },
      ],
    },
    {
      say: 'Here is a spring pushing a pin down into a slot, which is how a simple door bolt works.',
      actions: [
        { op: 'panel', x: 560, y: 200, w: 420, h: 460 },
        { op: 'add', shape: 'group', id: 'bolt' },
        { op: 'add', shape: 'box', id: 'block', parent: 'bolt', size: [6, 3, 3], material: 'metal', color: '#9aa4b4', bevel: 0.2, opacity: 0.5 },
        { op: 'add', shape: 'cylinder', id: 'pin', parent: 'bolt', pos: [0, 0.2, 0], size: [0.8, 2.4, 0.8], material: 'metal', color: '#e3b341', at: 0.3 },
        { op: 'add', shape: 'tube', id: 'spring', parent: 'bolt', pts: [[0, 1.4, 0], [0.3, 1.8, 0], [-0.3, 2.2, 0], [0.3, 2.6, 0], [0, 3, 0]], radius: 0.08, color: '#d9dde6', at: 0.4 },
        { op: 'move', id: 'pin', to: [0, 0.8, 0], at: 1, dur: 1 },
        { op: 'pin', id: 'pintag', on: 'pin', text: 'Pin', at: 2.2 },
      ],
    },
  ],
};

const lines: string[] = [
  'Answer with JSON only: {"steps":[{"say":"words to speak","actions":[...]}],"escalate":null}. Each step is drawn and spoken as soon as it is written.',
  'Rules:',
  '- Step 1 is short, so something appears within a second or two: one sentence and one or two marks (a box or circle on what the question is about, or a panel), and nothing else. Build a 3D model from step 2 on, a few parts at a time, and add detail in later steps. Never put a whole model in step 1.',
  `- Screen coordinates run 0 to 1000 across the screenshot (x right, y down). Each size is along its own axis, so a round shape on a 16:9 screen has w about 9/16 of h.`,
  '- 3D: units x right, y up, z toward the viewer, a solid centred on its pos. The panel is only the rectangle the model is fitted to; the model floats over the page with a shadow and may reach past it. At zoom 1, 12 units fit across the shorter side, so draw things about 6 to 12 units big and use zoom 1 to 1.5. Angles are degrees. Never zoom past about 1.6 on one part if the rest should stay legible.',
  '- Build models from parts, not primitives alone: box with a bevel for housings, material (plastic metal rubber pcb glass glow paper) for the surface, part (chip header port lens screen button fan wheel) for ready-made bits, array for repeats (one blade, count 9, turn 40; add the object an array copies before the array), extrude for wings and plates, lathe for round bodies, tube for cables.',
  '- Build in the order a person would assemble it, because each part appears as you write it: the base or frame first, then the main parts that rest on it, then the moving parts, then small details; one sub-assembly per step. Write an object before anything that refers to it: the group before its parts, a part before its array, its move or its pin, and pins last, once their part exists. A parent is always a group made first (add shape group); a part cannot be a parent, so group parts that belong together. A pin or mark cannot be moved or pinned. The parts appearing one after another is the animation, so there is no need to explode and reassemble.',
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
