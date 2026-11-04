// Development tool: replays the scenes a model wrote on saved screenshots (no model call) and measures what the page's
// own pixels do to each mark (src/overlay/snap.ts): how far an arrow's tip was from a line, how much a box's edge cut
// through the page's ink, and how far each mark moved. It needs the electron binary only to read the images.
//
//   node scripts/snap-eval.ts --pages <dir of page images> --reports <dir of run reports> [--only 2-supply] [--targets targets.json] [--jitter 20]
//
// A report is the app's own log of a run: every `action {...}` line is one action the model sent. `--targets` is an
// optional file of hand-marked answers, { "<page>": { "<id>": { "tip": [x,y] } | { "centre": [x,y] } | { "box": [x,y,w,h] } } },
// in the same 0 to 1000 units, to score the marks against. With `--jitter <px>` each marked target is also written 200
// times as a model might get it wrong (every side of a box, the tip of an arrow, the centre of a ring moved by up to that
// many pixels, always the same pseudo-random numbers) and the error before and after is summed up.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Snapper } from '../src/overlay/snap.ts';
import type { Action, Mark } from '../src/scene/types.ts';

type Target = { tip?: [number, number]; centre?: [number, number]; box?: [number, number, number, number] };
type Box = { x: number; y: number; w: number; h: number };

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set((process.argv[i] as string).replace(/^--/, ''), process.argv[i + 1] as string);
const pages = args.get('pages'), reports = args.get('reports');
if (!pages || !reports) {
  console.error('usage: node scripts/snap-eval.ts --pages <dir> --reports <dir> [--only <name start>] [--targets <file>]');
  process.exit(2);
}
const only = args.get('only');
const targets: Record<string, Record<string, Target>> = args.has('targets') ? JSON.parse(readFileSync(args.get('targets') as string, 'utf8')) : {};

const names = readdirSync(reports).filter((f) => f.endsWith('.txt')).map((f) => f.replace(/\.txt$/, '')).filter((n) => !only || n.startsWith(only)).sort();
const cache = mkdtempSync(join(tmpdir(), 'snap-eval-'));
try {
  const images = names.map((n) => join(pages, `${n}.png`)).filter((f) => existsSync(f));
  const electron = createRequire(import.meta.url)('electron') as string;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const run = spawnSync(electron, [join(import.meta.dirname, 'page-gray.cjs'), '--out', cache, ...images], { env, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`could not read the images: ${run.stderr || run.error}`);

  const rows: string[] = [];
  let moved = 0, total = 0;
  for (const name of names) {
    if (!existsSync(join(cache, `${name}.gray`))) continue;
    const meta = JSON.parse(readFileSync(join(cache, `${name}.json`), 'utf8')) as { cols: number; rows: number; w: number; h: number };
    const s = new Snapper(new Uint8Array(readFileSync(join(cache, `${name}.gray`))), meta.cols, meta.rows);
    const pxX = (u: number): number => (u * meta.w) / 1000, pxY = (u: number): number => (u * meta.h) / 1000;
    const cells = (c: number): number => (c * meta.w) / meta.cols;
    rows.push(`== ${name}`);
    for (const line of readFileSync(join(reports, `${name}.txt`), 'utf8').split('\n')) {
      const m = line.match(/action (\{.*\})\s*$/);
      if (!m) continue;
      const before = JSON.parse(m[1] as string) as Action;
      if (!('id' in before) || !['box', 'circle', 'arrow', 'underline', 'point', 'poly', 'trace'].includes(before.op)) continue;
      const after = s.snapAction(before);
      total++;
      const t = targets[name]?.[before.id as string];
      const parts: string[] = [];
      if (after !== before) { moved++; parts.push(`moved ${cells(s.moved(before as Mark, after as Mark)).toFixed(0)} px at most`); } else parts.push('left as written');
      if (before.op === 'arrow' && after.op === 'arrow') {
        const d = (a: { x2: number; y2: number }): string => { const v = s.lineDistance(a.x2, a.y2); return Number.isFinite(v) ? `${cells(v).toFixed(0)} px` : 'no line near'; };
        parts.push(`tip from a line: ${d(before)} before, ${d(after)} after`);
        if (t?.tip) {
          const e = (a: { x2: number; y2: number }): string => Math.hypot(pxX(a.x2 - (t.tip as number[])[0]!), pxY(a.y2 - (t.tip as number[])[1]!)).toFixed(0);
          parts.push(`tip from the target: ${e(before)} px before, ${e(after)} after`);
        }
      }
      if ((before.op === 'circle' || before.op === 'box') && (after.op === 'circle' || after.op === 'box')) {
        if (t?.centre) {
          const c = (a: Box): string => Math.hypot(pxX(a.x + a.w / 2 - (t.centre as number[])[0]!), pxY(a.y + a.h / 2 - (t.centre as number[])[1]!)).toFixed(0);
          parts.push(`centre from the target: ${c(before)} px before, ${c(after)} after`);
        }
        if (before.op === 'box' && after.op === 'box') {
          const cut = (a: Box): string => `${(s.edgeCut(a.x, a.y, a.w, a.h) * 100).toFixed(0)}%`;
          parts.push(`ink on the box's sides: ${cut(before)} before, ${cut(after)} after`);
          if (t?.box) {
            const b = t.box;
            const err = (a: Box): string => Math.max(Math.abs(pxX(a.x - b[0])), Math.abs(pxY(a.y - b[1])), Math.abs(pxX(a.x + a.w - b[0] - b[2])), Math.abs(pxY(a.y + a.h - b[1] - b[3]))).toFixed(0);
            parts.push(`worst side from the figure: ${err(before)} px before, ${err(after)} after`);
          }
        }
      }
      rows.push(`  ${before.op} ${before.id}: ${parts.join('; ')}`);
    }
  }
  const jitter = Number(args.get('jitter') ?? 0);
  if (jitter > 0) {
    rows.push('', `== marks written ${jitter} px off, 200 times each`);
    let seed = 12345;
    const rand = (): number => { seed = (seed * 1664525 + 1013904223) % 4294967296; return (seed / 4294967296) * 2 - 1; };
    for (const name of names) {
      if (!existsSync(join(cache, `${name}.gray`))) continue;
      const meta = JSON.parse(readFileSync(join(cache, `${name}.json`), 'utf8')) as { cols: number; rows: number; w: number; h: number };
      const s = new Snapper(new Uint8Array(readFileSync(join(cache, `${name}.gray`))), meta.cols, meta.rows);
      const ux = (p: number): number => (p * 1000) / meta.w, uy = (p: number): number => (p * 1000) / meta.h;
      const pxX = (u: number): number => (u * meta.w) / 1000, pxY = (u: number): number => (u * meta.h) / 1000;
      for (const [id, t] of Object.entries(targets[name] ?? {})) {
        const errs: { before: number; after: number; moved: boolean }[] = [];
        for (let k = 0; k < 200; k++) {
          let before: Mark;
          let err: (m: Mark) => number;
          if (t.box) {
            const [bx, by, bw, bh] = t.box;
            const x0 = bx + ux(rand() * jitter), y0 = by + uy(rand() * jitter), x1 = bx + bw + ux(rand() * jitter), y1 = by + bh + uy(rand() * jitter);
            before = { op: 'box', id, x: x0, y: y0, w: x1 - x0, h: y1 - y0, color: 'blue' };
            err = (m) => { const a = m as Extract<Mark, { op: 'box' }>; return Math.max(Math.abs(pxX(a.x - bx)), Math.abs(pxY(a.y - by)), Math.abs(pxX(a.x + a.w - bx - bw)), Math.abs(pxY(a.y + a.h - by - bh))); };
          } else if (t.tip) {
            const [tx, ty] = t.tip;
            before = { op: 'arrow', id, x1: tx - 120, y1: ty - 100, x2: tx + ux(rand() * jitter), y2: ty + uy(rand() * jitter), color: 'red' };
            err = (m) => { const a = m as Extract<Mark, { op: 'arrow' }>; return Math.hypot(pxX(a.x2 - tx), pxY(a.y2 - ty)); };
          } else if (t.centre) {
            const [cx, cy] = t.centre;
            before = { op: 'circle', id, x: cx - 37 + ux(rand() * jitter), y: cy - 42 + uy(rand() * jitter), w: 75, h: 85, color: 'green' };
            err = (m) => { const a = m as Extract<Mark, { op: 'circle' }>; return Math.hypot(pxX(a.x + a.w / 2 - cx), pxY(a.y + a.h / 2 - cy)); };
          } else continue;
          const after = s.snapMark(before);
          errs.push({ before: err(before), after: err(after), moved: after !== before });
        }
        if (errs.length === 0) continue;
        const mean = (f: (e: (typeof errs)[number]) => number): number => errs.reduce((a, e) => a + f(e), 0) / errs.length;
        const closer = errs.filter((e) => e.after < e.before - 1).length, further = errs.filter((e) => e.after > e.before + 1).length;
        rows.push(`  ${name} ${id}: mean error ${mean((e) => e.before).toFixed(1)} px before, ${mean((e) => e.after).toFixed(1)} after; moved ${errs.filter((e) => e.moved).length} of ${errs.length}, closer ${closer}, further ${further}`);
      }
    }
  }
  console.log(rows.join('\n'));
  console.log(`\n${total} marks, ${moved} moved, ${total - moved} left as written`);
} finally {
  rmSync(cache, { recursive: true, force: true });
}
