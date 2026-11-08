// Scene language v0: the types a validated scene has. See docs/scene-language.md.
// A validated action never carries null: absent optional fields are simply missing.

import type { DiagramKind } from './spec.ts';
import type { KitPartName } from './kit-presets.ts';
import type { MaterialName } from './material-library.ts';
export type { DiagramKind } from './spec.ts';

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

/** A palette name (red, blue, ...) or a "#rgb" / "#rrggbb" hex string. */
export type Color = string;

export type At = {
  /** Seconds after the step starts (default 0). */
  at?: number;
};

export type Timing = At & {
  /** Seconds the change takes (default 0.6). */
  dur?: number;
};

// Screen marks: coordinates are 0..1000 across the screenshot (x right, y down).
export type BoxMark = { op: 'box'; id: string; x: number; y: number; w: number; h: number; rot?: number; color: Color } & At;
export type CircleMark = { op: 'circle'; id: string; x: number; y: number; w: number; h: number; rot?: number; color: Color } & At;
export type UnderlineMark = { op: 'underline'; id: string; x: number; y: number; w: number; color: Color } & At;
export type ArrowMark = { op: 'arrow'; id: string; x1: number; y1: number; x2: number; y2: number; color: Color } & At;
export type PolyMark = { op: 'poly'; id: string; pts: Vec2[]; color: Color } & At;
export type PointMark = { op: 'point'; id: string; x: number; y: number; color: Color; cell?: string } & At;
export type TraceMark = { op: 'trace'; id: string; pts: Vec2[]; head?: boolean; color: Color } & At;
export type LabelMark = { op: 'label'; id: string; x: number; y: number; text: string; color: Color; size?: number } & At;

export type CardLayout = 'list' | 'timeline' | 'stat';
export type CardMark = {
  op: 'card'; id: string; x: number; y: number; w?: number; title?: string; rows?: string[];
  layout?: CardLayout; to?: Vec2; color?: Color;
} & At;
export type ImageMark = {
  op: 'image'; id: string; sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number;
  caption?: string; color?: Color;
} & At;
/** A label pinned to a 3D object; `on` is that object's id. */
export type PinMark = { op: 'pin'; id: string; on: string; point?: Vec3; anchor?: string; text: string; off?: Vec2; color?: Color } & At;

export type Mark = BoxMark | CircleMark | UnderlineMark | ArrowMark | PolyMark | PointMark | TraceMark | LabelMark | CardMark | ImageMark | PinMark;

// Flat diagrams: a rectangle on the screenshot (0..1000) and the pieces drawn in it. See docs/scene-language.md.
export type DiagramAction = {
  op: 'diagram'; id: string; kind: DiagramKind; x: number; y: number; w: number; h: number; title?: string;
  xlabel?: string; ylabel?: string; xrange?: Vec2; yrange?: Vec2; color?: Color;
} & At;
export type NodeAction = { op: 'node'; id: string; of: string; text: string; note?: string; when?: string; pos?: number; color?: Color } & At;
export type EdgeAction = { op: 'edge'; id: string; from: string; to: string; text?: string; color?: Color } & At;
export type SeriesAction = { op: 'series'; id: string; of: string; pts: Vec2[]; label?: string; curve?: boolean; color?: Color } & At;
export type DotAction = { op: 'dot'; id: string; of: string; x: number; y: number; text?: string; color?: Color } & At;
export type TickAction = { op: 'tick'; id: string; done?: boolean } & At;
/** What is drawn in a diagram, and the diagram itself. */
export type DiagramPiece = NodeAction | EdgeAction | SeriesAction | DotAction;
export type DiagramThing = DiagramAction | DiagramPiece;

/** The one 3D stage: a rectangle on the screenshot (0..1000) a model is fitted to. Sent again, it moves or resizes. */
export type PanelAction = { op: 'panel'; x: number; y: number; w: number; h: number; frame?: boolean } & Timing;

// 3D objects, added to the stage. Units: y up, x right, z toward the viewer.
export type Material = MaterialName;
/** Optional 0..1 overrides of a named surface. Missing values keep that recipe; low quality disables clearcoat. */
export type SurfaceFinish = { roughness?: number; metalness?: number; clearcoat?: number; clearcoatRoughness?: number };
type Surface = { color?: Color; material?: Material; edges?: boolean; opacity?: number } & SurfaceFinish;
export type SolidShape = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane';
export type AddSolid = {
  op: 'add'; shape: SolidShape; id: string; parent?: string; parentAnchor?: string; selfAnchor?: string; explode?: Vec3; pos?: Vec3; size: Vec3; rot?: Vec3; bevel?: number;
} & Surface & At;
/** A closed hollow section of a concentric ellipsoid; inner is a radial scale, not uniform wall thickness. */
export type AddShell = {
  op: 'add'; shape: 'shell'; id: string; parent?: string; parentAnchor?: string; selfAnchor?: string; explode?: Vec3; pos?: Vec3; rot?: Vec3;
  size: Vec3; inner?: number; latitude?: Vec2; sweep?: number;
} & Surface & At;
export type AddExtrude = {
  op: 'add'; shape: 'extrude'; id: string; parent?: string; parentAnchor?: string; selfAnchor?: string; explode?: Vec3; pos?: Vec3; rot?: Vec3; outline: Vec2[]; holes?: Vec2[][]; taper?: number; shift?: Vec2; depth: number; bevel?: number;
} & Surface & At;
export type AddHull = {
  op: 'add'; shape: 'hull'; id: string; parent?: string; parentAnchor?: string; selfAnchor?: string; explode?: Vec3; pos?: Vec3; rot?: Vec3; pts: Vec3[];
} & Surface & At;
export type AddLathe = {
  op: 'add'; shape: 'lathe'; id: string; parent?: string; parentAnchor?: string; selfAnchor?: string; explode?: Vec3; pos?: Vec3; rot?: Vec3; profile: Vec2[]; sides?: number; sweep?: number;
} & Surface & At;
/** Open bicubic sheet, 16 control points in four row-major rows. */
export type AddPatch = {
  op: 'add'; shape: 'patch'; id: string; parent?: string; parentAnchor?: string; selfAnchor?: string; explode?: Vec3; pos?: Vec3; rot?: Vec3; pts: Vec3[];
} & Surface & At;
/** A closed polygon carried along a smooth open path. up sets its initial +y direction. */
export type AddSweep = {
  op: 'add'; shape: 'sweep'; id: string; parent?: string; parentAnchor?: string; selfAnchor?: string; explode?: Vec3; pos?: Vec3; rot?: Vec3; outline: Vec2[]; pts: Vec3[]; up?: Vec3; smooth?: boolean;
} & Surface & At;
/** Independently shaped convex end sections, joined by matching vertex indices. */
export type AddLoft = {
  op: 'add'; shape: 'loft'; id: string; parent?: string; parentAnchor?: string; selfAnchor?: string; explode?: Vec3; pos?: Vec3; rot?: Vec3; outline: Vec2[]; endOutline: Vec2[]; depth: number; smooth?: boolean;
} & Surface & At;
export type AddBlob = {
  op: 'add'; shape: 'blob'; id: string; parent?: string; parentAnchor?: string; selfAnchor?: string; explode?: Vec3; pos?: Vec3; rot?: Vec3; pts: Vec3[]; sizes: Vec3[]; soft?: number;
} & Surface & At;
/** An end of a tube or line that lies on a 3D part: the part and the point on it (in the part's own space), which the end keeps wherever the part goes. Set by the validator, never written. */
export type AttachEnd = { to: string; at: Vec3 };
/** Fixed material detail on swept paths; no additional strands or displacement. */
export type PathTreatment = 'fibres';
export type AddTube = {
  op: 'add'; shape: 'tube'; id: string; treatment?: PathTreatment; parent?: string; explode?: Vec3; pts: Vec3[]; radius: number; flat?: number; swell?: Vec2[]; closed?: boolean; draw?: number;
  attach?: [AttachEnd | null, AttachEnd | null];
} & Surface & At;
export type AddPath = {
  op: 'add'; shape: 'line' | 'arrow'; id: string; parent?: string; explode?: Vec3; pts: Vec3[]; color?: Color; draw?: number; opacity?: number;
  attach?: [AttachEnd | null, AttachEnd | null];
} & At;
/** The parts drawn by their own code (the rest are the rows of the kit table). */
export type OtherPartKind = 'chip' | 'header' | 'port' | 'lens' | 'screen' | 'button' | 'fan' | 'wheel';
/** A part's name: the parts above and the kit table's rows (a row added to the table is a part at run time; this type knows the rows there are today). */
export type PartKind = OtherPartKind | KitPartName;
export type PartVariant = 'black' | 'metal' | 'usb' | 'usb3' | 'ethernet' | 'hdmi' | 'usbc' | 'gold' | 'cutaway' | 'finned';
export type AddPart = {
  op: 'add'; shape: 'part'; id: string; parent?: string; parentAnchor?: string; selfAnchor?: string; explode?: Vec3; pos?: Vec3; rot?: Vec3; part: PartKind; variant?: PartVariant;
  size: Vec3; n?: number; color?: Color; opacity?: number;
} & At;
/** A real model from the catalogue (a heart, a brain), with its named parts as objects of their own (`<id>.<part>`). `size` is its longest side; with none it has its real size. */
export type AddModel = {
  op: 'add'; shape: 'model'; id: string; model: string; parent?: string; parentAnchor?: string; selfAnchor?: string; explode?: Vec3; pos?: Vec3; rot?: Vec3; size?: number;
} & At;
/** One named part of a real model, as the planner makes it (never written): the mesh is the model's file's, drawn at `unitsPerMetre`. */
export type AddMeshPart = {
  op: 'add'; shape: 'meshpart'; id: string; parent: string; model: string; part: string; unitsPerMetre: number; closed: boolean; material: string; /** Drawn with the model's own textured materials, not a flat colour. */ textured?: boolean; explode?: Vec3; /** Where it turns, from its own middle, in scene units (a clock hand's boss): a turn about no named pivot goes about this. */ hub?: Vec3;
} & At;
export type AddArray = { op: 'add'; shape: 'array'; id: string; of: string; count: number; step?: Vec3; turn?: Vec3 } & At;
export type AddText = {
  op: 'add'; shape: 'text'; id: string; parent?: string; parentAnchor?: string; selfAnchor?: string; explode?: Vec3; pos?: Vec3; text: string; height: number; color: Color;
} & At;
export type AddGroup = { op: 'add'; shape: 'group'; id: string; parent?: string; parentAnchor?: string; selfAnchor?: string; explode?: Vec3; pos?: Vec3; rot?: Vec3 } & At;

export type Side = 'left' | 'right' | 'top' | 'bottom' | 'front' | 'back';
/** A rope, belt, wire, chain or pipe between two objects, drawn as a tube that follows them as they move. */
export type AddConnector = {
  op: 'add'; shape: 'connector'; id: string; treatment?: PathTreatment; parent?: string; from: string; to: string; kind?: 'straight' | 'slack' | 'wrapped';
  fromSide?: Side; toSide?: Side; fromAnchor?: string; toAnchor?: string; sag?: number; radius?: number; draw?: number;
  fromPoint?: Vec3; toPoint?: Vec3; swell?: Vec2[]; restLength?: number;
} & Surface & At;
/** Markers that travel along a path, a connector, or an edge of a flow diagram. */
export type StreamMark = 'dot' | 'dash' | 'arrow';
export type AddStream = {
  op: 'add'; shape: 'stream'; id: string; along: string; mark?: StreamMark; count?: number; size?: number; color?: Color; toColor?: Color;
  shiftAt?: number; period?: number; by?: string; ratio?: number; opacity?: number; surge?: number; beat?: number;
} & At;
/** A stream on an edge of a flat diagram: what the timeline makes of an AddStream whose `along` is an edge. Never written by the model. */
export type StreamPiece = { op: 'stream'; id: string; along: string; mark?: StreamMark; count?: number; color?: Color; toColor?: Color; shiftAt?: number; period?: number; opacity?: number } & At;

/** A cloud of particles that spread from one box to a larger one (diffusion). The reveal op takes it from crowded (0) to spread (1). */
export type AddParticles = { op: 'add'; shape: 'particles'; id: string; parent?: string; pos?: Vec3; count?: number; from: Vec3; to: Vec3; shift?: Vec3; size?: number; jitter?: number; period?: number; color?: Color; draw?: number; opacity?: number } & At;
/** An arrow for a force on a part: strength units long, pointing the way dir does in the scene, from a point of the part. */
export type AddForce = { op: 'add'; shape: 'force'; id: string; parent?: string; on: string; point?: string; dir: Vec3; strength: number; color?: Color; opacity?: number } & At;
/** Field lines drawn as arrows round a point (a magnet, a charge, a mass, two plates); the timeline makes them. */
export type AddField = { op: 'add'; shape: 'field'; id: string; parent?: string; pos?: Vec3; kind: 'dipole' | 'radial' | 'uniform'; axis?: 'x' | 'y'; size?: number; count?: number; gap?: number; flip?: boolean; color?: Color; opacity?: number } & At;
export type AddAction = AddSolid | AddShell | AddExtrude | AddHull | AddLathe | AddLoft | AddSweep | AddPatch | AddBlob | AddTube | AddPath | AddConnector | AddStream | AddParticles | AddForce | AddField | AddPart | AddModel | AddMeshPart | AddArray | AddText | AddGroup;

// Tweens and changes on existing ids.
export type MoveAction = { op: 'move'; id: string; to: Vec3 } & Timing;
export type AlongAction = { op: 'along'; id: string; pts: Vec3[] } & Timing;
export type ExplodeAction = { op: 'explode'; id: string; to: number } & Timing;
export type RevealAction = { op: 'reveal'; id: string; to: number } & Timing;
/** Names a point on a 3D object, in its own space, for parts to be attached at (the object's built-in points need no declaring). */
export type AnchorAction = { op: 'anchor'; id: string; name: string; pos: Vec3 } & At;
/** Lets an attached part go: from then it is placed on its own, where it was, and no join line is drawn. */
export type DetachAction = { op: 'detach'; id: string } & Timing;
export type TurnAction = { op: 'turn'; id: string; to: Vec3 } & Timing;
export type ScaleAction = { op: 'scale'; id: string; to: Vec3 } & Timing;
export type StyleAction = { op: 'style'; id: string; color?: Color; opacity?: number } & Timing;
export type HighlightAction = { op: 'highlight'; id: string; color?: Color } & Timing;

// Machines: parts that keep moving by themselves once started.
export type SpinAction = { op: 'spin'; id: string; rpm?: number; by?: string; ratio?: number; phase?: number; axis?: 'x' | 'y' | 'z'; onlyAxis?: boolean } & Timing;
export type CutAction = { op: 'cut'; id: string; axis?: 'x' | 'y' | 'z'; normal?: Vec3; to: number } & Timing;
export type CrankAction = { op: 'crank'; id: string; shaft: string; rod?: string; pin?: number } & At;
export type CamAction = { op: 'cam'; id: string; by: string; lift?: number; open?: number; phase?: number } & At;
/** A repeating motion that is not a full turn, for any object: slide along an axis, swing about a pivot, or pulse in size. Its own period, or locked to a spinning part with by. */
export type LoopAction = { op: 'loop'; id: string; kind?: 'slide' | 'swing' | 'pulse' | 'gate' | 'float' | 'stop'; axis?: 'x' | 'y' | 'z'; amount?: number; period?: number; by?: string; ratio?: number; phase?: number; pivot?: Vec3; damp?: number; tilt?: number; /** Never written by the model: the part a pendulum hangs from, which the pivot follows. */ pivotOn?: string } & At;
/** A freedom of an object: a hinge about a pivot, a slide along an axis or a direction, or riding rigidly with another object. It moves nothing until a driver (spin, loop) or a coupling sets its value. */
export type JointAction = { op: 'joint'; id: string; kind: 'hinge' | 'slide' | 'fixed' | 'pivot' | 'ball'; axis?: 'x' | 'y' | 'z'; dir?: Vec3; pivot?: Vec3; about?: string; limit?: Vec3; min?: number; max?: number; to?: string } & At;
/** One joint follows another's value: ratio between two of a kind (gear, belt, lever arm), or pitch between a hinge and a slide (units of travel for a turn: a screw, a rack, a rope on a wheel). stop ends it. */
export type CoupleAction = { op: 'couple'; id: string; by?: string; ratio?: number; pitch?: number; phase?: number; stop?: boolean } & At;
/** A beam rocking about a fulcrum, in one op: a hinge at a point of the beam and a swing loop. */
export type LeverAction = { op: 'lever'; id: string; fulcrum?: string; swing?: number; period?: number; phase?: number; axis?: 'x' | 'y' | 'z' } & At;
/** A connector that pulls the part it is on: it contracts between its two points and the part's hinge or pivot is turned to make it so. */
export type MuscleAction = { op: 'muscle'; id: string; pulls: string; contract?: number; period?: number; phase?: number } & At;
/** A rope over a wheel in one op: the wheel turns and the load slides by the rope laid on it. */
export type PulleyAction = { op: 'pulley'; id: string; wheel: string; radius?: number; rpm?: number; axis?: 'x' | 'y' | 'z'; min?: number; max?: number } & At;
/** Gravity and its kin, illustrated, each in one op over the loops, joints and couplings: a weight hanging and swinging, bobbing on a spring, floating, falling and bouncing. */
export type PendulumAction = { op: 'pendulum'; id: string; from?: string; pivot?: Vec3; swing?: number; period?: number; damp?: number; axis?: 'x' | 'y' | 'z' } & At;
export type OscillateAction = { op: 'oscillate'; id: string; amount?: number; period?: number; damp?: number; axis?: 'x' | 'y' | 'z' } & At;
export type FloatAction = { op: 'float'; id: string; bob?: number; tilt?: number; period?: number; damp?: number } & At;
export type DropAction = { op: 'drop'; id: string; to: number; bounce?: number } & Timing;
/** A chamber that squeezes and refills behind one-way valves. */
export type PumpAction = { op: 'pump'; id: string; inlet?: string; outlet?: string; squeeze?: number; open?: number; period?: number; hinge?: string; axis?: 'x' | 'y' | 'z' } & At;
/** The last simple machines: a load on a slope, a wedge pushing a part aside, a screw and its nut. */
export type InclineAction = { op: 'incline'; id: string; ramp?: string; angle?: number; travel?: number; period?: number } & At;
export type WedgeAction = { op: 'wedge'; id: string; drives: string; angle?: number; travel?: number; period?: number; axis?: 'x' | 'y' | 'z' } & At;
export type ScrewAction = { op: 'screw'; id: string; screw: string; pitch?: number; rpm?: number; axis?: 'x' | 'y' | 'z'; min?: number; max?: number } & At;
/** A wave running along a tube. */
export type WaveAction = { op: 'wave'; id: string; amount?: number; width?: number; count?: number; period?: number; stop?: boolean } & At;
export type FlashAction = { op: 'flash'; id: string; by: string; angle: number; span: number; cycle?: number } & At;

// Camera, for the 3D panel.
export type OrbitAction = { op: 'orbit'; az: number; el: number } & Timing;
export type ZoomAction = { op: 'zoom'; to: number } & Timing;
export type FocusAction = { op: 'focus'; id?: string } & Timing;

/** target: an id, or one of "all", "marks", "panel". */
export type ClearAction = { op: 'clear'; target: string } & At;

/** Guide mode: wait for the person's click (in the box, when there is one) before the next step. */
export type WaitAction = { op: 'wait'; for: 'click'; x?: number; y?: number; w?: number; h?: number } & At;
/** Guide mode: the app may open this tab or menu or scroll this area for the person (see main/guide.ts and shared/nav-guard.ts). */
export type GoAction = { op: 'go'; kind: 'tab' | 'open' | 'scroll'; x: number; y: number; dir?: 'down' | 'up' | 'left' | 'right' } & At;

export type Action =
  | Mark | PanelAction | AddAction | DiagramThing | TickAction
  | MoveAction | AlongAction | TurnAction | ScaleAction | ExplodeAction | RevealAction | AnchorAction | DetachAction | StyleAction | HighlightAction
  | CutAction | SpinAction | CrankAction | CamAction | FlashAction | LoopAction | JointAction | CoupleAction | LeverAction | PulleyAction | MuscleAction
  | WaveAction | PendulumAction | OscillateAction | FloatAction | DropAction | PumpAction | InclineAction | WedgeAction | ScrewAction
  | OrbitAction | ZoomAction | FocusAction | ClearAction | WaitAction | GoAction;

export type Step = { say: string; actions: Action[] };
/**
 * escalate: the fast model says the question is beyond it, with a short reason, so a slower
 * backend can be offered. Allowed with steps (a partial answer) or instead of them (steps empty).
 */
export type Scene = { v?: 1; steps: Step[]; escalate?: string };

export type IssueKind = 'dropped' | 'clamped' | 'trimmed';
export type Issue = {
  kind: IssueKind;
  /** Where: "steps[2].actions[1]" or "steps[2].actions[1].x". */
  path: string;
  message: string;
};
