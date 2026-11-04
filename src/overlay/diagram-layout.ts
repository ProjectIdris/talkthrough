// Where the pieces of a flat diagram go inside its rectangle, in pixels. Pure functions of the pieces and the size, so the
// same pieces always lay out the same way and the layout is tested without a canvas. The drawing is diagram-draw.ts.

export type Px = { x: number; y: number; w: number; h: number };
export type Pt = { x: number; y: number };

// ---- Flow ----------------------------------------------------------------------------------------

export type FlowEdge = { id: string; from: string; to: string; /** The width of its label (pixels), when it has one. */ labelW?: number };
/** A node's box, the layer it is in and, when a long chain is wrapped into rows, its row and whether that row runs right to left. */
export type FlowBox = Px & { layer: number; row?: number; rev?: boolean };

export type FlowLayout = {
  /** Layers run left to right ("right") or top to bottom ("down"), chosen from the shape of the area and the graph. */
  dir: 'right' | 'down';
  layers: number;
  /** Rows a long chain of single nodes is wrapped into (1 when it is not): each row runs the opposite way to the one above it. */
  rows: number;
  nodes: Map<string, FlowBox>;
  /** A cubic curve for each edge (an edge between unknown nodes is left out). */
  edges: Map<string, Route>;
};

/** The layer of each node: the longest way from a node nothing points at, over the edges that do not close a loop. */
export function flowLayers(ids: readonly string[], edges: readonly FlowEdge[]): Map<string, number> {
  const index = new Map(ids.map((id, i) => [id, i]));
  const out = new Map<string, string[]>();
  for (const e of edges) {
    if (!index.has(e.from) || !index.has(e.to) || e.from === e.to) continue;
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e.to);
  }
  // Depth-first, in the order the nodes were written: an edge to a node still being visited closes a loop and is left out.
  const state = new Map<string, 0 | 1 | 2>();
  const forward: Array<[string, string]> = [];
  const visit = (v: string): void => {
    state.set(v, 1);
    for (const w of out.get(v) ?? []) {
      const s = state.get(w) ?? 0;
      if (s === 1) continue;
      forward.push([v, w]);
      if (s === 0) visit(w);
    }
    state.set(v, 2);
  };
  for (const id of ids) if (!state.has(id)) visit(id);
  const layer = new Map(ids.map((id) => [id, 0]));
  // Relax over the forward edges (they form no loop, so this settles in at most n passes).
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false;
    for (const [v, w] of forward) {
      const want = (layer.get(v) ?? 0) + 1;
      if (want > (layer.get(w) ?? 0)) {
        layer.set(w, want);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return layer;
}

export type FlowOptions = {
  maxBox: { w: number; h: number };
  /** Gap kept round the drawing. */
  pad: number;
  /** The widest and the tallest edge label (pixels), so the gaps between nodes leave room for them. */
  labelW?: number;
  labelH?: number;
  /** Some node has a note under its text: in a column the boxes then take more of their cell (less gap), so the note has room. */
  notes?: boolean;
};

/**
 * The nodes and edges of a flow inside an area. A loop back swings out past the nodes (to the right of a column that runs down,
 * under a row that runs right) with its label on the swing; when that would leave the area the nodes are laid out again in the
 * room that is left, so the curve and its label stay inside the card.
 */
export function flowLayout(ids: readonly string[], edges: readonly FlowEdge[], area: Px, options: FlowOptions): FlowLayout {
  let lay = flowLayoutIn(ids, edges, area, options);
  let room = area;
  for (let pass = 0; pass < 2; pass++) {
    const over = loopOvershoot(lay, edges, area, options);
    if (over <= 0.5) break;
    room = lay.dir === 'down' ? { ...room, w: Math.max(40, room.w - over) } : { ...room, h: Math.max(30, room.h - over) };
    lay = flowLayoutIn(ids, edges, room, options);
  }
  return lay;
}

/** How far the loop-back curves and their labels run past the area (pixels), on the side they swing out to. */
function loopOvershoot(lay: FlowLayout, edges: readonly FlowEdge[], area: Px, options: FlowOptions): number {
  const lh = options.labelH ?? 0;
  const limitX = area.x + area.w - 3, limitY = area.y + area.h - 3;
  let over = 0;
  for (const e of edges) {
    const r = lay.edges.get(e.id), s = r && lay.nodes.get(e.from), u = r && lay.nodes.get(e.to);
    if (!r || !s || !u || s.layer < u.layer) continue;
    const lw = e.labelW ?? 0;
    for (const p of bezierPoints(r.a, r.b, r.c, r.d)) over = Math.max(over, lay.dir === 'down' ? p.x - limitX : p.y - limitY);
    if (lw > 0) over = Math.max(over, lay.dir === 'down' ? r.mid.x + lw / 2 + 6 - limitX : r.mid.y + lh / 2 - limitY);
  }
  return over;
}

function flowLayoutIn(ids: readonly string[], edges: readonly FlowEdge[], area: Px, options: FlowOptions): FlowLayout {
  const empty: FlowLayout = { dir: 'right', layers: 0, rows: 1, nodes: new Map(), edges: new Map() };
  if (ids.length === 0) return empty;
  const known = new Set(ids);
  const used = edges.filter((e) => known.has(e.from) && known.has(e.to) && e.from !== e.to);
  const layer = flowLayers(ids, used);
  // Nodes nothing joins yet (an answer still arriving) stand one after another, so the picture grows along its row.
  const touched = new Set(used.flatMap((e) => [e.from, e.to]));
  let next = used.length === 0 ? 0 : Math.max(...[...touched].map((id) => layer.get(id) ?? 0)) + 1;
  for (const id of ids) if (!touched.has(id)) layer.set(id, next++);
  const count = Math.max(...layer.values()) + 1;
  const columns: string[][] = Array.from({ length: count }, () => []);
  for (const id of ids) columns[layer.get(id) ?? 0]!.push(id);
  // Within a layer, nodes sit near the average place of what they join (two sweeps), keeping the written order otherwise.
  const rank = new Map<string, number>();
  columns.forEach((c) => c.forEach((id, i) => rank.set(id, i)));
  const neighbours = (id: string, towards: -1 | 1): string[] =>
    used.flatMap((e) => (towards === -1 ? (e.to === id ? [e.from] : []) : e.from === id ? [e.to] : [])).filter((n) => (layer.get(n) ?? 0) === (layer.get(id) ?? 0) + towards);
  for (let sweep = 0; sweep < 2; sweep++) {
    const order = sweep === 0 ? columns.map((_, i) => i) : columns.map((_, i) => columns.length - 1 - i);
    for (const li of order) {
      const col = columns[li]!;
      const key = (id: string): number => {
        const ns = neighbours(id, sweep === 0 ? -1 : 1);
        return ns.length === 0 ? rank.get(id) ?? 0 : ns.reduce((s, n) => s + (rank.get(n) ?? 0), 0) / ns.length;
      };
      const keyed = col.map((id, i) => ({ id, k: key(id), i })).sort((p, q) => p.k - q.k || p.i - q.i);
      keyed.forEach((e, i) => rank.set(e.id, i));
      columns[li] = keyed.map((e) => e.id);
    }
  }
  const widest = Math.max(...columns.map((c) => c.length));
  const inner: Px = { x: area.x + options.pad, y: area.y + options.pad, w: Math.max(1, area.w - 2 * options.pad), h: Math.max(1, area.h - 2 * options.pad) };
  const lw = options.labelW ?? 0, lh = options.labelH ?? 0;
  // A node box for a layer cell and a cross slot: as large as they allow (leaving a gap for an edge label), within the largest asked for.
  const boxFor = (dir: 'right' | 'down', cell: number, slot: number): { w: number; h: number } =>
    dir === 'right'
      ? { w: Math.min(options.maxBox.w, lw > 0 ? cell - Math.max(lw + 18, cell * 0.3) : cell * 0.66), h: Math.min(options.maxBox.h, slot * 0.7) }
      : { w: Math.min(options.maxBox.w, slot * 0.9), h: Math.min(options.maxBox.h, lh > 0 ? cell - Math.max(lh + 12, cell * 0.3) : cell * (options.notes ? 0.78 : 0.6)) };
  // Which way to run: the one that leaves the nodes larger (a node is about 2.4 times as wide as tall). A chain of single nodes
  // may also be wrapped into two or three rows (each running back the way the last came, so the arrow between rows is short);
  // that is chosen only when it makes the nodes clearly larger, so a long chain in a small card does not shrink its text to nothing.
  const fit = (dir: 'right' | 'down', rows = 1): number => {
    const perRow = Math.ceil(count / rows);
    const box = dir === 'right' ? boxFor('right', inner.w / perRow, inner.h / rows / widest) : boxFor('down', inner.h / count, inner.w / widest);
    return Math.max(0, Math.min(box.w / 2.4, box.h));
  };
  const right = fit('right'), down = fit('down');
  const dir: 'right' | 'down' = right > down * 1.001 || (Math.abs(right - down) <= down * 0.001 && inner.w >= inner.h) ? 'right' : 'down';
  let rows = 1;
  // A loop back (an edge that goes to a layer no later than its own) runs round the outside of one row: a wrapped chain has no room for it.
  const loops = used.some((e) => (layer.get(e.to) ?? 0) <= (layer.get(e.from) ?? 0));
  if (widest === 1 && count >= 4 && dir === 'right' && !loops) {
    let best = fit('right', 1);
    for (const r of [2, 3]) {
      if (Math.ceil(count / r) < 2) break;
      const f = fit('right', r);
      if (f > best * 1.15) { best = f; rows = r; }
    }
  }
  const wrapped = rows > 1;
  const dirOut: 'right' | 'down' = wrapped ? 'right' : dir;
  const along = dirOut === 'right' ? inner.w : inner.h, across = dirOut === 'right' ? inner.h : inner.w;
  const perRow = wrapped ? Math.ceil(count / rows) : count;
  const cell = along / perRow;
  const nodes = new Map<string, FlowBox>();
  columns.forEach((col, li) => {
    const row = wrapped ? Math.floor(li / perRow) : 0;
    const rev = wrapped && row % 2 === 1;
    const slotLen = wrapped ? across / rows : across;
    const slot = slotLen / col.length;
    const place = wrapped ? (rev ? perRow - 1 - (li % perRow) : li % perRow) : li;
    col.forEach((id, j) => {
      const a = (place + 0.5) * cell, c = (wrapped ? row * slotLen : 0) + (j + 0.5) * slot;
      const { w, h } = boxFor(dirOut, cell, slot);
      const cx = dirOut === 'right' ? inner.x + a : inner.x + c, cy = dirOut === 'right' ? inner.y + c : inner.y + a;
      nodes.set(id, { x: cx - w / 2, y: cy - h / 2, w, h, layer: li, ...(wrapped ? { row, rev } : {}) });
    });
  });
  const routes: FlowLayout['edges'] = new Map();
  for (const e of used) routes.set(e.id, routeEdge(dirOut, nodes.get(e.from)!, nodes.get(e.to)!));
  return { dir: dirOut, layers: count, rows, nodes, edges: routes };
}

export type Route = { a: Pt; b: Pt; c: Pt; d: Pt; mid: Pt };

/** The curve of an edge between two node rectangles: out of the side the layers run from, in at the side they run to; a back edge goes round the bottom (or right). */
export function routeEdge(dir: 'right' | 'down', s: FlowBox, t: FlowBox): Route {
  const forwardEdge = s.layer < t.layer;
  let a: Pt, d: Pt, c: Pt, b: Pt;
  if (dir === 'right' && forwardEdge && s.row !== undefined && t.row !== undefined && t.row !== s.row) {
    // Into the next row of a wrapped chain: straight down (the row turns round at its end).
    a = { x: s.x + s.w / 2, y: s.y + s.h };
    d = { x: t.x + t.w / 2, y: t.y };
    const k = Math.max(14, (d.y - a.y) * 0.45);
    b = { x: a.x, y: a.y + k };
    c = { x: d.x, y: d.y - k };
  } else if (dir === 'right' && forwardEdge && s.rev && s.row === t.row) {
    // Along a row that runs right to left.
    a = { x: s.x, y: s.y + s.h / 2 };
    d = { x: t.x + t.w, y: t.y + t.h / 2 };
    const k = Math.max(20, (a.x - d.x) * 0.45);
    b = { x: a.x - k, y: a.y };
    c = { x: d.x + k, y: d.y };
  } else if (dir === 'right') {
    if (forwardEdge) {
      a = { x: s.x + s.w, y: s.y + s.h / 2 };
      d = { x: t.x, y: t.y + t.h / 2 };
      const k = Math.max(20, (d.x - a.x) * 0.45);
      b = { x: a.x + k, y: a.y };
      c = { x: d.x - k, y: d.y };
    } else {
      a = { x: s.x + s.w / 2, y: s.y + s.h };
      d = { x: t.x + t.w / 2, y: t.y + t.h };
      const drop = Math.max(26, Math.min(70, Math.abs(d.x - a.x) * 0.3 + 26));
      b = { x: a.x, y: a.y + drop };
      c = { x: d.x, y: d.y + drop };
    }
  } else if (forwardEdge) {
    a = { x: s.x + s.w / 2, y: s.y + s.h };
    d = { x: t.x + t.w / 2, y: t.y };
    const k = Math.max(20, (d.y - a.y) * 0.45);
    b = { x: a.x, y: a.y + k };
    c = { x: d.x, y: d.y - k };
  } else {
    a = { x: s.x + s.w, y: s.y + s.h / 2 };
    d = { x: t.x + t.w, y: t.y + t.h / 2 };
    const out = Math.max(26, Math.min(70, Math.abs(d.y - a.y) * 0.3 + 26));
    b = { x: a.x + out, y: a.y };
    c = { x: d.x + out, y: d.y };
  }
  return { a, b, c, d, mid: bezierAt(a, b, c, d, 0.5) };
}

export function bezierAt(a: Pt, b: Pt, c: Pt, d: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
  };
}

/** A cubic curve as a polyline. */
export function bezierPoints(a: Pt, b: Pt, c: Pt, d: Pt, n = 28): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) out.push(bezierAt(a, b, c, d, i / n));
  return out;
}

// ---- Timeline ------------------------------------------------------------------------------------

export type TimelineEvent = { id: string; pos?: number };
export type TimelineSlot = {
  /** The dot on the axis. */
  dot: Pt;
  /** Where along the axis, 0 to 1. */
  f: number;
  /** The label box, and the side of the axis it is on (above or left is -1, below or right is 1). */
  rect: Px;
  side: -1 | 1;
};
export type TimelineLayout = {
  horizontal: boolean;
  axis: { a: Pt; b: Pt };
  events: Map<string, TimelineSlot>;
  /** True when the labels do not fit inside the area (the caller can make them smaller and try again). */
  overflow: boolean;
};

/** Where each event falls along the axis, 0 to 1: by its pos when all have one, else evenly in the order written. */
export function timelineFractions(events: readonly TimelineEvent[]): number[] {
  const n = events.length;
  if (n === 0) return [];
  if (n === 1) return [0.5];
  const all = events.every((e) => e.pos !== undefined && Number.isFinite(e.pos));
  const margin = 0.07;
  const even = (i: number): number => margin + ((1 - 2 * margin) * i) / (n - 1);
  if (!all) return events.map((_, i) => even(i));
  const lo = Math.min(...events.map((e) => e.pos!)), hi = Math.max(...events.map((e) => e.pos!));
  if (hi - lo <= 0) return events.map((_, i) => even(i));
  return events.map((e) => margin + ((1 - 2 * margin) * (e.pos! - lo)) / (hi - lo));
}

const overlapArea = (a: Px, b: Px, gap: number): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + gap;
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + gap;
  return w > 0 && h > 0 ? w * h : 0;
};

/**
 * The axis, the dots and a box for each label. `size` is how big each label wants to be. Labels alternate above and
 * below the axis (or sit to its right when the area is tall); one that would overlap another goes to the other side, or
 * one row further out, so nothing is written over anything else.
 */
export function timelineLayout(events: readonly TimelineEvent[], area: Px, pad: number, size: (id: string) => { w: number; h: number }): TimelineLayout {
  const inner: Px = { x: area.x + pad, y: area.y + pad, w: Math.max(1, area.w - 2 * pad), h: Math.max(1, area.h - 2 * pad) };
  const horizontal = inner.w >= inner.h * 0.9;
  const f = timelineFractions(events);
  const out: TimelineLayout['events'] = new Map();
  const stem = 14;
  if (horizontal) {
    const y = inner.y + inner.h * 0.5;
    const placed: Px[] = [];
    let unresolved = false;
    const rowH = Math.max(0, ...events.map((e) => size(e.id).h)) + 6;
    events.forEach((e, i) => {
      const dotX = inner.x + f[i]! * inner.w;
      const { w, h } = size(e.id);
      const x = Math.max(inner.x, Math.min(inner.x + inner.w - w, dotX - w / 2));
      let best: { rect: Px; side: -1 | 1; cost: number } | undefined;
      const prefer: -1 | 1 = i % 2 === 0 ? -1 : 1;
      for (let level = 0; level < 3 && !(best && best.cost === 0); level++) {
        for (const side of [prefer, -prefer] as Array<-1 | 1>) {
          const top = side === -1 ? y - stem - level * rowH - h : y + stem + level * rowH;
          const rect = { x, y: top, w, h };
          const outside = Math.max(0, inner.y - rect.y) + Math.max(0, rect.y + rect.h - (inner.y + inner.h));
          const cost = placed.reduce((c, p) => c + overlapArea(rect, p, 6), 0) + outside * 40 + level * 2;
          if (!best || cost < best.cost) best = { rect, side, cost };
          if (cost === 0) break;
        }
      }
      if (best!.cost - (best!.side === prefer ? 0 : 0) >= 1 && placed.some((p) => overlapArea(best!.rect, p, 6) > 0)) unresolved = true;
      placed.push(best!.rect);
      out.set(e.id, { dot: { x: dotX, y }, f: f[i]!, rect: best!.rect, side: best!.side });
    });
    // The group of axis and labels sits in the middle of the area, whichever side the labels went.
    const top = Math.min(y, ...placed.map((p) => p.y)), bottom = Math.max(y, ...placed.map((p) => p.y + p.h));
    const shift = inner.y + inner.h / 2 - (top + bottom) / 2;
    for (const slot of out.values()) {
      slot.dot = { x: slot.dot.x, y: slot.dot.y + shift };
      slot.rect = { ...slot.rect, y: slot.rect.y + shift };
    }
    return { horizontal, axis: { a: { x: inner.x, y: y + shift }, b: { x: inner.x + inner.w, y: y + shift } }, events: out, overflow: unresolved || bottom - top > inner.h + 0.5 };
  }
  const x = inner.x + Math.min(34, inner.w * 0.14);
  const room = Math.max(40, inner.x + inner.w - x - stem - 6);
  const rows = events.map((e, i) => {
    const sz = size(e.id);
    const h = sz.h;
    return { e, i, h, w: Math.min(sz.w, room), y: Math.max(inner.y, Math.min(inner.y + inner.h - h, inner.y + f[i]! * inner.h - h / 2)) };
  });
  // Close events would write over each other: push each below the one before, then back up what ran past the bottom.
  for (let k = 1; k < rows.length; k++) rows[k]!.y = Math.max(rows[k]!.y, rows[k - 1]!.y + rows[k - 1]!.h + 4);
  for (let k = rows.length - 1; k >= 0; k--) {
    const limit = k === rows.length - 1 ? inner.y + inner.h : rows[k + 1]!.y - 4;
    rows[k]!.y = Math.min(rows[k]!.y, limit - rows[k]!.h);
  }
  for (const r of rows) out.set(r.e.id, { dot: { x, y: inner.y + f[r.i]! * inner.h }, f: f[r.i]!, rect: { x: x + stem + 6, y: r.y, w: r.w, h: r.h }, side: 1 });
  const lastRow = rows[rows.length - 1];
  const used = lastRow ? lastRow.y + lastRow.h - (rows[0]?.y ?? 0) : 0;
  return { horizontal, axis: { a: { x, y: inner.y }, b: { x, y: inner.y + inner.h } }, events: out, overflow: used > inner.h + 0.5 };
}

// ---- Steps ---------------------------------------------------------------------------------------

export type StepsLayout = { rows: Px[]; rowH: number };

/** n rows down the area, each as tall as the area allows up to `maxRow`. */
export function stepsLayout(n: number, area: Px, pad: number, maxRow: number): StepsLayout {
  const inner: Px = { x: area.x + pad, y: area.y + pad, w: Math.max(1, area.w - 2 * pad), h: Math.max(1, area.h - 2 * pad) };
  if (n === 0) return { rows: [], rowH: 0 };
  const rowH = Math.min(maxRow, inner.h / n);
  return { rows: Array.from({ length: n }, (_, i) => ({ x: inner.x, y: inner.y + i * rowH, w: inner.w, h: rowH })), rowH };
}

// ---- Chart ---------------------------------------------------------------------------------------

/** Round tick values covering [lo, hi]: about `want` of them, at 1, 2 or 5 times a power of ten. */
export function niceTicks(lo: number, hi: number, want = 5): { ticks: number[]; lo: number; hi: number } {
  if (!(hi > lo)) {
    const c = Number.isFinite(lo) ? lo : 0;
    lo = c - 1;
    hi = c + 1;
  }
  const raw = (hi - lo) / Math.max(1, want);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  const first = Math.ceil(lo / step - 1e-9) * step;
  const ticks: number[] = [];
  const decimals = Math.max(0, 1 - Math.floor(Math.log10(step)));
  for (let k = 0; first + k * step <= hi + step * 1e-9 && ticks.length < 40; k++) ticks.push(Number((first + k * step).toFixed(decimals)) + 0);
  return { ticks, lo, hi };
}

export type ChartData = { series: Array<{ pts: ReadonlyArray<readonly [number, number]> }>; dots: Array<{ x: number; y: number }>; xrange?: readonly [number, number]; yrange?: readonly [number, number] };

/** The ranges the axes show: the ones given, else the data's own with a little room (and zero when the data is near it). */
export function chartRanges(data: ChartData): { x: [number, number]; y: [number, number] } {
  let xs: number[] = [], ys: number[] = [];
  for (const s of data.series) for (const p of s.pts) { xs.push(p[0]); ys.push(p[1]); }
  for (const d of data.dots) { xs.push(d.x); ys.push(d.y); }
  xs = xs.filter(Number.isFinite);
  ys = ys.filter(Number.isFinite);
  const span = (v: number[], given: readonly [number, number] | undefined, zero: boolean): [number, number] => {
    if (given && given[1] > given[0]) return [given[0], given[1]];
    if (v.length === 0) return [0, 1];
    let lo = Math.min(...v), hi = Math.max(...v);
    if (hi <= lo) { lo -= 1; hi += 1; }
    const room = (hi - lo) * 0.06;
    if (zero && lo > 0 && lo < (hi - lo) * 0.5) lo = 0;
    else lo -= room;
    return [lo, hi + room];
  };
  return { x: span(xs, data.xrange, false), y: span(ys, data.yrange, true) };
}

export type ChartLayout = {
  plot: Px;
  xTicks: Array<{ v: number; px: number }>;
  yTicks: Array<{ v: number; px: number }>;
  x: [number, number];
  y: [number, number];
  toPx: (x: number, y: number) => Pt;
};

/** The plot rectangle inside an area (room for the axis numbers and labels), the ticks and the map from chart units to pixels. */
export function chartLayout(data: ChartData, area: Px, room: { left: number; bottom: number; top: number; right: number }): ChartLayout {
  const plot: Px = { x: area.x + room.left, y: area.y + room.top, w: Math.max(10, area.w - room.left - room.right), h: Math.max(10, area.h - room.top - room.bottom) };
  const r = chartRanges(data);
  const nx = niceTicks(r.x[0], r.x[1], Math.max(2, Math.round(plot.w / 90)));
  const ny = niceTicks(r.y[0], r.y[1], Math.max(2, Math.round(plot.h / 56)));
  // The axes run to the data's range (not out to the next round number), the ticks sit inside them.
  const x: [number, number] = data.xrange && data.xrange[1] > data.xrange[0] ? [data.xrange[0], data.xrange[1]] : [r.x[0], r.x[1]];
  const y: [number, number] = data.yrange && data.yrange[1] > data.yrange[0] ? [data.yrange[0], data.yrange[1]] : [r.y[0], r.y[1]];
  const toPx = (vx: number, vy: number): Pt => ({ x: plot.x + ((vx - x[0]) / (x[1] - x[0])) * plot.w, y: plot.y + plot.h - ((vy - y[0]) / (y[1] - y[0])) * plot.h });
  return {
    plot, x, y, toPx,
    xTicks: nx.ticks.filter((v) => v >= x[0] && v <= x[1]).map((v) => ({ v, px: toPx(v, y[0]).x })),
    yTicks: ny.ticks.filter((v) => v >= y[0] && v <= y[1]).map((v) => ({ v, px: toPx(x[0], v).y })),
  };
}

/** A smooth curve through points (Catmull-Rom), as a polyline with `per` segments between points. */
export function smoothPoints(pts: readonly Pt[], per = 12): Pt[] {
  if (pts.length < 3) return [...pts];
  const out: Pt[] = [];
  const at = (k: number): Pt => pts[Math.max(0, Math.min(pts.length - 1, k))]!;
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let s = 0; s < per; s++) {
      const t = s / per;
      const f = (pa: number, pb: number, pc: number, pd: number): number =>
        0.5 * (2 * pb + (-pa + pc) * t + (2 * pa - 5 * pb + 4 * pc - pd) * t * t + (-pa + 3 * pb - 3 * pc + pd) * t * t * t);
      out.push({ x: f(a.x, b.x, c.x, d.x), y: f(a.y, b.y, c.y, d.y) });
    }
  }
  out.push(at(pts.length - 1));
  return out;
}

/** A number as a short axis label: no trailing zeros, thousands in k, tiny values in plain decimals. */
export function formatTick(v: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 10000) return `${Math.round(v / 100) / 10}k`;
  if (a >= 100) return String(Math.round(v));
  return String(Math.round(v * 100) / 100);
}
