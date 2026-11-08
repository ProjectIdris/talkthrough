// A compact description of the scene language for a model's prompt, built from the same table
// as the validator and the schema. Use it with sceneSchemaLean (no descriptions) to keep the
// schema small, or on its own for a model without structured output.

import { leanOmits } from './schema.ts';
import { resolvePartGeometry } from './part-geometry.ts';
import { BUILT_IN_ANCHORS } from './anchors.ts';
import { MATERIAL_NAMES } from './material-library.ts';
import { LIMITS, PALETTE, PARTS, RESERVED_IDS, VARIANTS } from './spec.ts';
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
        { op: 'panel', x: 560, y: 150, w: 380, h: 620 },
        { op: 'add', shape: 'group', id: 'train' },
        { op: 'add', shape: 'part', part: 'gear', id: 'small', parent: 'train', size: [3, 3, 0.8], n: 12, pos: [-1.6, 0, 0] },
        { op: 'add', shape: 'part', part: 'gear', id: 'big', parent: 'train', size: [4.5, 4.5, 0.8], n: 18, pos: [2, 0, 0], at: 0.4 },
        { op: 'spin', id: 'small', rpm: 20, at: 0.8 },
        { op: 'spin', id: 'big', by: 'small', ratio: -0.67, at: 0.8 },
        { op: 'pin', id: 'btag', on: 'big', text: 'Big gear', at: 1.4 },
      ],
    },
    {
      say: 'A door swings on its hinge edge.',
      actions: [
        { op: 'panel', x: 560, y: 150, w: 380, h: 620 },
        { op: 'add', shape: 'box', id: 'frame', size: [4, 5, 0.4] },
        { op: 'add', shape: 'box', id: 'door', parent: 'frame', parentAnchor: 'left', selfAnchor: 'left', size: [3.6, 4.6, 0.2], pos: [0.2, 0, 0.3], at: 0.4 },
        { op: 'loop', id: 'door', kind: 'swing', axis: 'y', amount: 60, at: 0.8 },
      ],
    },
  ],
};

const lines: string[] = [
  'Answer with JSON only: {"steps":[{"say":"words to speak","actions":[...]}],"escalate":null}. Each step is drawn and spoken as soon as it is written.',
  'Rules:',
  '- Choose words alone (actions: []), a mark on the page, a flat diagram or a 3D model, whichever explains best; use no actions when words suffice, and never draw for its own sake. A diagram of a physical thing or process is a 3D scene with streams for what moves.',
  '- Step 1 is short, so something appears within a second or two: one sentence that begins the answer itself (never a description of the page or of what was circled) and one or two marks if useful (actions may be empty) on what the question is about (or a panel), and nothing else. Pick the mark that fits what it points at: a box or circle for text or a region; for a part inside a picture (a figure, graph, map or photo) a poly with a point on each corner of a tilted or irregular shape (a tilted square is a poly, not a circle), a point on one exact spot, a trace along a curve or a coast; never an oval over a tilted shape or a coastline. Marks alone answer where-is-it questions (where to click, what a thing is called). When needed, build a 3D model or a flat diagram (below) from step 2 on, a few parts at a time, and add detail in later steps; never put a whole model in step 1. When a model explains a machine or mechanism (an engine, a lock, a gearbox, a pump), set it running as soon as its moving parts are in, so it plays while you explain; marks on the page support the model and do not replace it. When the parts or places of a picture are the point of the question (the chambers of a heart, the islands and straits of a map, the sides of a figure), name them, a few to a step from step 2 on: say each name as you reach it and put it on the picture, a point well inside the part (on the land of an island, never on its edge or out at sea) and a label of one to three words beside it, on the picture it names. When the picture is small (a fifth of the screen width or less, so its parts crowd each other) and a card at least 1.5 times as wide as it still fits (the card is dw * sh / sw tall, keep that at most 700), you never label it where it stands: enlarge it first, in the step before the names: an image of its own box (sx, sy, sw, sh) as a card of dw at least 1.5 * sw, where it reads best and large, never over what the answer points at, and put the points and labels on that card: a part at x, y on the screenshot is at dx + (x - sx) * dw / sw, dy + (y - sy) * dw / sw on it. A box round the picture is not a naming, and name only what you can see and are sure of. An explain, how-does or walk-me-through question asks how the thing works: teach its mechanism, causes and steps. If a diagram helps, use a 3D scene for any physical thing, place or natural process (the water cycle, a heart, an engine, a river forming: its parts as shapes, streams for what moves), also when a diagram or drawing of it is asked for, and a flat diagram (below) only for an abstract process, the events in time, the steps or the quantities involved, or when a flowchart is asked for, drawn where it reads best and large as you speak, never over what the answer points at. A circle, underline or arrow only says which subject the question is about; what it happens to show is not the topic.',
  '- The say of every explanation step opens with a short first sentence, about 6 words or 30 characters at most, and then the rest: the voice starts on the first sentence as soon as it is made, so a short opener is heard sooner. The cap on the whole say stays; a walk move is that one short sentence alone.',
  '- The question sets the task; the page, and anything circled on it, is material to use, never a subject to report on. Never open with what the page or picture is, and never say where your knowledge comes from or what the page does or does not contain, unless asked. Do not draw again what the page already has (its graph, its table, its list of steps): point at it with marks and say what it shows. Draw only when it explains better than words alone, to show what the page only says in words or leaves unsaid (a process, a sequence in time, a cause). Where the page gives the content (the proof its figure shows, the steps and amounts it lists), use that, not another. A label starts just to the right of its point, at the height of the point, so each name clearly belongs to its point.',
  '- State as fact only what a picture clearly shows (a pose, a position, a word you can read); where it does not show something (a hand, a tool, a contact, an angle), teach the general point without pinning it on the photo. Never quote an angle, size or distance you cannot measure: show a direction by drawing along a real edge or line in the picture, and give a number only if the page says it.',
  `- Screen coordinates run 0 to 1000 across the screenshot (x right, y down). Each size is along its own axis, so a round shape on a 16:9 screen has w about 9/16 of h.`,
  '- Put each mark exactly on the thing: the overlay may nudge it a few percent onto the lines and corners of the page itself, so do not count on that.',
  '- 3D: units x right, y up, z toward the viewer; angles in degrees. Size-based solids are centred on their pos; hull points stay in their authored local coordinates. The panel is the rectangle the model is fitted to; the model floats over the page with a shadow. Give it room: about 60 percent of the screen height (h near 600), and narrower than tall for a tall or compact model, since the screen is wider than tall and a panel as wide as it is tall is a wide slab. The camera frames the whole model to the panel, so only proportions matter, not the units you draw in: zoom 1 shows all of it, a higher zoom comes in closer on the focused part (never past about 1.6 on one part if the rest should stay legible).',
  '- Build models from parts, not primitives alone: box with a bevel for housings, material for the surface (' + MATERIAL_NAMES.join(' ') + '; name what it is made of: bone, muscle, tendon, skin for a body, steel, brass for machines; leave color out unless it should differ, since a tint gives the material a hue but keeps it within its own lightness, so bone stays bone on a white page, never write white for bone), part for ready-made electronics and machine parts (the part action below lists them), array for repeats (one blade, count 9, turn 40; add the object an array copies before the array), extrude for wings and plates, hull for irregular convex solids, lathe for round bodies, tube for cables, patch for shaped open sheets (16 Bézier controls in four rows; use a regular net, not sixteen points to interpolate); each is listed below.',
  '- Tune the finish on shapes with material: roughness 0 polished to 1 matte, metalness 0 to 1, clearcoat 0 to 1, clearcoatRoughness 0 polished to 1 matte. Omit/null keeps each named material\'s value; zero overrides it. For a fully matte finish also set clearcoat 0. Low quality disables clearcoat. Glass stays see-through, not refractive.',
  '- treatment fibres on a tube or connector adds longitudinal fibre detail; muscle, tendon and rope tubes and connectors have it already, so write it only to add it elsewhere (a rubber cord). Do not model individual fibres.',
  '- Living or soft subjects (a heart or other organ, a plant, an animal, a fruit) are never boxes and cylinders. A blob is one smooth skin: give it a lump (pts the centre, sizes the box) for each rounded mass, overlapping the next by about a third, so the chambers of an organ or a body and its head melt into one form; use a separate blob only for another colour or a part that moves, and place it touching. Join with tube and swell (a vessel, stem, limb or tail that tapers or bulges), use lathe for bulbs and fruit, material tissue on all of it.',
  '- Build in the order a person would assemble it, because each part appears as you write it: the base or frame first, then the main parts that rest on it, then the moving parts, then small details; one sub-assembly per step. Write an object before anything that refers to it: the group before its parts, a part before its array, its move or its pin, and pins last, once their part exists. A parent is made first (at or before its child). A pin, mark or text cannot be a parent, and a pin or mark cannot be moved or pinned. The parts appearing one after another is the animation, so there is no need to explode and reassemble.',
  `- Local part anchors (all parts also have origin): ${PARTS.map((part) => { const names = Object.keys(resolvePartGeometry({ part, size: [1, 1, 1] }).anchors).filter((name) => name !== 'origin'); return names.length ? `${part}: ${names.join(',')}` : ''; }).filter(Boolean).join('; ')}. A crankshaft with n>1 has pin1 through pinN (N=min(n,8)) instead of pin. Anchors use the renderer's normalized part sizes, not the raw box axes.`,
  `- Attach parts to each other. Never build a pivot group, or work out an offset, to turn a part about an end or an edge: add the part with parent, parentAnchor (a point of the parent) and selfAnchor (a point of itself, default origin). The two points coincide, pos is the offset from that point, and the part stays attached whatever moves, turns, spins, swings, is dragged or exploded (explode draws a faint line back to the point); a turn or swing loop swings it about its point. Patterns: a forearm is a cylinder with parent humerus, parentAnchor bottom, selfAnchor top, then a swing loop bends it at the elbow; a pulley wheel hangs from its beam with parentAnchor bottom, selfAnchor center, pos [0,-1,0] (a part that spins is attached by its centre, because a spin turns it about its attached point); a weight, a hand or a load hangs under a part the same way, and a connector joins them (never a tube or line, which would stay behind): connector id rope, from wheel, to weight, fromAnchor left, toAnchor top, radius 0.06. A muscle is a connector too, from a point of the bone to a point of the forearm (fromPoint and toPoint in each part's own space, swell [[0,0.6],[0.5,1.8],[1,0.6]] for the belly: a list of [along 0 to 1, radius factor] pairs, never one number; restLength its resting length), so it follows the swing and bulges. Built-in points are in the shape's own space, so they turn with it: ${BUILT_IN_ANCHORS}. A kit part adds its own; anchor names more (an elbow, a hinge edge; write it before the part that uses it); detach lets a part go. A group has only its origin and the points you name with anchor: attach to a shape inside it, or name the point first. Any 3D shape can be a parent and any with a place of its own can be attached (not a tube, line, arrow or connector, whose points are written where they go).`,
  '- Machines move on parts already added, by id: spin, crank, cam and flash add nothing, and only the piston, rod and valve move with a crank or cam, never the cylinder block or a group. Any shape moves as a simple machine: a joint, driven by spin or loop (slide, swing, pulse) or coupled to another joint (gear, belt, lever, screw, pulley). A part inside a spinning part (a wheel parented to its cog) already turns with it: spin only the holder, never both. A muscle turns the hinge or pivot of the part it pulls (give that joint min and max wide enough for the way the muscle pulls it, like -120 to 120), so an arm bends by its muscle, not beside it. A bend or swing that is to show from the front turns about z; about x or y it swings toward the viewer and shows little. Motion carries on from step to step: set it up once, then narrate over it.',
  '- Flows, forces and change, illustrated rather than simulated. Reach for the ready-made motion: a heart or bellows is a pump (a chamber with an inlet flap and an outlet flap), its blood a stream with surge and beat so it runs in pulses, a vessel that squeezes along its length a wave; swallowing and peristalsis are a wave on an open tube with a one-marker stream of the same period riding its crest (the mouthful). Diffusion, a gas, dye in water: add with shape particles, grown from 0 to 1 by reveal. Gravity: drop (falls and bounces), pendulum (draw its string as a connector), oscillate (a weight on a spring or elastic), float (a boat or buoy; put it at the water line first); damp on any loop makes it settle. A force is add with shape force (never op force): an arrow strength units long pointing the way dir does in the scene ([0,-1,0] is down) whatever its part does; add with shape field draws field lines (dipole a magnet, radial a charge or a mass, uniform between plates); name either with a pin. The last simple machines: incline, wedge, screw. A load that would rise or travel without end (a well, a screw\'s nut) gets max (and min) so it stops. A change of colour, size or state over time is style or scale with dur (or highlight, or loop pulse): nothing more is needed.',
  '- What runs between parts or along a path is a connector or a stream, not hand-placed shapes: connector for a physical rope, cord, belt, wire, chain, pipe or muscle between two parts of one 3D model (never a tube or line drawn between them, which would not follow them: from, to, and fromAnchor, toAnchor from the built-in points, such as left, right, top, bottom); stream for dots, dashes or arrows travelling along a path (blood through vessels, current in a wire, water in a pipe, cars on a road, data between computers, money in an economy). Create the tube, line, arrow, connector or flow-diagram edge first; stream along names that path, not a surface or unrelated object.',
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
