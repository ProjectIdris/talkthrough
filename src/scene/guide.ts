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
      say: 'Two meshed gears: the small one turns the big one more slowly, and the other way round.',
      actions: [
        { op: 'panel', x: 560, y: 200, w: 420, h: 460 },
        { op: 'add', shape: 'group', id: 'train' },
        { op: 'add', shape: 'part', part: 'gear', id: 'small', parent: 'train', size: [3, 3, 0.8], n: 12, pos: [-1.6, 0, 0] },
        { op: 'add', shape: 'part', part: 'gear', id: 'big', parent: 'train', size: [4.5, 4.5, 0.8], n: 18, pos: [2, 0, 0], at: 0.4 },
        { op: 'spin', id: 'small', rpm: 20, at: 0.8 },
        { op: 'spin', id: 'big', by: 'small', ratio: -0.67, at: 0.8 },
        { op: 'pin', id: 'btag', on: 'big', text: 'Big gear', at: 1.4 },
      ],
    },
  ],
};

const lines: string[] = [
  'Answer with JSON only: {"steps":[{"say":"words to speak","actions":[...]}],"escalate":null}. Each step is drawn and spoken as soon as it is written.',
  'Rules:',
  '- Step 1 is short, so something appears within a second or two: one sentence and one or two marks (a box or circle on what the question is about, or a panel), and nothing else. Build a 3D model from step 2 on, a few parts at a time, and add detail in later steps. Never put a whole model in step 1. When the page explains how a machine or mechanism works (an engine, a lock, a gearbox, a pump), the model is the answer: build it from step 2 on and set it running as soon as its moving parts are in, so it plays while you explain; marks on the page support the model and do not replace it. Marks alone are for pointing at where something is.',
  `- Screen coordinates run 0 to 1000 across the screenshot (x right, y down). Each size is along its own axis, so a round shape on a 16:9 screen has w about 9/16 of h.`,
  '- 3D: units x right, y up, z toward the viewer, a solid centred on its pos. The panel is the rectangle the model is fitted to; the model floats over the page with a shadow. The camera frames the whole model to the panel, so only proportions matter, not the units you draw in: zoom 1 shows all of it, a higher zoom comes in closer on the focused part. Angles are degrees. Never zoom past about 1.6 on one part if the rest should stay legible.',
  '- Build models from parts, not primitives alone: box with a bevel for housings, material (plastic metal rubber pcb glass glow paper) for the surface, part for ready-made bits (electronics: chip header port lens screen button fan wheel; machines: cylinder-block piston connecting-rod crankshaft valve camshaft spark-plug gear spring bearing pipe elbow housing; sizes, axes and anchors are in the part action below), array for repeats (one blade, count 9, turn 40; add the object an array copies before the array), extrude for wings and plates, lathe for round bodies, tube for cables.',
  '- Build in the order a person would assemble it, because each part appears as you write it: the base or frame first, then the main parts that rest on it, then the moving parts, then small details; one sub-assembly per step. Write an object before anything that refers to it: the group before its parts, a part before its array, its move or its pin, and pins last, once their part exists. A parent is a group or a part made first, and carries what is attached to it. A pin, mark or text cannot be a parent, and a pin or mark cannot be moved or pinned. The parts appearing one after another is the animation, so there is no need to explode and reassemble.',
  '- Machines move: spin keeps a shaft turning (rpm, or locked to another part by a ratio), crank ties a piston to a spinning crankshaft through its rod, cam opens a valve as a camshaft turns, flash lights a spark or burn at an angle of the cycle, and cut slices a model open (the cut faces are filled in) to show the inside. Motion carries on from step to step: set it up once, then narrate over it.',
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
