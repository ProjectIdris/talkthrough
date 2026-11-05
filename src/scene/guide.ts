// A compact description of the scene language for a model's prompt, built from the same table
// as the validator and the schema. Use it with sceneSchemaLean (no descriptions) to keep the
// schema small, or on its own for a model without structured output.

import { leanOmits } from './schema.ts';
import { LIMITS, PALETTE, RESERVED_IDS, VARIANTS } from './spec.ts';
import type { Field, Variant } from './spec.ts';

function fieldList(v: Variant): string {
  const parts = Object.entries(v.fields).map(([name, f]: [string, Field]) => {
    if (name === 'op' || leanOmits(v.name, name)) return '';
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
      say: 'The total is the last figure of the first row.',
      actions: [
        { op: 'point', id: 'tp', x: 760, y: 300, color: 'red' },
        { op: 'label', id: 'totname', x: 690, y: 210, text: 'Order total', color: 'red', at: 0.6 },
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
  '- Choose words alone (actions: []), a mark on the page, a flat diagram or a 3D model, whichever explains best; use no actions when words suffice, and never draw for its own sake. A diagram of a physical thing or process is a 3D scene with streams for what moves.',
  '- Step 1 is short, so something appears within a second or two: one sentence that begins the answer itself (never a description of the page or of what was circled) and one or two marks if useful (actions may be empty) on what the question is about (or a panel), and nothing else. Pick the mark that fits what it points at: a box or circle for text or a region; for a part inside a picture (a figure, graph, map or photo) a poly with a point on each corner of a tilted or irregular shape (a tilted square is a poly, not a circle), a point on one exact spot, a trace along a curve or a coast; never an oval over a tilted shape or a coastline. When needed, build a 3D model or a flat diagram (below) from step 2 on, a few parts at a time, and add detail in later steps. Never put a whole model in step 1. When a model explains a machine or mechanism (an engine, a lock, a gearbox, a pump), build it from step 2 on and set it running as soon as its moving parts are in, so it plays while you explain; marks on the page support the model and do not replace it. Marks alone answer where-is-it questions (where to click, what a thing is called). When the parts or places of a picture are the point of the question (the chambers of a heart, the islands and straits of a map, the sides of a figure), name them, a few to a step from step 2 on: say each name as you reach it and put it on the picture, a point well inside the part (on the land of an island, never on its edge or out at sea) and a label of one to three words beside it, on the picture it names. When the picture is small (a fifth of the screen width or less, so its parts crowd each other) and a card at least 1.5 times as wide as it still fits (the card is dw * sh / sw tall, keep that at most 700), you never label it where it stands: enlarge it first, in the step before the names: an image of its own box (sx, sy, sw, sh) as a card of dw at least 1.5 * sw, where it reads best and large, never over what the answer points at, and put the points and labels on that card: a part at x, y on the screenshot is at dx + (x - sx) * dw / sw, dy + (y - sy) * dw / sw on it. A box round the picture is not a naming, and name only what you can see and are sure of. An explain, how-does or walk-me-through question asks how the thing works: teach its mechanism, causes and steps, and never describe the page. If a diagram helps, use a 3D scene for any physical thing, place or natural process (the water cycle, a heart, an engine, a river forming: its parts as shapes, streams for what moves), also when a diagram or drawing of it is asked for, and a flat diagram (below) only for an abstract process, the events in time, the steps or the quantities involved, or when a flowchart is asked for, drawn where it reads best and large as you speak, never over what the answer points at, with the marks on the page supporting it. A circle, underline or arrow only says which subject the question is about; the picture is at most an example to point at while you teach, and what it happens to show is not the topic. A box on the page figure is not an explanation.',
  '- The say of every explanation step opens with a short first sentence, about 6 words or 30 characters at most, and then the rest: the voice starts on the first sentence as soon as it is made, so a short opener is heard sooner. The cap on the whole say stays; a walk move is that one short sentence alone.',
  '- The question sets the task; the page, and anything circled on it, is material to use, never a subject to report on. Never open with what the page or picture is, and never say where your knowledge comes from or what the page does or does not contain, unless asked. Do not draw again what the page already has (its graph, its table, its list of steps): point at it with marks and say what it shows. Draw only when it explains better than words alone, to show what the page only says in words or leaves unsaid (a process, a sequence in time, a cause). Where the page gives the content (the proof its figure shows, the steps and amounts it lists), use that, not another. A label starts just to the right of its point, at the height of the point, so each name clearly belongs to its point.',
  '- State as fact only what a picture clearly shows (a pose, a position, a word you can read); where it does not show something (a hand, a tool, a contact, an angle), teach the general point without pinning it on the photo. Never quote an angle, size or distance you cannot measure: show a direction by drawing along a real edge or line in the picture, and give a number only if the page says it.',
  `- Screen coordinates run 0 to 1000 across the screenshot (x right, y down). Each size is along its own axis, so a round shape on a 16:9 screen has w about 9/16 of h.`,
  '- Mark shapes: rot tilts a box or circle; poly takes a point on each corner; point marks one exact spot (a crossing, a tip, a place on a map); trace follows a curve or path through points set along it (head true ends it in an arrowhead); an arrow ends with its tip on what it points at. Put each mark exactly on the thing: the overlay may nudge it a few percent onto the lines and corners of the page itself, so do not count on that.',
  '- 3D: units x right, y up, z toward the viewer, a solid centred on its pos. The panel is the rectangle the model is fitted to; the model floats over the page with a shadow. The camera frames the whole model to the panel, so only proportions matter, not the units you draw in: zoom 1 shows all of it, a higher zoom comes in closer on the focused part. Angles are degrees. Never zoom past about 1.6 on one part if the rest should stay legible.',
  '- Build models from parts, not primitives alone: box with a bevel for housings, material (plastic metal rubber pcb glass glow paper tissue) for the surface, part for ready-made electronics and machine parts (the part action below lists them, with sizes, axes and anchors), array for repeats (one blade, count 9, turn 40; add the object an array copies before the array), extrude for wings and plates, lathe for round bodies, tube for cables.',
  '- Living or soft subjects (a heart or other organ, a plant, an animal, a fruit) are never boxes and cylinders. A blob is one smooth skin: give it a lump (pts the centre, sizes the box) for each rounded mass, overlapping the next by about a third, so the chambers of an organ or a body and its head melt into one form; use a separate blob only for another colour or a part that moves, and place it touching. Join with tube and swell (a vessel, stem, limb or tail that tapers or bulges), use lathe for bulbs and fruit, material tissue on all of it.',
  '- Build in the order a person would assemble it, because each part appears as you write it: the base or frame first, then the main parts that rest on it, then the moving parts, then small details; one sub-assembly per step. Write an object before anything that refers to it: the group before its parts, a part before its array, its move or its pin, and pins last, once their part exists. A parent is a group or a part made first, and carries what is attached to it. A pin, mark or text cannot be a parent, and a pin or mark cannot be moved or pinned. The parts appearing one after another is the animation, so there is no need to explode and reassemble.',
  '- Machines move: spin keeps a shaft turning (rpm, or locked to another part by a ratio), crank ties a piston to a spinning crankshaft through its rod, cam opens a valve as a camshaft turns, flash lights a spark or burn at an angle of the cycle, and cut slices a model open to show the inside. These act on parts already added, by id, and add nothing; only the piston, rod and valve move with them, never the cylinder block or a group. Any shape moves as a simple machine: joint (hinge, slide), driven by spin or loop (slide, swing, pulse), or coupled to another joint (gear, belt, lever, screw, pulley). Motion carries on from step to step: set it up once, then narrate over it.',
  '- What runs between parts or along a path is a connector or a stream, not hand-placed shapes: connector for a physical rope, belt, wire or pipe between two parts of one 3D model; stream for dots, dashes or arrows travelling along a path (blood through vessels, current in a wire, water in a pipe, cars on a road, data between computers, money in an economy).',
  '- Flat diagrams: diagram kind flow is for an abstract process or cause and effect (node, edge), timeline for events in time (node with when), steps for a how-to (node, then tick), chart for how two quantities relate (series, dot). They are laid out for you and drawn on as you write them: the diagram first, then its pieces in the order the voice reaches them, timed to the words with at.',
  '- Name the parts of a 3D model with pin (on the object id, text; leave off out, the tag is placed for you clear of the model): it follows the part when the model turns, and a pin goes on a 3D object only. Name the parts and places of a picture on the page with label (a short name, x,y its top-left corner) beside a point. Use card for a short list or timeline, and image to crop part of the screenshot.',
  `- Every mark and object has a unique id (a letter, then up to 31 letters, digits, - or _; not ${RESERVED_IDS.join(', ')}). Use the id later to change or clear it. Ids from earlier answers stay valid until cleared.`,
  '- at = seconds after the step starts, dur = seconds a change takes. Time the actions to the words.',
  `- Colours: ${PALETTE.join(', ')}. Opacity 0 to 1. Text up to ${LIMITS.maxText} characters; say up to ${LIMITS.maxSay}. At most ${LIMITS.maxActionsPerStep} actions a step.`,
  '- A ? after a field name means optional (null).',
  '- Guide mode: for "how do I do this" in the app on screen, give a walk, one move per step. Draw the target with a box or circle (its own ids each step, since each step starts from a clear page), say in a few words what to click, and end the step with wait {for:"click", x, y, w, h}, the box the click should land in. The app then waits for their click, checks that the screen changed, and shows the next step; if they go elsewhere it asks again from the new screen. Show only the steps you can see now (later ones are your best guess), and end with a step without wait that says they are done. In the first step, after its mark and wait, draw the checklist when there is more than one move: a steps diagram (id plan, a title of a few words, in free space at the side) with a short node for each move you expect, at most 6, in order; never tick it, the app ticks each node as they get through its step.',
  `- If the question is beyond what you can answer well here (long research, deep reasoning, something you cannot see), add "escalate" with a short reason (up to ${LIMITS.maxEscalate} characters); steps may then be empty or hold a brief partial answer. The user is then offered a slower, deeper helper. Otherwise escalate is null.`,
  'Actions:',
  ...VARIANTS.map((v) => `- ${v.op} {${fieldList(v)}}: ${v.doc}`),
  'Example:',
  JSON.stringify(EXAMPLE),
];

export const sceneGuide: string = lines.join('\n');

/** The example in the guide, so a test can hold it to the validator. */
export const sceneGuideExample: unknown = EXAMPLE;
