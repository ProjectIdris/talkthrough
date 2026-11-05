// Scene language v0: the types a validated scene has. See docs/scene-language.md.
// A validated action never carries null: absent optional fields are simply missing.

import type { DiagramKind } from './spec.ts';
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
export type Material = 'plastic' | 'metal' | 'rubber' | 'pcb' | 'glass' | 'glow' | 'paper' | 'tissue';
type Surface = { color?: Color; material?: Material; edges?: boolean; opacity?: number };
export type SolidShape = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane';
export type AddSolid = {
  op: 'add'; shape: SolidShape; id: string; parent?: string; explode?: Vec3; pos?: Vec3; size: Vec3; rot?: Vec3; bevel?: number;
} & Surface & At;
export type AddExtrude = {
  op: 'add'; shape: 'extrude'; id: string; parent?: string; explode?: Vec3; pos?: Vec3; rot?: Vec3; outline: Vec2[]; depth: number; bevel?: number;
} & Surface & At;
export type AddLathe = {
  op: 'add'; shape: 'lathe'; id: string; parent?: string; explode?: Vec3; pos?: Vec3; rot?: Vec3; profile: Vec2[]; sides?: number;
} & Surface & At;
export type AddBlob = {
  op: 'add'; shape: 'blob'; id: string; parent?: string; explode?: Vec3; pos?: Vec3; rot?: Vec3; pts: Vec3[]; sizes: Vec3[]; soft?: number;
} & Surface & At;
export type AddTube = {
  op: 'add'; shape: 'tube'; id: string; parent?: string; explode?: Vec3; pts: Vec3[]; radius: number; flat?: number; swell?: Vec2[]; draw?: number;
} & Surface & At;
export type AddPath = {
  op: 'add'; shape: 'line' | 'arrow'; id: string; parent?: string; explode?: Vec3; pts: Vec3[]; color?: Color; draw?: number; opacity?: number;
} & At;
export type PartKind =
  | 'chip' | 'header' | 'port' | 'lens' | 'screen' | 'button' | 'fan' | 'wheel'
  | 'cylinder-block' | 'piston' | 'connecting-rod' | 'crankshaft' | 'valve' | 'camshaft' | 'spark-plug' | 'gear' | 'spring' | 'bearing' | 'pipe' | 'elbow' | 'housing';
export type PartVariant = 'black' | 'metal' | 'usb' | 'usb3' | 'ethernet' | 'hdmi' | 'usbc' | 'gold' | 'cutaway' | 'finned';
export type AddPart = {
  op: 'add'; shape: 'part'; id: string; parent?: string; explode?: Vec3; pos?: Vec3; rot?: Vec3; part: PartKind; variant?: PartVariant;
  size: Vec3; n?: number; color?: Color; opacity?: number;
} & At;
export type AddArray = { op: 'add'; shape: 'array'; id: string; of: string; count: number; step?: Vec3; turn?: Vec3 } & At;
export type AddText = {
  op: 'add'; shape: 'text'; id: string; parent?: string; explode?: Vec3; pos?: Vec3; text: string; height: number; color: Color;
} & At;
export type AddGroup = { op: 'add'; shape: 'group'; id: string; parent?: string; explode?: Vec3; pos?: Vec3; rot?: Vec3 } & At;

export type Side = 'left' | 'right' | 'top' | 'bottom' | 'front' | 'back';
/** A rope, belt, wire, chain or pipe between two objects, drawn as a tube that follows them as they move. */
export type AddConnector = {
  op: 'add'; shape: 'connector'; id: string; parent?: string; from: string; to: string; kind?: 'straight' | 'slack' | 'wrapped';
  fromSide?: Side; toSide?: Side; fromAnchor?: string; toAnchor?: string; sag?: number; radius?: number; draw?: number;
} & Surface & At;
/** Markers that travel along a path, a connector, or an edge of a flow diagram. */
export type StreamMark = 'dot' | 'dash' | 'arrow';
export type AddStream = {
  op: 'add'; shape: 'stream'; id: string; along: string; mark?: StreamMark; count?: number; size?: number; color?: Color; toColor?: Color;
  shiftAt?: number; period?: number; by?: string; ratio?: number; opacity?: number;
} & At;
/** A stream on an edge of a flat diagram: what the timeline makes of an AddStream whose `along` is an edge. Never written by the model. */
export type StreamPiece = { op: 'stream'; id: string; along: string; mark?: StreamMark; count?: number; color?: Color; toColor?: Color; shiftAt?: number; period?: number; opacity?: number } & At;

export type AddAction = AddSolid | AddExtrude | AddLathe | AddBlob | AddTube | AddPath | AddConnector | AddStream | AddPart | AddArray | AddText | AddGroup;

// Tweens and changes on existing ids.
export type MoveAction = { op: 'move'; id: string; to: Vec3 } & Timing;
export type AlongAction = { op: 'along'; id: string; pts: Vec3[] } & Timing;
export type ExplodeAction = { op: 'explode'; id: string; to: number } & Timing;
export type RevealAction = { op: 'reveal'; id: string; to: number } & Timing;
export type TurnAction = { op: 'turn'; id: string; to: Vec3 } & Timing;
export type ScaleAction = { op: 'scale'; id: string; to: Vec3 } & Timing;
export type StyleAction = { op: 'style'; id: string; color?: Color; opacity?: number } & Timing;
export type HighlightAction = { op: 'highlight'; id: string; color?: Color } & Timing;

// Machines: parts that keep moving by themselves once started.
export type SpinAction = { op: 'spin'; id: string; rpm?: number; by?: string; ratio?: number; phase?: number; axis?: 'x' | 'y' | 'z' } & Timing;
export type CutAction = { op: 'cut'; id: string; axis?: 'x' | 'y' | 'z'; to: number } & Timing;
export type CrankAction = { op: 'crank'; id: string; shaft: string; rod?: string; pin?: number } & At;
export type CamAction = { op: 'cam'; id: string; by: string; lift?: number; open?: number; phase?: number } & At;
/** A repeating motion that is not a full turn, for any object: slide along an axis, swing about a pivot, or pulse in size. Its own period, or locked to a spinning part with by. */
export type LoopAction = { op: 'loop'; id: string; kind?: 'slide' | 'swing' | 'pulse' | 'stop'; axis?: 'x' | 'y' | 'z'; amount?: number; period?: number; by?: string; ratio?: number; phase?: number; pivot?: Vec3 } & At;
/** A freedom of an object: a hinge about a pivot, a slide along an axis or a direction, or riding rigidly with another object. It moves nothing until a driver (spin, loop) or a coupling sets its value. */
export type JointAction = { op: 'joint'; id: string; kind: 'hinge' | 'slide' | 'fixed'; axis?: 'x' | 'y' | 'z'; dir?: Vec3; pivot?: Vec3; min?: number; max?: number; to?: string } & At;
/** One joint follows another's value: ratio between two of a kind (gear, belt, lever arm), or pitch between a hinge and a slide (units of travel for a turn: a screw, a rack, a rope on a wheel). stop ends it. */
export type CoupleAction = { op: 'couple'; id: string; by?: string; ratio?: number; pitch?: number; phase?: number; stop?: boolean } & At;
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
  | MoveAction | AlongAction | TurnAction | ScaleAction | ExplodeAction | RevealAction | StyleAction | HighlightAction
  | CutAction | SpinAction | CrankAction | CamAction | FlashAction | LoopAction | JointAction | CoupleAction
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
