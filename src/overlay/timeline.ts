// The overlay's clock-free core: turns a step of the scene language into a plan, and a plan plus a
// time into a Frame, the complete state to draw at that moment. No DOM and no three.js here, so
// the same code serves real-time playback, frame grabs (seek) and tests.
//
// Time is authored seconds from the start of a step. A step's plan begins from the Frame the
// previous step settled in (evaluate at Infinity), so ids, positions and the camera carry over,
// including across follow-up questions.

import { mountPosition } from '../scene/attach.ts';
import { resolvePartGeometry } from '../scene/part-geometry.ts';
import { PALETTE_RGB } from '../scene/colors.ts';
import { advanceMotion, crankPinKey, crankPinSize, drawsOwnPin, emptyMotion, loopDriver, loopStart, poses, setLock, setRate, spinPlanFrom, spinsAt, stopSpin } from './motion.ts';
import type { CamDef, CoupleDef, CrankDef, FlashDef, JointDef, LoopDef, Motion, Pose, SpinPlan } from './motion.ts';
import { applyDiagramAction, clearDiagrams, diagramPlanFrom, diagramTimes, emptyDiagramPlan, evaluateDiagrams, pulseDiagramThing, styleDiagramThing } from './diagram-plan.ts';
import type { DiagramFrame, DiagramPlan } from './diagram-plan.ts';
import { mechanismColor } from './part-colors.ts';
import { pathLength, smoothPath } from './shapes.ts';
import type { Rgb } from '../scene/colors.ts';
import type { Action, AddAction, Mark, Step, StreamPiece, Vec3 } from '../scene/types.ts';

export type { Rgb };
export type Rect = { x: number; y: number; w: number; h: number };

export const APPEAR_SECONDS = 0.7;
export const FADE_OUT_SECONDS = 0.3;
export const DEFAULT_DUR = 0.6;
export const DEFAULT_PANEL: Rect = { x: 640, y: 140, w: 340, h: 420 };
export const DEFAULT_CAMERA = { az: 0, el: 15, zoom: 1 } as const;
/** How fast the samples' speech is assumed to run, for timing without a voice. */
export const WORDS_PER_SECOND = 2.5;


/** The colour a 3D object has when the scene does not give one, by its surface. */
export const MATERIAL_COLOR: Record<string, Rgb> = {
  plastic: [214, 218, 226], metal: [196, 202, 212], rubber: [44, 46, 54], pcb: [22, 122, 70],
  glass: [168, 200, 232], glow: [255, 214, 10], paper: [246, 241, 229],
};

/** The colour a new 3D object has when the scene does not give one. */
export function defaultColor(def: AddAction): Rgb {
  if (def.shape === 'part') {
    const variant = def.variant;
    switch (def.part) {
      case 'chip': return variant === 'metal' ? [204, 208, 216] : [34, 36, 42];
      case 'header': return [30, 30, 34];
      case 'port': return [226, 230, 238];
      case 'lens': return [30, 32, 38];
      case 'screen': return [22, 24, 30];
      case 'button': return [214, 64, 64];
      case 'fan': return [88, 94, 108];
      case 'wheel': return [128, 134, 146];
      default: return mechanismColor(def.part) ?? [190, 196, 206];
    }
  }
  if (def.shape === 'stream') return [240, 244, 250];
  if (def.shape === 'connector') return [104, 108, 118];
  const material = 'material' in def ? def.material : undefined;
  return [...(MATERIAL_COLOR[material ?? 'plastic'] ?? (MATERIAL_COLOR.plastic as Rgb))] as Rgb;
}

export function parseColor(c: string | undefined): Rgb {
  if (c === undefined) return [255, 255, 255];
  const named = PALETTE_RGB[c];
  if (named) return [...named];
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(c);
  if (m?.[1]) {
    const h = m[1].length === 3 ? m[1].split('').map((ch) => ch + ch).join('') : m[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  return [255, 255, 255];
}

export function rgbCss(c: Rgb, alpha = 1): string {
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${alpha})`;
}

// ---- Frame: what to draw ------------------------------------------------------------------

export type FocusFrame = {
  /** Key of the 3D object the camera looks at; null is the middle of the panel. */
  key: number | null;
  /** While moving: where the camera was looking, blended toward `key` by `k` (0..1). */
  from?: FocusFrame;
  k: number;
};

export type MarkFrame = {
  key: number; id: string; mark: Mark; color: Rgb; opacity: number;
  /** 0..1, how far the mark has drawn in. */
  appear: number;
  /** 1 while present, falling to 0 as it is cleared. */
  fade: number;
  /** 0..1 highlight pulse. */
  pulse: number; pulseColor: Rgb | undefined;
  /** True when the scene chose the colour; otherwise the look's own colour is used. */
  tinted: boolean;
  /** For a pin: the key of the 3D object it is on. */
  onKey?: number;
};

export type ObjectFrame = {
  key: number; id: string; parentKey: number | null;
  /** How it was made: the shape and its parameters. */
  def: AddAction;
  shape: string;
  pos: Vec3; rot: Vec3; scale: Vec3; color: Rgb; opacity: number;
  appear: number; fade: number; pulse: number; pulseColor: Rgb | undefined;
  /** How much of a tube, line or arrow is drawn, 0..1. */
  draw: number;
  /** A stream: how many laps its markers have run, whole and part (their places along the path are a function of this alone). */
  phase?: number;
  /** How far apart its parts are pushed: 0 assembled; its children sit at pos * (1 + spread). */
  spread: number;
  /** Where a machine has put it just now (a turning part, a piston, a valve, a glow); drawn in place of pos, rot and opacity. */
  pose?: Pose;
  /** A plane cutting this object (and what is in it) open: everything beyond `at` along the axis (0 x, 1 y, 2 z) of the object is removed. */
  cut?: { axis: 0 | 1 | 2; at: number };
};

export type Frame = {
  panel: { rect: Rect; appear: number; fade: number; frame: boolean } | null;
  marks: MarkFrame[];
  /** The flat diagrams (flow, timeline, steps, chart) on the screen, and what is drawn in each. */
  diagrams: DiagramFrame[];
  /** Parents come before their children. */
  objects: ObjectFrame[];
  camera: { az: number; el: number; zoom: number; focus: FocusFrame };
  nextKey: number;
  /** The person's Explode control, 0 closed to 1 open, when they have used it (see explode.ts). */
  userExplode?: number;
  /** The person's Cut control, 0 whole to 1 cut through the middle, when they have used it. */
  userCut?: number;
  /** What is turning, and how the parts are tied to it. */
  motion: Motion;
};

export function emptyFrame(): Frame {
  return {
    panel: null, marks: [], diagrams: [], objects: [], nextKey: 1, motion: emptyMotion(),
    camera: { ...DEFAULT_CAMERA, focus: { key: null, k: 1 } },
  };
}

// ---- Tracks: a property over time -----------------------------------------------------------

type Seg = { start: number; dur: number; from: number[]; to: number[]; /** A smooth path from the start through these points to the end. */ curve?: number[][] };
type Track = { init: number[]; segs: Seg[] };

const track = (init: readonly number[]): Track => ({ init: [...init], segs: [] });

export function ease(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

function progress(t: number, start: number, dur: number): number {
  if (t < start) return 0;
  if (!(dur > 0)) return 1;
  return Math.min(1, (t - start) / dur);
}

/** A Catmull-Rom spline through the points, at u from 0 to 1 along the whole. */
export function catmull(pts: readonly number[][], u: number): number[] {
  const last = pts.length - 1;
  if (last <= 0) return [...(pts[0] ?? [0, 0, 0])];
  if (u >= 1) return [...(pts[last] as number[])];
  const f = Math.max(0, u) * last;
  const i = Math.min(last - 1, Math.floor(f));
  const t = f - i;
  const at = (k: number) => pts[Math.max(0, Math.min(last, k))] as number[];
  const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
  return b.map((_, k) => {
    const [pa, pb, pc, pd] = [a[k] ?? 0, b[k] ?? 0, c[k] ?? 0, d[k] ?? 0];
    return 0.5 * (2 * pb + (-pa + pc) * t + (2 * pa - 5 * pb + 4 * pc - pd) * t * t + (-pa + 3 * pb - 3 * pc + pd) * t * t * t);
  });
}

function valueAt(tr: Track, t: number): number[] {
  let seg: Seg | undefined;
  for (const s of tr.segs) {
    if (s.start <= t) seg = s;
    else break;
  }
  if (!seg) return [...tr.init];
  const p = ease(progress(t, seg.start, seg.dur));
  if (seg.curve && p < 1) return catmull(seg.curve, p);
  return seg.to.map((to, i) => {
    const from = seg.from[i] ?? to;
    return p >= 1 ? to : from + (to - from) * p;
  });
}

function tweenTo(tr: Track, at: number, dur: number, to: readonly number[]): void {
  tr.segs.push({ start: at, dur, from: valueAt(tr, at), to: [...to] });
}

type FocusSeg = { start: number; dur: number; to: number | null; from: FocusFrame };
type FocusTrack = { init: number | null; segs: FocusSeg[] };

function focusAt(tr: FocusTrack, t: number): FocusFrame {
  let seg: FocusSeg | undefined;
  for (const s of tr.segs) {
    if (s.start <= t) seg = s;
    else break;
  }
  if (!seg) return { key: tr.init, k: 1 };
  const p = ease(progress(t, seg.start, seg.dur));
  return p >= 1 ? { key: seg.to, k: 1 } : { key: seg.to, from: seg.from, k: p };
}

// ---- Instances ------------------------------------------------------------------------------

/** `grow` and `wipe` are the seconds a mark takes to be drawn on and to be wiped off, when they are not the usual ones (strokes are drawn like a pen). */
type Life = { bornAt: number; diedAt: number | undefined; grow?: number; wipe?: number };

type MarkInst = Life & { key: number; id: string; mark: Mark; color: Track; opacity: Track; tinted: boolean; onKey?: number };
type ObjInst = Life & {
  key: number; id: string; parentKey: number | null; def: AddAction;
  pos: Track; rot: Track; scale: Track; color: Track; opacity: Track; draw: Track; spread: Track;
  /** The plane that cuts it open, once a `cut` has named it. */
  cut?: { axis: 0 | 1 | 2; at: Track };
};
type PanelInst = Life & { rect: Track; frame: boolean };
type Pulse = { key: number; start: number; dur: number; color: Rgb | undefined };

export type StepPlan = {
  marks: MarkInst[];
  diagrams: DiagramPlan;
  objs: ObjInst[];
  panels: PanelInst[];
  az: Track; el: Track; zoom: Track; focus: FocusTrack;
  pulses: Pulse[];
  spins: SpinPlan[];
  cranks: CrankDef[];
  cams: CamDef[];
  flashes: FlashDef[];
  loops: LoopDef[];
  joints: JointDef[];
  couples: CoupleDef[];
  nextKey: number;
  /** Authored seconds until the last action has finished. */
  duration: number;
};

const NEVER = -Infinity;

function aliveAt(l: Life, t: number): boolean {
  return l.bornAt <= t && (l.diedAt === undefined || l.diedAt > t);
}

function appearOf(l: Life, t: number): number {
  return ease(progress(t, l.bornAt, l.grow ?? APPEAR_SECONDS));
}

function fadeOf(l: Life, t: number): number {
  return l.diedAt === undefined ? 1 : 1 - progress(t, l.diedAt, l.wipe ?? FADE_OUT_SECONDS);
}

function visibleAt(l: Life, t: number): boolean {
  return l.bornAt <= t && (l.diedAt === undefined || t < l.diedAt + (l.wipe ?? FADE_OUT_SECONDS));
}

/** A box, circle, underline or arrow is drawn on like a stroke of a pen, eased: a longer line takes longer, 0.7 to 1.1 seconds. */
export const STROKE_WIPE_SECONDS = 0.5;
export function strokeSeconds(mark: Mark): number | undefined {
  let length: number;
  switch (mark.op) {
    case 'box': length = 2 * (mark.w + mark.h); break;
    case 'circle': length = Math.PI * (mark.w + mark.h) * 0.75; break;
    case 'underline': length = mark.w; break;
    case 'arrow': length = Math.hypot(mark.x2 - mark.x1, mark.y2 - mark.y1); break;
    case 'poly': length = pathLength(mark.pts, true); break;
    case 'trace': length = pathLength(smoothPath(mark.pts, 3)); break;
    default: return undefined;
  }
  return Math.max(0.7, Math.min(1.1, 0.6 + length / 3500));
}

// ---- Planning -------------------------------------------------------------------------------

/** Builds the plan of a step from the Frame the previous step settled in. */
export function planStep(base: Frame, step: Step): StepPlan {
  const plan: StepPlan = {
    marks: [], diagrams: base.diagrams.length > 0 ? diagramPlanFrom(base.diagrams) : emptyDiagramPlan(), objs: [], panels: [],
    az: track([base.camera.az]), el: track([base.camera.el]), zoom: track([base.camera.zoom]),
    focus: { init: base.camera.focus.key, segs: [] },
    pulses: [], nextKey: base.nextKey, duration: 0,
    spins: base.motion.spins.map(spinPlanFrom), cranks: [...base.motion.cranks], cams: [...base.motion.cams], flashes: [...base.motion.flashes], loops: [...base.motion.loops], joints: [...base.motion.joints], couples: [...base.motion.couples],
  };
  for (const m of base.marks) {
    plan.marks.push({
      key: m.key, id: m.id, mark: m.mark, bornAt: NEVER, diedAt: undefined,
      ...(strokeSeconds(m.mark) !== undefined ? { grow: strokeSeconds(m.mark), wipe: STROKE_WIPE_SECONDS } : {}),
      color: track(m.color), opacity: track([m.opacity]), tinted: m.tinted, ...(m.onKey !== undefined ? { onKey: m.onKey } : {}),
    });
  }
  for (const o of base.objects) {
    plan.objs.push({
      key: o.key, id: o.id, parentKey: o.parentKey, def: o.def, bornAt: NEVER, diedAt: undefined,
      pos: track(o.pos), rot: track(o.rot), scale: track(o.scale), color: track(o.color), opacity: track([o.opacity]),
      draw: track([o.draw]), spread: track([o.spread]),
      ...(o.cut ? { cut: { axis: o.cut.axis, at: track([o.cut.at]) } } : {}),
    });
  }
  if (base.panel) {
    const r = base.panel.rect;
    plan.panels.push({ bornAt: NEVER, diedAt: undefined, rect: track([r.x, r.y, r.w, r.h]), frame: base.panel.frame });
  }

  const times = diagramTimes(step.actions);
  const events = step.actions.map((a, i) => ({ a, i, at: times.get(i) ?? Math.max(0, a.at ?? 0) }));
  events.sort((p, q) => p.at - q.at || p.i - q.i);
  // A later speed/lock command replaces the remaining portion of that spin's
  // ramp. Keep ramp time separate from all other action durations until the
  // complete chronological sequence is known.
  // SpinPlan survives object replacement even when its numeric object key changes.
  const activeRamps = new Map<SpinPlan, number>();
  let finishedRamps = 0;
  const ramp = (spin: SpinPlan, at: number, length: number) => {
    const previous = activeRamps.get(spin);
    if (previous !== undefined) finishedRamps = Math.max(finishedRamps, Math.min(previous, at));
    activeRamps.set(spin, at + length);
  };
  for (const { a, at } of events) applyAction(plan, a, at, ramp);
  plan.duration = Math.max(plan.duration, finishedRamps, ...activeRamps.values());
  return plan;
}

function lookup<T extends Life & { id: string }>(list: readonly T[], id: string, at: number): T | undefined {
  for (let i = list.length - 1; i >= 0; i--) {
    const x = list[i];
    if (x && x.id === id && aliveAt(x, at)) return x;
  }
  return undefined;
}

function alivePanel(plan: StepPlan, at: number): PanelInst | undefined {
  for (let i = plan.panels.length - 1; i >= 0; i--) {
    const p = plan.panels[i];
    if (p && aliveAt(p, at)) return p;
  }
  return undefined;
}

function ensurePanel(plan: StepPlan, at: number): void {
  if (alivePanel(plan, at)) return;
  const r = DEFAULT_PANEL;
  plan.panels.push({ bornAt: at, diedAt: undefined, rect: track([r.x, r.y, r.w, r.h]), frame: false });
  plan.duration = Math.max(plan.duration, at + APPEAR_SECONDS);
}

function kill(plan: StepPlan, l: Life, at: number): void {
  if (l.diedAt === undefined || l.diedAt > at) l.diedAt = at;
  plan.duration = Math.max(plan.duration, at + (l.wipe ?? FADE_OUT_SECONDS));
}

function descendants(plan: StepPlan, rootKey: number, at: number): ObjInst[] {
  const keys = new Set([rootKey]);
  const out: ObjInst[] = [];
  for (let grew = true; grew; ) {
    grew = false;
    for (const o of plan.objs) {
      if (o.parentKey !== null && keys.has(o.parentKey) && !keys.has(o.key) && (o.diedAt === undefined || o.diedAt > at)) {
        keys.add(o.key);
        out.push(o);
        grew = true;
      }
    }
  }
  return out;
}

const v3 = (v: Vec3 | undefined, d: Vec3): Vec3 => (v ? [v[0], v[1], v[2]] : [d[0], d[1], d[2]]);

function applyAction(plan: StepPlan, a: Action, at: number, spinRamp: (spin: SpinPlan, at: number, length: number) => void): void {
  const dur = 'dur' in a && a.dur !== undefined ? a.dur : DEFAULT_DUR;
  const end = (len: number) => { plan.duration = Math.max(plan.duration, at + len); };
  switch (a.op) {
    case 'box': case 'circle': case 'underline': case 'arrow': case 'poly': case 'point': case 'trace': case 'label': case 'card': case 'image': case 'pin': {
      const color = 'color' in a ? a.color : undefined;
      let onKey: number | undefined;
      if (a.op === 'pin') {
        const host = lookup(plan.objs, a.on, at);
        if (!host) return;
        onKey = host.key;
      }
      const grow = strokeSeconds(a);
      // A mark or tag added again under its id takes the old one's place (and key, so a tag keeps its spot on the board).
      const was = lookup(plan.marks, a.id, at);
      if (was) plan.marks.splice(plan.marks.indexOf(was), 1);
      plan.marks.push({
        key: was ? was.key : plan.nextKey++, id: a.id, mark: a, bornAt: at, diedAt: undefined,
        color: track(parseColor(color)), opacity: track([1]), tinted: color !== undefined,
        ...(onKey !== undefined ? { onKey } : {}),
        ...(grow !== undefined ? { grow, wipe: STROKE_WIPE_SECONDS } : {}),
      });
      end(grow ?? APPEAR_SECONDS);
      return;
    }
    case 'diagram': case 'node': case 'edge': case 'series': case 'dot': case 'tick':
      end(applyDiagramAction(plan.diagrams, a, at, () => plan.nextKey++));
      return;
    case 'panel': {
      const p = alivePanel(plan, at);
      const target = [a.x, a.y, a.w, a.h];
      if (!p) {
        plan.panels.push({ bornAt: at, diedAt: undefined, rect: track(target), frame: a.frame === true });
        end(APPEAR_SECONDS);
      } else {
        if (a.frame !== undefined) p.frame = a.frame;
        tweenTo(p.rect, at, dur, target);
        end(dur);
      }
      return;
    }
    case 'add': {
      if (a.shape === 'stream') {
        addStream(plan, a, at, end);
        return;
      }
      ensurePanel(plan, at);
      if (a.shape === 'array') {
        addArray(plan, a, at);
        end(APPEAR_SECONDS);
        return;
      }
      const parent = 'parent' in a && a.parent !== undefined ? lookup(plan.objs, a.parent, at) : undefined;
      // Raw scenes can bypass validation. A missing holder must not silently make a child a root.
      if ('parent' in a && a.parent !== undefined && !parent) return;
      const given = (a as { color?: string }).color;
      const replaced = lookup(plan.objs, a.id, at);
      let mountedPos: Vec3 | undefined;
      if (hasMount(a)) {
        if (!parent) return;
        const parentAnchors = parent.def.shape === 'part' ? resolvePartGeometry(parent.def).anchors : { origin: [0, 0, 0] as Vec3 };
        const selfAnchors = a.shape === 'part' ? resolvePartGeometry(a).anchors : { origin: [0, 0, 0] as Vec3 };
        const parentName = a.parentAnchor ?? 'origin';
        const selfName = a.shape === 'part' ? a.selfAnchor ?? 'origin' : 'origin';
        // A differently scheduled replacement can change the available sockets after validation.
        // Never silently fall back to the origin or leave an invalid mounted replacement half-applied.
        if (!Object.hasOwn(parentAnchors, parentName) || !Object.hasOwn(selfAnchors, selfName)) return;
        const rot = a.rot ?? (replaced ? valueAt(replaced.rot, at) as Vec3 : [0, 0, 0]);
        const scale = replaced ? valueAt(replaced.scale, at) as Vec3 : [1, 1, 1] as Vec3;
        mountedPos = mountPosition(parentAnchors[parentName]!, selfAnchors[selfName]!, rot, a.pos ?? [0, 0, 0], scale);
        if (mountedPos.some((v) => !Number.isFinite(v) || v < -100 || v > 100)) return;
      }
      const fresh: ObjInst = {
        key: plan.nextKey++, id: a.id, parentKey: parent ? parent.key : replaced ? replaced.parentKey : null, def: a,
        bornAt: at, diedAt: undefined,
        pos: track(mountedPos ?? ('pos' in a && a.pos ? a.pos : [0, 0, 0])),
        rot: track('rot' in a && a.rot ? a.rot : [0, 0, 0]),
        scale: track([1, 1, 1]),
        color: track(given !== undefined ? parseColor(given) : defaultColor(a)),
        opacity: track([('opacity' in a && a.opacity !== undefined) ? a.opacity : 1]),
        draw: track([('draw' in a && a.draw !== undefined) ? a.draw : 1]), spread: track([0]),
      };
      if (replaced) replaceObject(plan, replaced, fresh, at);
      else plan.objs.push(fresh);
      end(replaced ? REPLACE_SECONDS : APPEAR_SECONDS);
      return;
    }
    case 'move': case 'turn': case 'scale': {
      const o = lookup(plan.objs, a.id, at);
      if (!o) return;
      tweenTo(a.op === 'move' ? o.pos : a.op === 'turn' ? o.rot : o.scale, at, dur, a.to);
      end(dur);
      return;
    }
    case 'along': {
      const o = lookup(plan.objs, a.id, at);
      if (!o) return;
      const from = valueAt(o.pos, at);
      const to = a.pts[a.pts.length - 1] as Vec3;
      o.pos.segs.push({ start: at, dur, from, to: [...to], curve: [from, ...a.pts.map((p) => [...p])] });
      end(dur);
      return;
    }
    case 'explode': case 'reveal': {
      const o = lookup(plan.objs, a.id, at);
      if (!o) return;
      tweenTo(a.op === 'explode' ? o.spread : o.draw, at, dur, [a.to]);
      // Pulled apart, a machine stops: its parts no longer fit together.
      if (a.op === 'explode' && a.to > 0 && plan.spins.length > 0) {
        const ramp = Math.max(0.3, dur);
        for (const sp of plan.spins) {
          stopSpin(sp, at, ramp);
          spinRamp(sp, at, sp.segs.at(-1)?.ramp ?? 0);
        }
      }
      end(dur);
      return;
    }
    case 'style': {
      const target = lookup(plan.objs, a.id, at);
      const mark = target ? undefined : lookup(plan.marks, a.id, at);
      if (!target && !mark) {
        if (styleDiagramThing(plan.diagrams, a.id, at, a.color, a.opacity)) end(dur);
        return;
      }
      const hit: Array<ObjInst | MarkInst> = target ? [target, ...descendants(plan, target.key, at)] : [mark as MarkInst];
      for (const h of hit) {
        if (a.color !== undefined) {
          tweenTo(h.color, at, dur, parseColor(a.color));
          if ('tinted' in h) h.tinted = true;
        }
        if (a.opacity !== undefined) tweenTo(h.opacity, at, dur, [a.opacity]);
      }
      end(dur);
      return;
    }
    case 'highlight': {
      const target = lookup(plan.objs, a.id, at);
      const mark = target ? undefined : lookup(plan.marks, a.id, at);
      if (!target && !mark) {
        if (pulseDiagramThing(plan.diagrams, a.id, at, dur, a.color)) end(Math.max(0.2, dur));
        return;
      }
      const hit: Array<ObjInst | MarkInst> = target ? [target, ...descendants(plan, target.key, at)] : [mark as MarkInst];
      for (const h of hit) plan.pulses.push({ key: h.key, start: at, dur: Math.max(0.2, dur), color: a.color !== undefined ? parseColor(a.color) : undefined });
      end(Math.max(0.2, dur));
      return;
    }
    case 'cut': {
      const o = lookup(plan.objs, a.id, at);
      if (!o) return;
      const axis = a.axis === 'x' ? 0 : a.axis === 'y' ? 1 : 2;
      if (!o.cut) o.cut = { axis, at: track([100]) };
      else if (a.axis !== undefined) o.cut.axis = axis;
      tweenTo(o.cut.at, at, dur, [a.to]);
      end(dur);
      return;
    }
    case 'spin': {
      const o = lookup(plan.objs, a.id, at);
      if (!o) return;
      let sp = plan.spins.find((x) => x.key === o.key);
      const axis = a.axis === 'x' ? 0 : a.axis === 'y' ? 1 : a.axis === undefined ? (sp ? sp.axis : 2) : 2;
      if (!sp) {
        sp = spinPlanFrom({ key: o.key, axis, angle: 0, rate: 0 });
        plan.spins.push(sp);
      }
      const by = a.by !== undefined ? lookup(plan.objs, a.by, at) : undefined;
      if (a.by !== undefined) {
        if (!by || by.key === o.key) return;
        setLock(sp, at, { byKey: by.key, ratio: a.ratio ?? 1, phase: a.phase ?? 0 }, axis);
        spinRamp(sp, at, 0);
      } else {
        const ramp = a.rpm === 0 || a.dur !== undefined ? dur : 0.8;
        setRate(sp, at, (a.rpm ?? 0) * 6, ramp, axis);
        spinRamp(sp, at, ramp);
      }
      end(0.2);
      return;
    }
    case 'crank': {
      const piston = lookup(plan.objs, a.id, at);
      const shaft = lookup(plan.objs, a.shaft, at);
      const rod = a.rod !== undefined ? lookup(plan.objs, a.rod, at) : undefined;
      if (!piston || !shaft || (a.rod !== undefined && !rod)) return;
      plan.cranks = plan.cranks.filter((c) => c.key !== piston.key);
      plan.cranks.push({ key: piston.key, shaftKey: shaft.key, rodKey: rod ? rod.key : null, pin: a.pin ?? 1 });
      end(0.2);
      return;
    }
    case 'cam': {
      const valve = lookup(plan.objs, a.id, at);
      const cam = lookup(plan.objs, a.by, at);
      if (!valve || !cam) return;
      plan.cams = plan.cams.filter((c) => c.key !== valve.key);
      plan.cams.push({ key: valve.key, byKey: cam.key, lift: a.lift, open: a.open ?? 110, phase: a.phase ?? 180 });
      end(0.2);
      return;
    }
    case 'flash': {
      const glow = lookup(plan.objs, a.id, at);
      const by = lookup(plan.objs, a.by, at);
      if (!glow || !by) return;
      plan.flashes = plan.flashes.filter((c) => c.key !== glow.key);
      plan.flashes.push({ key: glow.key, byKey: by.key, angle: a.angle, span: a.span, cycle: a.cycle ?? 720 });
      end(0.2);
      return;
    }
    case 'loop': {
      const o = lookup(plan.objs, a.id, at);
      if (!o) return;
      const by = a.by !== undefined ? lookup(plan.objs, a.by, at) : undefined;
      if (a.by !== undefined && (!by || by.key === o.key)) return;
      const joint = plan.joints.find((j) => j.key === o.key);
      const kind = a.kind ?? (joint?.kind === 'hinge' ? 'swing' : joint?.kind === 'slide' ? 'slide' : undefined);
      if (kind === undefined) return;
      // One loop to an object: the later one replaces the earlier (and `stop` is only that replacement left empty).
      const driver = loopDriver(o.key);
      plan.loops = plan.loops.filter((l) => l.key !== o.key);
      plan.spins = plan.spins.filter((s) => s.key !== driver);
      if (kind !== 'stop') {
        const axis = a.axis === 'x' ? 0 : a.axis === 'z' ? 2 : a.axis === 'y' ? 1 : kind === 'swing' ? 2 : 1;
        plan.loops.push({ key: o.key, kind, axis, amount: a.amount ?? 1, pivot: a.pivot ? asVec(a.pivot) : [0, 0, 0] });
        const sp = spinPlanFrom({ key: driver, axis: 2, angle: loopStart(kind) + (by ? 0 : a.phase ?? 0), rate: 0 });
        plan.spins.push(sp);
        if (by) setLock(sp, at, { byKey: by.key, ratio: a.ratio ?? 1, phase: a.phase ?? 0 }, 2);
        else setRate(sp, at, 360 / (a.period ?? 2), 0, 2);
      }
      end(0.2);
      return;
    }
    case 'joint': {
      const o = lookup(plan.objs, a.id, at);
      if (!o) return;
      const to = a.kind === 'fixed' && a.to !== undefined ? lookup(plan.objs, a.to, at) : undefined;
      if (a.kind === 'fixed' && (!to || to.key === o.key)) return;
      const axis = a.axis === 'x' ? 0 : a.axis === 'z' ? 2 : a.axis === 'y' ? 1 : a.kind === 'hinge' ? 2 : 1;
      plan.joints = plan.joints.filter((j) => j.key !== o.key);
      plan.joints.push({ key: o.key, kind: a.kind, axis, dir: a.dir ? asVec(a.dir) : null, pivot: a.pivot ? asVec(a.pivot) : [0, 0, 0], min: a.min, max: a.max, toKey: to ? to.key : null });
      end(0.2);
      return;
    }
    case 'couple': {
      const o = lookup(plan.objs, a.id, at);
      if (!o) return;
      plan.couples = plan.couples.filter((c) => c.key !== o.key);
      if (a.stop !== true) {
        const by = a.by !== undefined ? lookup(plan.objs, a.by, at) : undefined;
        if (!by || by.key === o.key) return;
        plan.couples.push({ key: o.key, byKey: by.key, ratio: a.ratio ?? 1, pitch: a.pitch, phase: a.phase ?? 0 });
      }
      end(0.2);
      return;
    }
    case 'orbit': {
      tweenTo(plan.az, at, dur, [a.az]);
      tweenTo(plan.el, at, dur, [Math.max(-89, Math.min(89, a.el))]);
      end(dur);
      return;
    }
    case 'zoom': {
      tweenTo(plan.zoom, at, dur, [a.to]);
      end(dur);
      return;
    }
    case 'focus': {
      const o = a.id !== undefined ? lookup(plan.objs, a.id, at) : undefined;
      if (a.id !== undefined && !o) return;
      plan.focus.segs.push({ start: at, dur, to: o ? o.key : null, from: focusAt(plan.focus, at) });
      end(dur);
      return;
    }
    case 'clear': {
      clearTarget(plan, a.target, at);
      end(FADE_OUT_SECONDS);
      return;
    }
    case 'wait':
    case 'go':
      return; // guide mode is the app's business, not the page's: nothing to draw
  }
}

/** Mount instructions stay data until chronological planning, where parent geometry and inherited base transforms are known. */
function hasMount(def: AddAction): def is Extract<AddAction, { shape: 'part' | 'group' }> {
  return (def.shape === 'part' || def.shape === 'group') && (def.parentAnchor !== undefined || (def.shape === 'part' && def.selfAnchor !== undefined));
}

/** Seconds an object that is added again under the id of one already there takes to swap in, the old one fading as the new comes up. */
export const REPLACE_SECONDS = 0.6;

/**
 * An `add` for an id that is already on the stage replaces that object in place (a richer model of the same part):
 * the old one fades out as the new one fades in, what hung from the old one (parts, pins) goes on hanging from the new,
 * and what was turning stays turning. Anything the answer does not mention is left alone.
 */
function replaceObject(plan: StepPlan, old: ObjInst, fresh: ObjInst, at: number): void {
  old.diedAt = at;
  old.wipe = REPLACE_SECONDS;
  fresh.grow = REPLACE_SECONDS;
  fresh.spread = track(valueAt(old.spread, at));
  // It starts where the old one had got to (moved, turned, scaled), unless the new one says where it goes.
  const given = fresh.def as { pos?: Vec3; rot?: Vec3 };
  if (!given.pos && !hasMount(fresh.def)) fresh.pos = track(valueAt(old.pos, at));
  if (!given.rot) fresh.rot = track(valueAt(old.rot, at));
  fresh.scale = track(valueAt(old.scale, at));
  if (old.cut && !fresh.cut) fresh.cut = { axis: old.cut.axis, at: track(valueAt(old.cut.at, at)) };
  // What hung from the old one hangs from the new, except what the new one itself hangs from (an answer can add a part and then
  // its former holder under it): that would make a loop, so it takes the old one's place in the old one's holder.
  const above = new Set<number>();
  for (let k: number | null = fresh.parentKey; k !== null && !above.has(k); ) {
    above.add(k);
    k = plan.objs.find((o) => o.key === k)?.parentKey ?? null;
  }
  for (const o of plan.objs) {
    if (o.parentKey === old.key && aliveAt(o, at)) o.parentKey = above.has(o.key) ? old.parentKey : fresh.key;
  }
  for (const m of plan.marks) if (m.onKey === old.key && aliveAt(m, at)) m.onKey = fresh.key;
  const to = (k: number): number => (k === old.key ? fresh.key : k);
  for (const sp of plan.spins) {
    if (sp.key === old.key) sp.key = fresh.key;
    if (sp.key === loopDriver(old.key)) sp.key = loopDriver(fresh.key);
    if (sp.lock) sp.lock.byKey = to(sp.lock.byKey);
  }
  plan.cranks = plan.cranks.map((c) => ({ ...c, key: to(c.key), shaftKey: to(c.shaftKey), rodKey: c.rodKey === null ? null : to(c.rodKey) }));
  plan.cams = plan.cams.map((c) => ({ ...c, key: to(c.key), byKey: to(c.byKey) }));
  plan.flashes = plan.flashes.map((c) => ({ ...c, key: to(c.key), byKey: to(c.byKey) }));
  plan.loops = plan.loops.map((l) => ({ ...l, key: to(l.key) }));
  plan.joints = plan.joints.map((j) => ({ ...j, key: to(j.key), toKey: j.toKey === null ? null : to(j.toKey) }));
  plan.couples = plan.couples.map((c) => ({ ...c, key: to(c.key), byKey: to(c.byKey) }));
  // The new one sits where the old one was in the list, so parents still come before their children.
  plan.objs.splice(plan.objs.indexOf(old) + 1, 0, fresh);
  plan.duration = Math.max(plan.duration, at + REPLACE_SECONDS);
}

/** Seconds a stream's markers take for the whole way when the scene gives no period. */
export const STREAM_PERIOD = 4;

/**
 * A stream: markers running along a path on the 3D stage (it hangs from the path, so it goes with it) or along an arrow of a flat diagram. Its laps are
 * an angle kept like a loop's (under the key loopDriver gives), free at one lap a period or locked to a spinning part, so it runs on by itself.
 */
function addStream(plan: StepPlan, a: Extract<AddAction, { shape: 'stream' }>, at: number, end: (len: number) => void): void {
  const path = lookup(plan.objs, a.along, at);
  let key: number;
  if (path) {
    ensurePanel(plan, at);
    const replaced = lookup(plan.objs, a.id, at);
    const fresh: ObjInst = {
      key: plan.nextKey++, id: a.id, parentKey: path.key, def: a, bornAt: at, diedAt: undefined,
      pos: track([0, 0, 0]), rot: track([0, 0, 0]), scale: track([1, 1, 1]),
      color: track(a.color !== undefined ? parseColor(a.color) : defaultColor(a)),
      opacity: track([a.opacity ?? 1]), draw: track([1]), spread: track([0]),
    };
    if (replaced) replaceObject(plan, replaced, fresh, at);
    else plan.objs.push(fresh);
    key = fresh.key;
    end(replaced ? REPLACE_SECONDS : APPEAR_SECONDS);
  } else {
    const piece: StreamPiece = { op: 'stream', id: a.id, along: a.along, ...(a.mark ? { mark: a.mark } : {}), ...(a.count ? { count: a.count } : {}), ...(a.color ? { color: a.color } : {}), ...(a.toColor ? { toColor: a.toColor } : {}), ...(a.shiftAt !== undefined ? { shiftAt: a.shiftAt } : {}), ...(a.period !== undefined ? { period: a.period } : {}), ...(a.opacity !== undefined ? { opacity: a.opacity } : {}) };
    const seconds = applyDiagramAction(plan.diagrams, piece, at, () => plan.nextKey++);
    const inst = plan.diagrams.insts.findLast((i) => i.id === a.id && i.def.op === 'stream');
    if (!inst || seconds === 0) return;
    key = inst.key;
    end(seconds);
  }
  const by = a.by !== undefined && path ? lookup(plan.objs, a.by, at) : undefined;
  const driver = loopDriver(key);
  plan.spins = plan.spins.filter((s) => s.key !== driver);
  const sp = spinPlanFrom({ key: driver, axis: 2, angle: 0, rate: 0 });
  plan.spins.push(sp);
  if (by && by.key !== key) setLock(sp, at, { byKey: by.key, ratio: a.ratio ?? 1, phase: 0 }, 2);
  else setRate(sp, at, 360 / (a.period ?? STREAM_PERIOD), 0, 2);
}

/** Makes the copies of an array: the original joins a new group, and each further copy sits in a pivot that carries the step and turn. */
function addArray(plan: StepPlan, a: Extract<AddAction, { shape: 'array' }>, at: number): void {
  const of = lookup(plan.objs, a.of, at);
  if (!of) return;
  // An array written again: the old group and its generated copies go (fading out), while the original, however it came
  // to be written again, joins the new group; the rest of what is below the old group, which the answer does not write again, goes too.
  const before = lookup(plan.objs, a.id, at);
  let holder = of.parentKey;
  if (before) {
    const keep = new Set([of.key, ...descendants(plan, of.key, at).map((d) => d.key)]);
    for (const d of [before, ...descendants(plan, before.key, at)]) {
      if (keep.has(d.key)) continue;
      d.diedAt = at;
      d.wipe = REPLACE_SECONDS;
    }
    if (holder === before.key) holder = before.parentKey;
    plan.duration = Math.max(plan.duration, at + REPLACE_SECONDS);
  }
  const group: ObjInst = {
    key: plan.nextKey++, id: a.id, parentKey: holder, def: { op: 'add', shape: 'group', id: a.id } as AddAction,
    bornAt: of.bornAt, diedAt: undefined,
    pos: track([0, 0, 0]), rot: track([0, 0, 0]), scale: track([1, 1, 1]), color: track([255, 255, 255]), opacity: track([1]),
    draw: track([1]), spread: track([0]),
    ...(before ? { grow: REPLACE_SECONDS } : {}),
  };
  plan.objs.push(group);
  const subtree = [of, ...descendants(plan, of.key, at)];
  of.parentKey = group.key;
  const step = a.step ?? [0, 0, 0];
  const turn = a.turn ?? [0, 0, 0];
  for (let i = 1; i < a.count; i++) {
    const pivot: ObjInst = {
      key: plan.nextKey++, id: `${a.id}#${i}`, parentKey: group.key, def: { op: 'add', shape: 'group', id: `${a.id}#${i}` } as AddAction,
      bornAt: at, diedAt: undefined,
      pos: track([step[0] * i, step[1] * i, step[2] * i]), rot: track([turn[0] * i, turn[1] * i, turn[2] * i]),
      scale: track([1, 1, 1]), color: track([255, 255, 255]), opacity: track([1]), draw: track([1]), spread: track([0]),
    };
    plan.objs.push(pivot);
    const keyOf = new Map<number, number>();
    for (const src of subtree) {
      const key = plan.nextKey++;
      keyOf.set(src.key, key);
      plan.objs.push({
        key, id: `${a.id}#${i}.${src.id}`, parentKey: src === of ? pivot.key : (keyOf.get(src.parentKey ?? -1) ?? pivot.key),
        def: src.def, bornAt: at, diedAt: undefined,
        pos: track(valueAt(src.pos, at)), rot: track(valueAt(src.rot, at)), scale: track(valueAt(src.scale, at)),
        color: track(valueAt(src.color, at)), opacity: track(valueAt(src.opacity, at)), draw: track(valueAt(src.draw, at)), spread: track(valueAt(src.spread, at)),
      });
    }
  }
}

function clearTarget(plan: StepPlan, target: string, at: number): void {
  const killMarks = target === 'all' || target === 'marks';
  const killPanel = target === 'all' || target === 'panel';
  if (killMarks) for (const m of plan.marks) if (aliveAt(m, at)) kill(plan, m, at);
  if (killMarks) clearDiagrams(plan.diagrams, 'all', at);
  if (killPanel) {
    for (const o of plan.objs) if (aliveAt(o, at)) kill(plan, o, at);
    const p = alivePanel(plan, at);
    if (p) kill(plan, p, at);
    // A new panel starts from the default camera.
    for (const [tr, v] of [[plan.az, DEFAULT_CAMERA.az], [plan.el, DEFAULT_CAMERA.el], [plan.zoom, DEFAULT_CAMERA.zoom]] as const) {
      tweenTo(tr, at, 0, [v]);
    }
    plan.focus.segs.push({ start: at, dur: 0, to: null, from: focusAt(plan.focus, at) });
  }
  if (killMarks || killPanel) return;
  const o = lookup(plan.objs, target, at);
  if (o) {
    kill(plan, o, at);
    for (const d of descendants(plan, o.key, at)) kill(plan, d, at);
    return;
  }
  const m = lookup(plan.marks, target, at);
  if (m) kill(plan, m, at);
  else clearDiagrams(plan.diagrams, target, at);
}

// ---- Evaluating -----------------------------------------------------------------------------

function pulseFor(plan: StepPlan, key: number, t: number): { amount: number; color: Rgb | undefined } {
  let amount = 0;
  let color: Rgb | undefined;
  for (const p of plan.pulses) {
    if (p.key !== key || t < p.start || t >= p.start + p.dur) continue;
    const a = Math.sin(Math.PI * progress(t, p.start, p.dur));
    if (a >= amount) {
      amount = a;
      color = p.color;
    }
  }
  return { amount, color };
}

const asVec = (a: number[]): Vec3 => [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];
const asRgb = (a: number[]): Rgb => [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];

/** The complete state at authored time `t` seconds into the step. Infinity settles the step. */
export function evaluate(plan: StepPlan, t: number): Frame {
  // A part keeps turning, so it has no angle at the end of time: settling reads it as the step's own length.
  const spinTime = Number.isFinite(t) ? t : plan.duration;
  const marks: MarkFrame[] = [];
  const hosts = new Map<number, ObjInst>();
  for (const o of plan.objs) hosts.set(o.key, o);
  for (const m of plan.marks) {
    if (!visibleAt(m, t)) continue;
    const pulse = pulseFor(plan, m.key, t);
    let appear = appearOf(m, t);
    let fade = fadeOf(m, t);
    if (m.onKey !== undefined) {
      // A pin lives and dies with its object.
      const host = hosts.get(m.onKey);
      if (!host || !visibleAt(host, t)) continue;
      appear = Math.min(appear, appearOf(host, t));
      fade = Math.min(fade, fadeOf(host, t));
    }
    marks.push({
      key: m.key, id: m.id, mark: m.mark, color: asRgb(valueAt(m.color, t)), opacity: valueAt(m.opacity, t)[0] ?? 1,
      appear, fade, pulse: pulse.amount, pulseColor: pulse.color, tinted: m.tinted, ...(m.onKey !== undefined ? { onKey: m.onKey } : {}),
    });
  }
  const diagrams = plan.diagrams.insts.length > 0 ? evaluateDiagrams(plan.diagrams, t) : [];
  const objects: ObjectFrame[] = [];
  for (const o of parentsFirst(plan.objs)) {
    if (!visibleAt(o, t)) continue;
    const pulse = pulseFor(plan, o.key, t);
    objects.push({
      key: o.key, id: o.id, parentKey: o.parentKey, def: o.def, shape: o.def.shape,
      pos: asVec(valueAt(o.pos, t)), rot: asVec(valueAt(o.rot, t)), scale: asVec(valueAt(o.scale, t)),
      color: asRgb(valueAt(o.color, t)), opacity: valueAt(o.opacity, t)[0] ?? 1,
      appear: appearOf(o, t), fade: fadeOf(o, t), pulse: pulse.amount, pulseColor: pulse.color,
      draw: valueAt(o.draw, t)[0] ?? 1, spread: valueAt(o.spread, t)[0] ?? 0,
      ...cutOf(o, t),
    });
  }
  // A crank on a plain-shape disc draws its own pin, so the rod and the pin the person sees are one point (a kit crankshaft has its own).
  for (const c of plan.cranks) {
    const shaft = objects.find((o) => o.key === c.shaftKey);
    if (!shaft || !drawsOwnPin(shaft.def)) continue;
    const rod = c.rodKey !== null ? objects.find((o) => o.key === c.rodKey) : undefined;
    const id = `${shaft.id}-pin`;
    const g = crankPinSize(shaft.def, rod?.def);
    objects.push({
      key: crankPinKey(c.key), id, parentKey: shaft.parentKey, shape: 'cylinder', pos: [...shaft.pos], rot: [90, 0, 0], scale: [1, 1, 1], color: [236, 236, 240], opacity: 1,
      appear: shaft.appear, fade: shaft.fade, pulse: 0, pulseColor: undefined, draw: 1, spread: shaft.spread,
      def: { op: 'add', shape: 'cylinder', id, size: g.pin, rot: [90, 0, 0], color: 'white' } as AddAction,
    });
  }
  const motion = motionOf(plan, objects, spinTime, diagrams);
  applyPoses(objects, motion);
  applyPhases(objects, motion);
  let panel: Frame['panel'] = null;
  for (const p of plan.panels) {
    if (!visibleAt(p, t)) continue;
    const r = valueAt(p.rect, t);
    panel = { rect: { x: r[0] ?? 0, y: r[1] ?? 0, w: r[2] ?? 0, h: r[3] ?? 0 }, appear: appearOf(p, t), fade: fadeOf(p, t), frame: p.frame };
  }
  return {
    panel, marks, diagrams: phasedDiagrams(diagrams, motion), objects, nextKey: plan.nextKey, motion,
    camera: {
      az: valueAt(plan.az, t)[0] ?? 0, el: valueAt(plan.el, t)[0] ?? 0, zoom: valueAt(plan.zoom, t)[0] ?? 1,
      focus: focusAt(plan.focus, t),
    },
  };
}

/** The plane cutting an object open at time t, when it is within the world (100 and beyond means no cut). */
function cutOf(o: ObjInst, t: number): { cut?: { axis: 0 | 1 | 2; at: number } } {
  if (!o.cut) return {};
  const at = valueAt(o.cut.at, t)[0] ?? 100;
  return at < 99.5 ? { cut: { axis: o.cut.axis, at } } : {};
}

/** The objects with every parent before its children (a replaced object's children now hang from one made later). Stable otherwise. */
function parentsFirst(objs: readonly ObjInst[]): readonly ObjInst[] {
  const index = new Map<number, number>();
  objs.forEach((o, i) => index.set(o.key, i));
  if (objs.every((o, i) => o.parentKey === null || (index.get(o.parentKey) ?? -1) < i)) return objs;
  const out: ObjInst[] = [];
  const done = new Set<number>();
  const visit = (o: ObjInst, depth: number): void => {
    if (done.has(o.key)) return;
    done.add(o.key);
    const parent = o.parentKey !== null && depth < 64 ? objs[index.get(o.parentKey) ?? -1] : undefined;
    if (parent) visit(parent, depth + 1);
    out.push(o);
  };
  for (const o of objs) visit(o, 0);
  return out;
}

/** What is turning at time `t`, and what is tied to it, limited to what is still on the stage. */
function motionOf(plan: StepPlan, objects: readonly ObjectFrame[], t: number, diagrams: readonly DiagramFrame[] = []): Motion {
  if (plan.spins.length + plan.cranks.length + plan.cams.length + plan.flashes.length + plan.loops.length + plan.joints.length + plan.couples.length === 0) return emptyMotion();
  const alive = new Set(objects.map((o) => o.key));
  for (const d of diagrams) for (const it of d.items) if (it.def.op === 'stream') alive.add(it.key);
  // A loop's angle (under a key below zero) lives as long as the object it moves.
  const spins = spinsAt(plan.spins, t).filter((s) => alive.has(s.key < 0 ? loopDriver(s.key) : s.key));
  const both = (a: number, b: number) => alive.has(a) && alive.has(b);
  return {
    spins,
    cranks: plan.cranks.filter((c) => both(c.key, c.shaftKey) && (c.rodKey === null || alive.has(c.rodKey))),
    cams: plan.cams.filter((c) => both(c.key, c.byKey)),
    flashes: plan.flashes.filter((c) => both(c.key, c.byKey)),
    loops: plan.loops.filter((l) => alive.has(l.key)),
    joints: plan.joints.filter((j) => alive.has(j.key) && (j.toKey === null || alive.has(j.toKey))),
    couples: plan.couples.filter((c) => both(c.key, c.byKey)),
  };
}

/** The laps each stream has run, from the angle kept for it. */
function applyPhases(objects: ObjectFrame[], motion: Motion): void {
  if (motion.spins.length === 0) return;
  const angles = new Map(motion.spins.map((s) => [s.key, s.angle] as const));
  for (const o of objects) {
    const angle = o.shape === 'stream' ? angles.get(loopDriver(o.key)) : undefined;
    if (angle !== undefined) o.phase = angle / 360;
  }
}

function phasedDiagrams(diagrams: readonly DiagramFrame[], motion: Motion): DiagramFrame[] {
  if (motion.spins.length === 0 || !diagrams.some((d) => d.items.some((it) => it.def.op === 'stream'))) return diagrams as DiagramFrame[];
  const angles = new Map(motion.spins.map((s) => [s.key, s.angle] as const));
  return diagrams.map((d) => ({
    ...d,
    items: d.items.map((it) => {
      const angle = it.def.op === 'stream' ? angles.get(loopDriver(it.key)) : undefined;
      return angle === undefined ? it : { ...it, phase: angle / 360 };
    }),
  }));
}

function applyPoses(objects: ObjectFrame[], motion: Motion): void {
  const placed = poses(objects, motion);
  if (placed.size === 0) return;
  for (const o of objects) {
    const pose = placed.get(o.key);
    if (pose) o.pose = pose;
  }
}

/** The Frame a step ends in, which the next step starts from. `at` is how far into the step it really got, for what is turning. */
export function settle(plan: StepPlan, at = Infinity): Frame {
  const frame = evaluate(plan, Infinity);
  if (!Number.isFinite(at) || at <= plan.duration || frame.motion.spins.length === 0) return frame;
  return withMotion(frame, at - plan.duration);
}

/**
 * The frame `seconds` later with the machine still running (a scene that has finished goes on turning). `from` is
 * the motion to run on from, when it is not the frame's own.
 */
export function withMotion(frame: Frame, seconds: number, from: Motion = frame.motion): Frame {
  if (from.spins.length === 0 || (seconds <= 0 && from === frame.motion)) return frame;
  const motion = advanceMotion(from, Math.max(0, seconds));
  const objects = frame.objects.map((o) => {
    const { pose: _gone, ...rest } = o;
    return rest as ObjectFrame;
  });
  applyPoses(objects, motion);
  applyPhases(objects, motion);
  return { ...frame, objects, diagrams: phasedDiagrams(frame.diagrams, motion), motion };
}

/** How far in and out the person may zoom the 3D panel: the scene language's own limits, so a wheel step never moves a scene's own zoom. */
export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 5;

/** The camera after a user change: az and el moved by degrees, zoom multiplied, el and zoom kept in range. */
export function movedCamera(camera: { az: number; el: number; zoom: number }, dAz: number, dEl: number, zoomBy = 1): { az: number; el: number; zoom: number } {
  return {
    az: camera.az + dAz,
    el: Math.max(-89, Math.min(89, camera.el + dEl)),
    zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, camera.zoom * zoomBy)),
  };
}

/**
 * Moves the camera by a user drag or zoom: every orbit and zoom in the step shifts with it, so later camera
 * actions start from where the camera is. `zoomBy` multiplies the zoom.
 */
export function shiftCamera(plan: StepPlan, dAz: number, dEl: number, zoomBy = 1): void {
  const shift = (tr: Track, f: (x: number | undefined) => number) => {
    tr.init = [f(tr.init[0])];
    for (const s of tr.segs) {
      s.from = [f(s.from[0])];
      s.to = [f(s.to[0])];
    }
  };
  shift(plan.az, (x) => (x ?? 0) + dAz);
  shift(plan.el, (x) => Math.max(-89, Math.min(89, (x ?? 0) + dEl)));
  if (zoomBy !== 1) shift(plan.zoom, (x) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, (x ?? 1) * zoomBy)));
}

/** Seconds a step's speech is assumed to take when no voice reports it. */
export function estimateSpeechSeconds(say: string): number {
  const words = say.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(0.8, words / WORDS_PER_SECOND);
}

/**
 * The Frame at `t` seconds into step `index` of a scene, earlier steps complete, starting from
 * `base` (the Frame before the scene). Used for frame grabs and by tests.
 */
/** `idle` adds the slow turn a finished scene does on the page, for frame grabs of a clip. */
export function frameAt(steps: readonly Step[], index: number, t: number, base: Frame = emptyFrame(), idle = false): Frame {
  let frame = base;
  const last = Math.min(index, steps.length - 1);
  for (let i = 0; i < last; i++) frame = settle(planStep(frame, steps[i] as Step));
  const step = steps[last];
  if (!step) return frame;
  const plan = planStep(frame, step);
  const at = evaluate(plan, t);
  // Past the end of the last step the model turns slowly by itself, as it does on the page.
  return idle && index >= steps.length - 1 ? withIdleTurn(at, t - plan.duration) : at;
}

/** After the last step the camera starts to turn slowly (so a still model does not look dead), after this long a pause. */
export const IDLE_DELAY_SECONDS = 1.5;
const IDLE_RAMP_SECONDS = 2.5;
const IDLE_DEGREES_PER_SECOND = 5;
/** The idle turn runs this long at most. */
export const IDLE_MAX_SECONDS = 40;

/** How far the idle turn has got (degrees) this long after the last step finished. */
export function idleAngle(secondsAfterEnd: number): number {
  const u = Math.min(IDLE_MAX_SECONDS, secondsAfterEnd) - IDLE_DELAY_SECONDS;
  if (u <= 0) return 0;
  return IDLE_DEGREES_PER_SECOND * (u < IDLE_RAMP_SECONDS ? (u * u) / (2 * IDLE_RAMP_SECONDS) : u - IDLE_RAMP_SECONDS / 2);
}

export function withIdleTurn(frame: Frame, secondsAfterEnd: number): Frame {
  const d = idleAngle(secondsAfterEnd);
  if (d === 0 || !frame.panel) return frame;
  return { ...frame, camera: { ...frame.camera, az: frame.camera.az + d } };
}
