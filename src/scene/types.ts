// Scene language v0: the types a validated scene has. See docs/scene-language.md.
// A validated action never carries null: absent optional fields are simply missing.

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
export type BoxMark = { op: 'box'; id: string; x: number; y: number; w: number; h: number; color: Color } & At;
export type CircleMark = { op: 'circle'; id: string; x: number; y: number; w: number; h: number; color: Color } & At;
export type UnderlineMark = { op: 'underline'; id: string; x: number; y: number; w: number; color: Color } & At;
export type ArrowMark = { op: 'arrow'; id: string; x1: number; y1: number; x2: number; y2: number; color: Color } & At;
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

export type Mark = BoxMark | CircleMark | UnderlineMark | ArrowMark | LabelMark | CardMark | ImageMark | PinMark;

/** The one 3D stage: a rectangle on the screenshot (0..1000) a model is fitted to. Sent again, it moves or resizes. */
export type PanelAction = { op: 'panel'; x: number; y: number; w: number; h: number; frame?: boolean } & Timing;

// 3D objects, added to the stage. Units: y up, x right, z toward the viewer.
export type Material = 'plastic' | 'metal' | 'rubber' | 'pcb' | 'glass' | 'glow' | 'paper';
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
export type AddTube = {
  op: 'add'; shape: 'tube'; id: string; parent?: string; explode?: Vec3; pts: Vec3[]; radius: number; flat?: number; draw?: number;
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

export type AddAction = AddSolid | AddExtrude | AddLathe | AddTube | AddPath | AddPart | AddArray | AddText | AddGroup;

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
export type CrankAction = { op: 'crank'; id: string; shaft: string; rod?: string; pin?: number } & At;
export type CamAction = { op: 'cam'; id: string; by: string; lift?: number; open?: number; phase?: number } & At;
export type FlashAction = { op: 'flash'; id: string; by: string; angle: number; span: number; cycle?: number } & At;

// Camera, for the 3D panel.
export type OrbitAction = { op: 'orbit'; az: number; el: number } & Timing;
export type ZoomAction = { op: 'zoom'; to: number } & Timing;
export type FocusAction = { op: 'focus'; id?: string } & Timing;

/** target: an id, or one of "all", "marks", "panel". */
export type ClearAction = { op: 'clear'; target: string } & At;

export type Action =
  | Mark | PanelAction | AddAction
  | MoveAction | AlongAction | TurnAction | ScaleAction | ExplodeAction | RevealAction | StyleAction | HighlightAction
  | SpinAction | CrankAction | CamAction | FlashAction
  | OrbitAction | ZoomAction | FocusAction | ClearAction;

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
