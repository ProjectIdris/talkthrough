// Development tool: replays rough pen circles on saved screenshots (no model call) and shows what the crop grows to. For each circle
// it prints the stroke's box, the block of the page it is mostly on (src/shared/pen-blocks.ts) and the crop box (src/shared/pen.ts), and
// writes a scene of those boxes (stroke red, block blue, crop green) that scripts/overlay-frames.cjs can draw on the page.
//
//   env -u ELECTRON_RUN_AS_NODE npx electron scripts/page-gray.cjs --out <grays> <page.png> ...
//   node scripts/pen-eval.ts --grays <grays> --circles <circles.json> --out <dir>
//
// circles.json: { "<page name>": [ { "name": "...", "ellipse": [cx, cy, rx, ry] } | { "name": "...", "points": [[x, y], ...] } ] }
// in pixels of the page image for an ellipse (as the person might circle), in the 0 to 1000 scale for points.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Snapper } from '../src/overlay/snap.ts';
import { readPen } from '../src/shared/pen-read.ts';
import { strokeBounds } from '../src/shared/pen.ts';
import type { Point } from '../src/shared/pen.ts';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set((process.argv[i] as string).replace(/^--/, ''), process.argv[i + 1] as string);
const grays = args.get('grays'), circlesFile = args.get('circles'), out = args.get('out');
if (!grays || !circlesFile || !out) throw new Error('usage: node scripts/pen-eval.ts --grays <dir> --circles <circles.json> --out <dir>');
mkdirSync(out, { recursive: true });

type Circle = { name: string; ellipse?: [number, number, number, number]; points?: Point[] };
const circles = JSON.parse(readFileSync(circlesFile, 'utf8')) as Record<string, Circle[]>;
const round = (n: number): number => Math.round(n * 10) / 10;

for (const [page, list] of Object.entries(circles)) {
  const meta = JSON.parse(readFileSync(join(grays, `${page.split("#")[0]}.json`), 'utf8')) as { cols: number; rows: number; w: number; h: number };
  const gray = new Uint8Array(readFileSync(join(grays, `${page.split("#")[0]}.gray`)));
  const grid = new Snapper(gray, meta.cols, meta.rows).blockGrid;
  const actions: unknown[] = [];
  const px = (b: { x: number; y: number; w: number; h: number } | null): string => (b ? `${Math.round(b.x * meta.w / 1000)},${Math.round(b.y * meta.h / 1000)} ${Math.round(b.w * meta.w / 1000)}x${Math.round(b.h * meta.h / 1000)}px` : 'none');
  const box = (id: string, b: { x: number; y: number; w: number; h: number }, color: string) => ({ op: 'box', id, x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h), color });
  // Every circle of a page is one press: read together, as the app reads them.
  const strokes: Point[][] = list.map((c): Point[] => c.points ?? Array.from({ length: 52 }, (_, k): Point => {
    const [cx, cy, rx, ry] = c.ellipse as [number, number, number, number];
    const a = (k / 48) * 2 * Math.PI + 0.5;
    return [((cx + rx * Math.cos(a)) / meta.w) * 1000, ((cy + ry * Math.sin(a)) / meta.h) * 1000];
  }));
  const t0 = performance.now();
  const marks = readPen(strokes, grid, meta.w / meta.h);
  const ms = performance.now() - t0;
  marks.forEach((m, i) => {
    const own = strokeBounds(m.strokes) as { x: number; y: number; w: number; h: number };
    console.log(`${page} #${i + 1} ${m.kind}${m.loops && m.loops > 1 ? ` x${m.loops}` : ''}${m.open ? ' open' : ''}: stroke ${px(own)} | subject ${px(m.subject)} | crop ${px(m.crop)} (${ms.toFixed(0)} ms for all)`);
    actions.push(box(`s${i}`, own, 'red'), box(`b${i}`, m.subject, 'blue'), box(`c${i}`, m.crop, 'green'));
  });
  writeFileSync(join(out, `${page}.scene.json`), JSON.stringify({ steps: [{ say: 'x', actions }], escalate: null }));
}
