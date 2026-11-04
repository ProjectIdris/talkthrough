// Flat diagrams in the timeline: the plan of what a step adds to them and the frame of them at a time. A diagram
// (flow, timeline, steps or chart) is one object with pieces (nodes, edges, series, dots) drawn in it; each has a birth
// time, a death time, and, once styled, ticked or highlighted, a few changes in time. No DOM and no three.js here (and
// nothing from timeline.ts, which calls this), so the same code serves playback, frame grabs and tests.
// Where a piece goes inside its diagram is decided at draw time (diagram-layout.ts) from all the pieces the diagram holds.

import type { DiagramAction, DiagramPiece, DiagramThing, TickAction } from '../scene/types.ts';

const NEVER = -Infinity;
/** Seconds a diagram or one of its pieces takes to come in, and to go. */
export const DIAGRAM_APPEAR_SECONDS = 0.45;
export const DIAGRAM_WIPE_SECONDS = 0.3;
/** Seconds a tick takes to be drawn. */
export const TICK_SECONDS = 0.3;
/** Seconds between pieces that arrive without a time of their own (a whole step played at once). */
export const PIECE_SPACING_SECONDS = 0.5;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const ease = (p: number): number => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const progress = (t: number, start: number, dur: number): number => (t < start ? 0 : dur > 0 ? Math.min(1, (t - start) / dur) : 1);

type Style = { at: number; color?: string; opacity?: number };
type Pulse = { start: number; dur: number; color?: string };
type Tick = { at: number; done: boolean };
type Inst = {
  key: number; id: string; /** The key of the diagram a piece is in. */ parentKey: number | null; def: DiagramThing;
  bornAt: number; diedAt: number | undefined;
  styles: Style[]; pulses: Pulse[]; ticks: Tick[];
};
export type DiagramPlan = { insts: Inst[] };

export type DiagramItemFrame = {
  key: number; id: string; def: DiagramPiece; color: string | undefined; opacity: number;
  /** 0 not yet there, 1 whole; a piece that is not there yet still counts toward the layout. */
  appear: number; fade: number; pulse: number; pulseColor: string | undefined;
  /** 0 not ticked, 1 ticked (between, while the tick is drawn). */
  done: number;
};
export type DiagramFrame = {
  key: number; id: string; def: DiagramAction; color: string | undefined; opacity: number;
  appear: number; fade: number; pulse: number; pulseColor: string | undefined;
  /** What the diagram holds, in the order it was made. */
  items: DiagramItemFrame[];
};

export const emptyDiagramPlan = (): DiagramPlan => ({ insts: [] });

/** The plan of a step starts from the diagrams the last step ended with, all of them already there. */
export function diagramPlanFrom(base: readonly DiagramFrame[]): DiagramPlan {
  const insts: Inst[] = [];
  for (const d of base) {
    insts.push({
      key: d.key, id: d.id, parentKey: null, def: d.def, bornAt: NEVER, diedAt: undefined,
      styles: [{ at: NEVER, ...(d.color !== undefined ? { color: d.color } : {}), opacity: d.opacity }], pulses: [], ticks: [],
    });
    for (const it of d.items) {
      insts.push({
        key: it.key, id: it.id, parentKey: d.key, def: it.def, bornAt: NEVER, diedAt: undefined,
        styles: [{ at: NEVER, ...(it.color !== undefined ? { color: it.color } : {}), opacity: it.opacity }], pulses: [],
        ticks: [{ at: NEVER, done: it.done >= 0.5 }],
      });
    }
  }
  return { insts };
}

const aliveAt = (i: Inst, t: number): boolean => i.bornAt <= t && (i.diedAt === undefined || i.diedAt > t);
const visibleAt = (i: Inst, t: number): boolean => i.diedAt === undefined || t < i.diedAt + DIAGRAM_WIPE_SECONDS;

function lookup(dp: DiagramPlan, id: string, at: number): Inst | undefined {
  for (let n = dp.insts.length - 1; n >= 0; n--) {
    const i = dp.insts[n];
    if (i && i.id === id && i.bornAt <= at && (i.diedAt === undefined || i.diedAt > at)) return i;
  }
  return undefined;
}

/** A piece's diagram: the one it was made for, or for an edge the diagram of the node it leaves. */
function diagramFor(dp: DiagramPlan, a: DiagramPiece, at: number): Inst | undefined {
  const id = a.op === 'edge' ? lookup(dp, a.from, at)?.parentKey : undefined;
  if (a.op === 'edge') return id === undefined || id === null ? undefined : dp.insts.find((i) => i.key === id && aliveAt(i, at));
  return lookup(dp, a.of, at);
}

/** Whether an action is part of the flat diagrams (a `tick` too, which names a node). */
export function isDiagramAction(a: { op: string }): a is DiagramThing | TickAction {
  return a.op === 'diagram' || a.op === 'node' || a.op === 'edge' || a.op === 'series' || a.op === 'dot' || a.op === 'tick';
}

/**
 * Puts a diagram action into the plan at `at` seconds. A diagram or piece written again under the id of one that is
 * already there takes its place (and its key, so what hangs from it stays). Returns how many seconds the action takes.
 */
export function applyDiagramAction(dp: DiagramPlan, a: DiagramThing | TickAction, at: number, alloc: () => number): number {
  if (a.op === 'tick') {
    const node = lookup(dp, a.id, at);
    if (!node) return 0;
    node.ticks.push({ at, done: a.done !== false });
    return TICK_SECONDS;
  }
  let parentKey: number | null = null;
  if (a.op !== 'diagram') {
    const home = diagramFor(dp, a, at);
    if (!home) return 0;
    parentKey = home.key;
  }
  const was = lookup(dp, a.id, at);
  if (was) dp.insts.splice(dp.insts.indexOf(was), 1);
  const color = a.color;
  dp.insts.push({
    key: was ? was.key : alloc(), id: a.id, parentKey, def: a, bornAt: at, diedAt: undefined,
    styles: color !== undefined ? [{ at, color }] : [], pulses: [], ticks: was && a.op === 'node' ? was.ticks : [],
  });
  return DIAGRAM_APPEAR_SECONDS;
}

/** `style` on a diagram or one of its pieces; false when the id is not one. Applies at once (a diagram is not tweened). */
export function styleDiagramThing(dp: DiagramPlan, id: string, at: number, color: string | undefined, opacity: number | undefined): boolean {
  const inst = lookup(dp, id, at);
  if (!inst) return false;
  const targets = inst.def.op === 'diagram' ? [inst, ...dp.insts.filter((i) => i.parentKey === inst.key && aliveAt(i, at))] : [inst];
  for (const t of targets) t.styles.push({ at, ...(color !== undefined ? { color } : {}), ...(opacity !== undefined ? { opacity } : {}) });
  return true;
}

/** `highlight` on a diagram or one of its pieces; false when the id is not one. */
export function pulseDiagramThing(dp: DiagramPlan, id: string, at: number, dur: number, color: string | undefined): boolean {
  const inst = lookup(dp, id, at);
  if (!inst) return false;
  inst.pulses.push({ start: at, dur: Math.max(0.2, dur), ...(color !== undefined ? { color } : {}) });
  return true;
}

/** `clear` of "all" or "marks" takes every diagram; an id takes that diagram (and its pieces) or that piece. Returns whether anything went. */
export function clearDiagrams(dp: DiagramPlan, target: string, at: number): boolean {
  let any = false;
  const kill = (i: Inst): void => {
    if (i.diedAt === undefined || i.diedAt > at) i.diedAt = at;
    any = true;
  };
  if (target === 'all' || target === 'marks') {
    for (const i of dp.insts) if (aliveAt(i, at)) kill(i);
    return any;
  }
  const inst = lookup(dp, target, at);
  if (!inst) return false;
  kill(inst);
  // What is in it goes with it; so does an edge that leaves a node (the validator drops it too, so it must not come back when the node is written again).
  for (const i of dp.insts) {
    if (!aliveAt(i, at)) continue;
    if (i.parentKey === inst.key || (i.def.op === 'edge' && i.def.from === inst.id)) kill(i);
  }
  return any;
}

/** The latest style that has begun by `t`: its colour and opacity (an earlier colour holds when a later style gives none). */
function styleAt(i: Inst, t: number): { color: string | undefined; opacity: number } {
  let color: string | undefined;
  let opacity = 1;
  for (const s of i.styles) {
    if (s.at > t) continue;
    if (s.color !== undefined) color = s.color;
    if (s.opacity !== undefined) opacity = s.opacity;
  }
  return { color, opacity };
}

function pulseAt(i: Inst, t: number): { amount: number; color: string | undefined } {
  let amount = 0;
  let color: string | undefined;
  for (const p of i.pulses) {
    if (t < p.start || t >= p.start + p.dur) continue;
    const a = Math.sin(Math.PI * progress(t, p.start, p.dur));
    if (a >= amount) {
      amount = a;
      color = p.color;
    }
  }
  return { amount, color };
}

/** How ticked a node is at `t`: 1 once its tick is drawn, 0 when untouched or taken away. */
function tickAt(i: Inst, t: number): number {
  let last: Tick | undefined;
  for (const k of i.ticks) if (k.at <= t && (!last || k.at >= last.at)) last = k;
  if (!last) return 0;
  const p = last.at === NEVER ? 1 : ease(progress(t, last.at, TICK_SECONDS));
  return last.done ? p : 1 - p;
}

/** The diagrams at authored time `t` seconds into the step (Infinity settles it). */
export function evaluateDiagrams(dp: DiagramPlan, t: number): DiagramFrame[] {
  const out: DiagramFrame[] = [];
  for (const d of dp.insts) {
    if (d.def.op !== 'diagram' || d.bornAt > t || !visibleAt(d, t)) continue;
    const ds = styleAt(d, t);
    const dpulse = pulseAt(d, t);
    const dappear = ease(progress(t, d.bornAt, DIAGRAM_APPEAR_SECONDS));
    const dfade = d.diedAt === undefined ? 1 : 1 - progress(t, d.diedAt, DIAGRAM_WIPE_SECONDS);
    const items: DiagramItemFrame[] = [];
    for (const it of dp.insts) {
      if (it.parentKey !== d.key || it.def.op === 'diagram' || !visibleAt(it, t)) continue;
      // A piece that is not born yet is kept (so the layout is steady while a diagram builds), at appear 0.
      const s = styleAt(it, t);
      const p = pulseAt(it, t);
      items.push({
        key: it.key, id: it.id, def: it.def as DiagramPiece, color: s.color, opacity: s.opacity,
        appear: it.bornAt > t ? 0 : ease(progress(t, it.bornAt, DIAGRAM_APPEAR_SECONDS)),
        fade: it.diedAt === undefined ? 1 : 1 - progress(t, it.diedAt, DIAGRAM_WIPE_SECONDS),
        pulse: p.amount, pulseColor: p.color, done: tickAt(it, t),
      });
    }
    out.push({
      key: d.key, id: d.id, def: d.def, color: ds.color, opacity: ds.opacity,
      appear: dappear, fade: clamp01(dfade), pulse: dpulse.amount, pulseColor: dpulse.color, items,
    });
  }
  return out;
}

/**
 * When each diagram action of a step is drawn, by its place in the list. One with a time of its own keeps it; one without
 * (a whole step played at once) comes after the one before, a diagram at once and its pieces one after another. A piece
 * never comes before the diagram, or the nodes, it is in or joins, however it was timed. (A streamed action is already
 * timed by when it arrived.)
 */
export function diagramTimes(actions: readonly { op: string; at?: number }[]): Map<number, number> {
  const out = new Map<number, number>();
  const when = new Map<string, number>();
  let k = 0;
  actions.forEach((a, i) => {
    if (!isDiagramAction(a)) return;
    const x = a as DiagramThing | TickAction;
    let at = x.at !== undefined ? Math.max(0, x.at) : x.op === 'diagram' ? 0 : Math.min(14, 0.3 + k++ * PIECE_SPACING_SECONDS);
    const needs = x.op === 'edge' ? [x.from, x.to] : x.op === 'tick' ? [x.id] : x.op === 'diagram' ? [] : [x.of];
    for (const id of needs) {
      const w = when.get(id);
      if (w !== undefined && w > at) at = w;
    }
    if (x.op !== 'tick') when.set(x.id, at);
    out.set(i, at);
  });
  return out;
}
