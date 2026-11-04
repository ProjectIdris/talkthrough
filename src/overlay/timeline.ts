// The overlay's clock-free core: turns a step of the scene language into a plan, and a plan plus a
// time into a Frame, the complete state to draw at that moment. No DOM and no three.js here, so
// the same code serves real-time playback, frame grabs (seek) and tests.
//
// Time is authored seconds from the start of a step. A step's plan begins from the Frame the
// previous step settled in (evaluate at Infinity), so ids, positions and the camera carry over,
// including across follow-up questions.

import type { Action, Mark, Step, Vec3 } from '../scene/types.ts';

export type Rgb = [number, number, number];
export type Rect = { x: number; y: number; w: number; h: number };

export const APPEAR_SECONDS = 0.4;
export const FADE_OUT_SECONDS = 0.3;
export const DEFAULT_DUR = 0.6;
export const DEFAULT_PANEL: Rect = { x: 640, y: 140, w: 340, h: 420 };
export const DEFAULT_CAMERA = { az: 0, el: 15, zoom: 1 } as const;
/** How fast the samples' speech is assumed to run, for timing without a voice. */
export const WORDS_PER_SECOND = 2.5;

const PALETTE_RGB: Record<string, Rgb> = {
  red: [255, 59, 71], orange: [255, 159, 26], yellow: [255, 214, 10], green: [46, 213, 115],
  teal: [25, 199, 184], blue: [59, 130, 246], purple: [168, 85, 247], pink: [255, 107, 181],
  white: [255, 255, 255], gray: [154, 164, 178], black: [17, 21, 28],
};

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
};

export type ObjectFrame = {
  key: number; id: string; parentKey: number | null;
  shape: string; size: Vec3; pts: Vec3[] | undefined; text: string | undefined; height: number | undefined;
  pos: Vec3; rot: Vec3; scale: Vec3; color: Rgb; opacity: number;
  appear: number; fade: number; pulse: number; pulseColor: Rgb | undefined;
};

export type Frame = {
  panel: { rect: Rect; appear: number; fade: number } | null;
  marks: MarkFrame[];
  /** Parents come before their children. */
  objects: ObjectFrame[];
  camera: { az: number; el: number; zoom: number; focus: FocusFrame };
  nextKey: number;
};

export function emptyFrame(): Frame {
  return {
    panel: null, marks: [], objects: [], nextKey: 1,
    camera: { ...DEFAULT_CAMERA, focus: { key: null, k: 1 } },
  };
}

// ---- Tracks: a property over time -----------------------------------------------------------

type Seg = { start: number; dur: number; from: number[]; to: number[] };
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

function valueAt(tr: Track, t: number): number[] {
  let seg: Seg | undefined;
  for (const s of tr.segs) {
    if (s.start <= t) seg = s;
    else break;
  }
  if (!seg) return [...tr.init];
  const p = ease(progress(t, seg.start, seg.dur));
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

type MarkInst = Life & { key: number; id: string; mark: Mark; color: Track; opacity: Track };
type ObjInst = Life & {
  key: number; id: string; parentKey: number | null; shape: string; size: Vec3;
  pts: Vec3[] | undefined; text: string | undefined; height: number | undefined;
  pos: Track; rot: Track; scale: Track; color: Track; opacity: Track;
};
type PanelInst = Life & { rect: Track };
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
      color: track(m.color), opacity: track([m.opacity]),
    });
  }
  for (const o of base.objects) {
    plan.objs.push({
      key: o.key, id: o.id, parentKey: o.parentKey, shape: o.shape, size: o.size, pts: o.pts, text: o.text,
      height: o.height, bornAt: NEVER, diedAt: undefined,
      pos: track(o.pos), rot: track(o.rot), scale: track(o.scale), color: track(o.color), opacity: track([o.opacity]),
    });
  }
  if (base.panel) {
    const r = base.panel.rect;
    plan.panels.push({ bornAt: NEVER, diedAt: undefined, rect: track([r.x, r.y, r.w, r.h]) });
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
  plan.panels.push({ bornAt: at, diedAt: undefined, rect: track([r.x, r.y, r.w, r.h]) });
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
    case 'box': case 'circle': case 'underline': case 'arrow': case 'label': {
      plan.marks.push({
        key: plan.nextKey++, id: a.id, mark: a, bornAt: at, diedAt: undefined,
        color: track(parseColor(a.color)), opacity: track([1]),
      });
      end(APPEAR_SECONDS);
      return;
    }
    case 'panel': {
      const p = alivePanel(plan, at);
      const target = [a.x, a.y, a.w, a.h];
      if (!p) {
        plan.panels.push({ bornAt: at, diedAt: undefined, rect: track(target) });
        end(APPEAR_SECONDS);
      } else {
        tweenTo(p.rect, at, dur, target);
        end(dur);
      }
      return;
    }
    case 'add': {
      ensurePanel(plan, at);
      const parent = a.parent !== undefined ? lookup(plan.objs, a.parent, at) : undefined;
      const isSolid = a.shape !== 'line' && a.shape !== 'arrow' && a.shape !== 'text' && a.shape !== 'group';
      plan.objs.push({
        key: plan.nextKey++, id: a.id, parentKey: parent ? parent.key : null, shape: a.shape,
        size: isSolid ? v3((a as { size: Vec3 }).size, [1, 1, 1]) : [1, 1, 1],
        pts: a.shape === 'line' || a.shape === 'arrow' ? (a as { pts: Vec3[] }).pts.map((p) => v3(p, [0, 0, 0])) : undefined,
        text: a.shape === 'text' ? (a as { text: string }).text : undefined,
        height: a.shape === 'text' ? (a as { height: number }).height : undefined,
        bornAt: at, diedAt: undefined,
        pos: track('pos' in a && a.pos ? a.pos : [0, 0, 0]),
        rot: track('rot' in a && a.rot ? a.rot : [0, 0, 0]),
        scale: track([1, 1, 1]),
        color: track(parseColor('color' in a ? a.color : undefined)),
        opacity: track([('opacity' in a && a.opacity !== undefined) ? a.opacity : 1]),
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
    case 'style': {
      const target = lookup(plan.objs, a.id, at) ?? lookup(plan.marks, a.id, at);
      if (!target) return;
      if (a.color !== undefined) tweenTo(target.color, at, dur, parseColor(a.color));
      if (a.opacity !== undefined) tweenTo(target.opacity, at, dur, [a.opacity]);
      end(dur);
      return;
    }
    case 'highlight': {
      const target = lookup(plan.objs, a.id, at) ?? lookup(plan.marks, a.id, at);
      if (!target) return;
      plan.pulses.push({ key: target.key, start: at, dur: Math.max(0.2, dur), color: a.color !== undefined ? parseColor(a.color) : undefined });
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
  for (const m of plan.marks) {
    if (!visibleAt(m, t)) continue;
    const pulse = pulseFor(plan, m.key, t);
    marks.push({
      key: m.key, id: m.id, mark: m.mark, color: asRgb(valueAt(m.color, t)), opacity: valueAt(m.opacity, t)[0] ?? 1,
      appear: appearOf(m, t), fade: fadeOf(m, t), pulse: pulse.amount, pulseColor: pulse.color,
    });
  }
  const objects: ObjectFrame[] = [];
  for (const o of plan.objs) {
    if (!visibleAt(o, t)) continue;
    const pulse = pulseFor(plan, o.key, t);
    objects.push({
      key: o.key, id: o.id, parentKey: o.parentKey, shape: o.shape, size: o.size, pts: o.pts, text: o.text, height: o.height,
      pos: asVec(valueAt(o.pos, t)), rot: asVec(valueAt(o.rot, t)), scale: asVec(valueAt(o.scale, t)),
      color: asRgb(valueAt(o.color, t)), opacity: valueAt(o.opacity, t)[0] ?? 1,
      appear: appearOf(o, t), fade: fadeOf(o, t), pulse: pulse.amount, pulseColor: pulse.color,
    });
  }
  let panel: Frame['panel'] = null;
  for (const p of plan.panels) {
    if (!visibleAt(p, t)) continue;
    const r = valueAt(p.rect, t);
    panel = { rect: { x: r[0] ?? 0, y: r[1] ?? 0, w: r[2] ?? 0, h: r[3] ?? 0 }, appear: appearOf(p, t), fade: fadeOf(p, t) };
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

/** Moves the camera by a user drag: every orbit in the step shifts with it, so later camera actions start from where the camera is. */
export function shiftCamera(plan: StepPlan, dAz: number, dEl: number): void {
  const shift = (tr: Track, d: number, lo: number, hi: number) => {
    const f = (x: number | undefined) => Math.max(lo, Math.min(hi, (x ?? 0) + d));
    tr.init = [f(tr.init[0])];
    for (const s of tr.segs) {
      s.from = [f(s.from[0])];
      s.to = [f(s.to[0])];
    }
  };
  shift(plan.az, dAz, -Infinity, Infinity);
  shift(plan.el, dEl, -89, 89);
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
export function frameAt(steps: readonly Step[], index: number, t: number, base: Frame = emptyFrame()): Frame {
  let frame = base;
  const last = Math.min(index, steps.length - 1);
  for (let i = 0; i < last; i++) frame = settle(planStep(frame, steps[i] as Step));
  const step = steps[last];
  if (!step) return frame;
  return evaluate(planStep(frame, step), t);
}
