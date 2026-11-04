// Development tool: asks a model about screenshots of real pages and scores where its marks land
// against the true box of the target (see page-shots.cjs). Each run is one live model call on the
// user's own subscription, so it prints the number of calls first and refuses to run more than --max-calls.
//
//   node scripts/pointing-eval.ts --shots <folder> --model codex:gpt-6-luna --schema full|lean --out <results.json> --max-calls 6 [--only name,name]
//   models: codex:<name>[:fast], claude:<name>

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClaudeModel } from '../src/adapters/claude-model.ts';
import { createCodexModel } from '../src/adapters/codex-model.ts';
import type { Model } from '../src/adapters/model.ts';
import { sceneSchema, sceneSchemaLean } from '../src/scene/index.ts';

export type Rect = { x: number; y: number; w: number; h: number };

const clamp = (r: Rect): Rect => {
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  return { x, y, w: Math.max(0, Math.min(1000, r.x + r.w) - x), h: Math.max(0, Math.min(1000, r.y + r.h) - y) };
};

export function iou(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

export type Scored = { op: string; iou: number | null; hit: boolean; distance: number };

/** Score of the first pointing mark (box, circle, underline or arrow) of an answer against the target (0..1000 scale). */
export function scoreFirstMark(targetRaw: Rect, steps: unknown[]): Scored | null {
  const target = clamp(targetRaw);
  const margin = 15; // a mark whose centre is this close to the target still points at it
  for (const step of steps) {
    const actions = (step as { actions?: unknown[] }).actions ?? [];
    for (const a of actions as Array<Record<string, number | string | null>>) {
      const num = (k: string) => Number(a[k]);
      let point: [number, number] | null = null;
      let rect: Rect | null = null;
      if (a.op === 'box' || a.op === 'circle') {
        rect = { x: num('x'), y: num('y'), w: num('w'), h: num('h') };
        point = [rect.x + rect.w / 2, rect.y + rect.h / 2];
      } else if (a.op === 'underline') {
        point = [num('x') + num('w') / 2, num('y')];
      } else if (a.op === 'arrow') {
        point = [num('x2'), num('y2')];
      }
      if (!point || point.some((v) => !Number.isFinite(v))) continue;
      const inside = point[0] >= target.x - margin && point[0] <= target.x + target.w + margin && point[1] >= target.y - margin && point[1] <= target.y + target.h + margin;
      const cx = target.x + target.w / 2;
      const cy = target.y + target.h / 2;
      return { op: String(a.op), iou: rect ? iou(rect, target) : null, hit: inside, distance: Math.hypot(point[0] - cx, point[1] - cy) };
    }
  }
  return null;
}

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : fallback;
  if (v === undefined) throw new Error(`missing --${name}`);
  return v;
}

async function main(): Promise<void> {
  const shots = arg('shots');
  const spec = arg('model');
  const schemaName = arg('schema', 'full');
  const out = arg('out');
  const maxCalls = Number(arg('max-calls'));
  const only = process.argv.includes('--only') ? arg('only').split(',') : null;
  const names = readdirSync(shots).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((n) => !only || only.includes(n)).sort();
  if (names.length > maxCalls) throw new Error(`${names.length} calls needed but --max-calls is ${maxCalls}`);
  console.log(`${names.length} live calls on ${spec} with the ${schemaName} schema`);

  const [kind, name, flag] = spec.split(':') as [string, string, string | undefined];
  const schema = schemaName === 'lean' ? sceneSchemaLean : sceneSchema;
  const model: Model = kind === 'claude'
    ? createClaudeModel({ model: name, schema, ...(process.env.TALKTHROUGH_CLAUDE ? { command: process.env.TALKTHROUGH_CLAUDE } : {}) })
    : createCodexModel({ model: name, fast: flag === 'fast', ...(process.env.TALKTHROUGH_CODEX ? { command: process.env.TALKTHROUGH_CODEX } : {}) });
  await model.warm?.();

  const results: unknown[] = [];
  for (const n of names) {
    const meta = JSON.parse(readFileSync(join(shots, `${n}.json`), 'utf8')) as { question: string; width: number; height: number; target: Rect | null };
    if (!meta.target) continue;
    const base64 = readFileSync(join(shots, `${n}.png`)).toString('base64');
    const started = performance.now();
    let firstPiece: number | null = null;
    const steps: unknown[] = [];
    let error: string | undefined;
    try {
      for await (const o of model.ask({ question: meta.question, screenshot: { mime: 'image/png', base64, width: meta.width, height: meta.height }, thread: [], schema })) {
        firstPiece ??= Math.round(performance.now() - started);
        if (o.type === 'step') steps.push(o.step);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const total = Math.round(performance.now() - started);
    const scored = scoreFirstMark(meta.target, steps);
    const row = { page: n, question: meta.question, model: spec, schema: schemaName, firstPieceMs: firstPiece, totalMs: total, steps: steps.length, scored, error, firstStep: steps[0] };
    results.push(row);
    console.log(`${n}: ${error ? 'ERROR ' + error : scored ? `${scored.op} iou ${scored.iou === null ? '-' : scored.iou.toFixed(2)} hit ${scored.hit} dist ${scored.distance.toFixed(0)}` : 'no pointing mark'}  first ${firstPiece} ms, total ${total} ms`);
  }
  await model.close?.();
  writeFileSync(out, JSON.stringify(results, null, 1));
}

if (process.argv[1] && process.argv[1].endsWith('pointing-eval.ts')) await main();
