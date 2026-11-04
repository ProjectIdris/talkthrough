// Scene language v0: the types a validated scene has. See docs/scene-language.md.
// A validated action never carries null: absent optional fields are simply missing.

export type Vec3 = [number, number, number];

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

export type Mark = BoxMark | CircleMark | UnderlineMark | ArrowMark | LabelMark;

/** The one 3D panel: a rectangle on the screenshot (0..1000). Sent again, it moves or resizes. */
export type PanelAction = { op: 'panel'; x: number; y: number; w: number; h: number } & Timing;

// 3D objects, added to the panel. Panel units: y up, x right, z toward the viewer.
export type SolidShape = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane';
export type AddSolid = {
  op: 'add'; shape: SolidShape; id: string; parent?: string; pos?: Vec3; size: Vec3; rot?: Vec3;
  color: Color; opacity?: number;
} & At;
export type AddPath = {
  op: 'add'; shape: 'line' | 'arrow'; id: string; parent?: string; pts: Vec3[]; color: Color; opacity?: number;
} & At;
export type AddText = {
  op: 'add'; shape: 'text'; id: string; parent?: string; pos?: Vec3; text: string; height: number; color: Color;
} & At;
export type AddGroup = { op: 'add'; shape: 'group'; id: string; parent?: string; pos?: Vec3; rot?: Vec3 } & At;

export type AddAction = AddSolid | AddPath | AddText | AddGroup;

// Tweens and changes on existing ids.
export type MoveAction = { op: 'move'; id: string; to: Vec3 } & Timing;
export type TurnAction = { op: 'turn'; id: string; to: Vec3 } & Timing;
export type ScaleAction = { op: 'scale'; id: string; to: Vec3 } & Timing;
export type StyleAction = { op: 'style'; id: string; color?: Color; opacity?: number } & Timing;
export type HighlightAction = { op: 'highlight'; id: string; color?: Color } & Timing;

// Camera, for the 3D panel.
export type OrbitAction = { op: 'orbit'; az: number; el: number } & Timing;
export type ZoomAction = { op: 'zoom'; to: number } & Timing;
export type FocusAction = { op: 'focus'; id?: string } & Timing;

/** target: an id, or one of "all", "marks", "panel". */
export type ClearAction = { op: 'clear'; target: string } & At;

export type Action =
  | Mark | PanelAction | AddAction
  | MoveAction | TurnAction | ScaleAction | StyleAction | HighlightAction
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
