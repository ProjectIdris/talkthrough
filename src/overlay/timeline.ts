// The overlay's clock-free core: turns a step of the scene language into a plan, and a plan plus a
// time into a Frame, the complete state to draw at that moment. No DOM and no three.js here, so
// the same code serves real-time playback, frame grabs (seek) and tests.
//
// Time is authored seconds from the start of a step. A step's plan begins from the Frame the
// previous step settled in (evaluate at Infinity), so ids, positions and the camera carry over,
// including across follow-up questions.

import { PALETTE_RGB } from '../scene/colors.ts';
import type { Rgb } from '../scene/colors.ts';
import type { Action, AddAction, Mark, Step, Vec3 } from '../scene/types.ts';

export type { Rgb };
export type Rect = { x: number; y: number; w: number; h: number };

export const APPEAR_SECONDS = 0.4;
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
    }
  }
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
  /** How far apart its parts are pushed: 0 assembled; its children sit at pos * (1 + spread). */
  spread: number;
};

export type Frame = {
  panel: { rect: Rect; appear: number; fade: number; frame: boolean } | null;
  marks: MarkFrame[];
  /** Parents come before their children. */
  objects: ObjectFrame[];
  camera: { az: number; el: number; zoom: number; focus: FocusFrame };
  nextKey: number;
  /** The person's Explode control, 0 closed to 1 open, when they have used it (see explode.ts). */
  userExplode?: number;
};

export function emptyFrame(): Frame {
  return {
    panel: null, marks: [], objects: [], nextKey: 1,
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

type Life = { bornAt: number; diedAt: number | undefined };

type MarkInst = Life & { key: number; id: string; mark: Mark; color: Track; opacity: Track; tinted: boolean; onKey?: number };
type ObjInst = Life & {
  key: number; id: string; parentKey: number | null; def: AddAction;
  pos: Track; rot: Track; scale: Track; color: Track; opacity: Track; draw: Track; spread: Track;
};
type PanelInst = Life & { rect: Track; frame: boolean };
type Pulse = { key: number; start: number; dur: number; color: Rgb | undefined };

export type StepPlan = {
  marks: MarkInst[];
  objs: ObjInst[];
  panels: PanelInst[];
  az: Track; el: Track; zoom: Track; focus: FocusTrack;
  pulses: Pulse[];
  nextKey: number;
  /** Authored seconds until the last action has finished. */
  duration: number;
};

const NEVER = -Infinity;

function aliveAt(l: Life, t: number): boolean {
  return l.bornAt <= t && (l.diedAt === undefined || l.diedAt > t);
}

function appearOf(l: Life, t: number): number {
  return ease(progress(t, l.bornAt, APPEAR_SECONDS));
}

function fadeOf(l: Life, t: number): number {
  return l.diedAt === undefined ? 1 : 1 - progress(t, l.diedAt, FADE_OUT_SECONDS);
}

function visibleAt(l: Life, t: number): boolean {
  return l.bornAt <= t && (l.diedAt === undefined || t < l.diedAt + FADE_OUT_SECONDS);
}

// ---- Planning -------------------------------------------------------------------------------

/** Builds the plan of a step from the Frame the previous step settled in. */
export function planStep(base: Frame, step: Step): StepPlan {
  const plan: StepPlan = {
    marks: [], objs: [], panels: [],
    az: track([base.camera.az]), el: track([base.camera.el]), zoom: track([base.camera.zoom]),
    focus: { init: base.camera.focus.key, segs: [] },
    pulses: [], nextKey: base.nextKey, duration: 0,
  };
  for (const m of base.marks) {
    plan.marks.push({
      key: m.key, id: m.id, mark: m.mark, bornAt: NEVER, diedAt: undefined,
      color: track(m.color), opacity: track([m.opacity]), tinted: m.tinted, ...(m.onKey !== undefined ? { onKey: m.onKey } : {}),
    });
  }
  for (const o of base.objects) {
    plan.objs.push({
      key: o.key, id: o.id, parentKey: o.parentKey, def: o.def, bornAt: NEVER, diedAt: undefined,
      pos: track(o.pos), rot: track(o.rot), scale: track(o.scale), color: track(o.color), opacity: track([o.opacity]),
      draw: track([o.draw]), spread: track([o.spread]),
    });
  }
  if (base.panel) {
    const r = base.panel.rect;
    plan.panels.push({ bornAt: NEVER, diedAt: undefined, rect: track([r.x, r.y, r.w, r.h]), frame: base.panel.frame });
  }

  const events = step.actions.map((a, i) => ({ a, i, at: Math.max(0, a.at ?? 0) }));
  events.sort((p, q) => p.at - q.at || p.i - q.i);
  for (const { a, at } of events) applyAction(plan, a, at);
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
  plan.duration = Math.max(plan.duration, at + FADE_OUT_SECONDS);
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

function applyAction(plan: StepPlan, a: Action, at: number): void {
  const dur = 'dur' in a && a.dur !== undefined ? a.dur : DEFAULT_DUR;
  const end = (len: number) => { plan.duration = Math.max(plan.duration, at + len); };
  switch (a.op) {
    case 'box': case 'circle': case 'underline': case 'arrow': case 'label': case 'card': case 'image': case 'pin': {
      const color = 'color' in a ? a.color : undefined;
      let onKey: number | undefined;
      if (a.op === 'pin') {
        const host = lookup(plan.objs, a.on, at);
        if (!host) return;
        onKey = host.key;
      }
      plan.marks.push({
        key: plan.nextKey++, id: a.id, mark: a, bornAt: at, diedAt: undefined,
        color: track(parseColor(color)), opacity: track([1]), tinted: color !== undefined,
        ...(onKey !== undefined ? { onKey } : {}),
      });
      end(APPEAR_SECONDS);
      return;
    }
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
      ensurePanel(plan, at);
      if (a.shape === 'array') {
        addArray(plan, a, at);
        end(APPEAR_SECONDS);
        return;
      }
      const parent = 'parent' in a && a.parent !== undefined ? lookup(plan.objs, a.parent, at) : undefined;
      const given = (a as { color?: string }).color;
      plan.objs.push({
        key: plan.nextKey++, id: a.id, parentKey: parent ? parent.key : null, def: a,
        bornAt: at, diedAt: undefined,
        pos: track('pos' in a && a.pos ? a.pos : [0, 0, 0]),
        rot: track('rot' in a && a.rot ? a.rot : [0, 0, 0]),
        scale: track([1, 1, 1]),
        color: track(given !== undefined ? parseColor(given) : defaultColor(a)),
        opacity: track([('opacity' in a && a.opacity !== undefined) ? a.opacity : 1]),
        draw: track([('draw' in a && a.draw !== undefined) ? a.draw : 1]), spread: track([0]),
      });
      end(APPEAR_SECONDS);
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
      end(dur);
      return;
    }
    case 'style': {
      const target = lookup(plan.objs, a.id, at);
      const mark = target ? undefined : lookup(plan.marks, a.id, at);
      if (!target && !mark) return;
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
      if (!target && !mark) return;
      const hit: Array<ObjInst | MarkInst> = target ? [target, ...descendants(plan, target.key, at)] : [mark as MarkInst];
      for (const h of hit) plan.pulses.push({ key: h.key, start: at, dur: Math.max(0.2, dur), color: a.color !== undefined ? parseColor(a.color) : undefined });
      end(Math.max(0.2, dur));
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
  }
}

/** Makes the copies of an array: the original joins a new group, and each further copy sits in a pivot that carries the step and turn. */
function addArray(plan: StepPlan, a: Extract<AddAction, { shape: 'array' }>, at: number): void {
  const of = lookup(plan.objs, a.of, at);
  if (!of) return;
  const group: ObjInst = {
    key: plan.nextKey++, id: a.id, parentKey: of.parentKey, def: { op: 'add', shape: 'group', id: a.id } as AddAction,
    bornAt: of.bornAt, diedAt: undefined,
    pos: track([0, 0, 0]), rot: track([0, 0, 0]), scale: track([1, 1, 1]), color: track([255, 255, 255]), opacity: track([1]),
    draw: track([1]), spread: track([0]),
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
  const objects: ObjectFrame[] = [];
  for (const o of plan.objs) {
    if (!visibleAt(o, t)) continue;
    const pulse = pulseFor(plan, o.key, t);
    objects.push({
      key: o.key, id: o.id, parentKey: o.parentKey, def: o.def, shape: o.def.shape,
      pos: asVec(valueAt(o.pos, t)), rot: asVec(valueAt(o.rot, t)), scale: asVec(valueAt(o.scale, t)),
      color: asRgb(valueAt(o.color, t)), opacity: valueAt(o.opacity, t)[0] ?? 1,
      appear: appearOf(o, t), fade: fadeOf(o, t), pulse: pulse.amount, pulseColor: pulse.color,
      draw: valueAt(o.draw, t)[0] ?? 1, spread: valueAt(o.spread, t)[0] ?? 0,
    });
  }
  let panel: Frame['panel'] = null;
  for (const p of plan.panels) {
    if (!visibleAt(p, t)) continue;
    const r = valueAt(p.rect, t);
    panel = { rect: { x: r[0] ?? 0, y: r[1] ?? 0, w: r[2] ?? 0, h: r[3] ?? 0 }, appear: appearOf(p, t), fade: fadeOf(p, t), frame: p.frame };
  }
  return {
    panel, marks, objects, nextKey: plan.nextKey,
    camera: {
      az: valueAt(plan.az, t)[0] ?? 0, el: valueAt(plan.el, t)[0] ?? 0, zoom: valueAt(plan.zoom, t)[0] ?? 1,
      focus: focusAt(plan.focus, t),
    },
  };
}

/** The Frame a step ends in, which the next step starts from. */
export function settle(plan: StepPlan): Frame {
  return evaluate(plan, Infinity);
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
