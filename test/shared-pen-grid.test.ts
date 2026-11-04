import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStepByStepModel } from '../src/adapters/step-by-step.ts';
import type { Model, ModelOutput, ModelRequest } from '../src/adapters/model.ts';
import { questionText } from '../src/adapters/subscription-shared.ts';
import { cellPoint, gridFor } from '../src/shared/pen-grid.ts';

const card = { x: 500, y: 100, w: 400, h: 600 };

test('the grid has eight cells along the longer side and as many square cells along the other', () => {
  assert.deepEqual(gridFor(600, 800), { cols: 6, rows: 8 });
  assert.deepEqual(gridFor(1000, 500), { cols: 8, rows: 4 });
  assert.deepEqual(gridFor(100, 1000), { cols: 2, rows: 8 }, 'at least two cells across');
});

test('a cell name is the middle of that cell on the card; a letter for the quarter moves it a quarter of a cell; a name that is not a cell is nothing', () => {
  const grid = { cols: 4, rows: 6 };
  assert.deepEqual(cellPoint('A1', grid, card), [550, 150]);
  assert.deepEqual(cellPoint('d6', grid, card), [850, 650]);
  assert.deepEqual(cellPoint('B3', grid, card), [650, 350]);
  assert.deepEqual(cellPoint('B3a', grid, card), [625, 325]);
  assert.deepEqual(cellPoint('B3D', grid, card), [675, 375]);
  assert.equal(cellPoint('E1', grid, card), null, 'no fifth column');
  assert.equal(cellPoint('A7', grid, card), null, 'no seventh row');
  assert.equal(cellPoint('A0', grid, card), null);
  assert.equal(cellPoint('north', grid, card), null);
  assert.equal(cellPoint(42, grid, card), null);
});

const enlarge = JSON.stringify({ steps: [{ say: 'Enlarged.', actions: [{ op: 'image', id: 'zoom', sx: 100, sy: 200, sw: 300, sh: 400, dx: 500, dy: 92, dw: 400, color: 'red' }] }], plan: ['Name'], done: false, escalate: null });
const naming = JSON.stringify({ steps: [{ say: 'Parts.', actions: [{ op: 'point', id: 'p1', x: 520, y: 150, cell: 'B3', color: 'red' }, { op: 'point', id: 'p2', x: 700, y: 300, cell: 'Z9', color: 'blue' }, { op: 'point', id: 'p3', x: 710, y: 310, color: 'green' }] }], plan: null, done: true, escalate: null });

function scripted(raws: string[]) {
  const asked: ModelRequest[] = [];
  let at = 0;
  const inner: Model = {
    id: 'scripted',
    async *ask(req: ModelRequest): AsyncGenerator<ModelOutput> {
      asked.push(req);
      const raw = raws[at++] ?? (raws[raws.length - 1] as string);
      const scene = JSON.parse(raw) as { steps: Array<{ actions: unknown[] }> };
      req.onRaw?.(raw);
      for (const a of (scene.steps[0] as { actions: unknown[] }).actions) yield { type: 'action', action: a } as ModelOutput;
      yield { type: 'step', step: scene.steps[0] } as ModelOutput;
    },
  };
  return { inner, asked };
}

const base = { question: 'q', screenshot: { mime: 'image/png' as const, base64: 'A', width: 4, height: 4 }, thread: [], schema: {} };

test('after an enlargement with a grid, the points the model gives as cells are put in the middle of those cells; others are left alone', async () => {
  const s = scripted([enlarge, naming]);
  const lines: string[] = [];
  const out: ModelOutput[] = [];
  const crop = { mime: 'image/png' as const, base64: 'G', width: 600, height: 800, grid: { cols: 6, rows: 8 } };
  for await (const o of createStepByStepModel(s.inner, { log: (l) => lines.push(l) }).ask({ ...base, cropOf: async () => crop })) out.push(o);
  const asked = s.asked[1] as ModelRequest;
  assert.deepEqual(asked.focus?.[0]?.grid, { cols: 6, rows: 8 });
  assert.equal((asked.focus?.[0]?.crop as { grid?: unknown }).grid, undefined, 'the picture itself carries no grid field');
  const acts = out.filter((o) => o.type === 'action').map((o) => (o as { action: { id: string; x: number; y: number } }).action).filter((a) => a.id.startsWith('p'));
  // the card: x 500..900, y 100..(100 + 400 * 400 / 300); B3 of a 6 by 8 grid
  const round = (v: number) => Math.round(v * 10) / 10;
  assert.deepEqual([acts[0]?.x, acts[0]?.y], [round(500 + (1.5 / 6) * 400), round(100 + (2.5 / 8) * ((400 * 400) / 300))]);
  assert.deepEqual([acts[1]?.x, acts[1]?.y], [700, 300], 'a cell the grid does not have: its own x,y');
  assert.deepEqual([acts[2]?.x, acts[2]?.y], [710, 310], 'no cell: untouched');
  const step = out.find((o) => o.type === 'step' && (o.step as { say: string }).say === 'Parts.') as { step: { actions: Array<{ x: number }> } };
  assert.equal(step.step.actions[0]?.x, acts[0]?.x, 'the finished step agrees with its pieces');
  assert.ok(lines.some((l) => /point p1: cell B3 ->/.test(l) && /it wrote 520,150/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /"Z9" is not a cell/.test(l)));
});

test('without a grid on the closer picture a cell the model writes is not used', async () => {
  const s = scripted([enlarge, naming]);
  const out: ModelOutput[] = [];
  for await (const o of createStepByStepModel(s.inner).ask({ ...base, cropOf: async () => ({ mime: 'image/png' as const, base64: 'G', width: 600, height: 800 }) })) out.push(o);
  const first = out.find((o) => o.type === 'action' && (o.action as { id: string }).id === 'p1') as { action: { x: number } };
  assert.equal(first.action.x, 520);
});

test('what the model is told with a grid: the columns and rows, how to name a cell and a quarter, and that the app takes the cell', () => {
  const crop = { mime: 'image/png' as const, base64: 'X', width: 600, height: 800 };
  const text = questionText({ ...base, focus: [{ crop, box: { x: 100, y: 200, w: 300, h: 400 }, card, grid: { cols: 6, rows: 8 }, kind: 'picture' }] });
  assert.match(text, /columns A to F across, rows 1 to 8 down/);
  assert.match(text, /"cell"/);
  assert.match(text, /a top left, b top right, c bottom left, d bottom right/);
  assert.match(text, /mostly the part itself/);
  assert.match(text, /puts the point in the middle of that quarter/);
});
