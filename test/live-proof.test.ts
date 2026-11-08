import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error a plain script with no types
import { QUESTIONS, SIDES, blankPng, logNotes, parseArgs, planRuns, reportMarkdown, routeCheck, tapeMetrics } from '../scripts/live-proof.mjs';

test('the plan asks every question on both sides, the side that goes first alternating by question', () => {
  const runs = planRuns({});
  assert.equal(QUESTIONS.length, 17);
  assert.equal(runs.length, 34);
  for (const [id] of QUESTIONS) assert.deepEqual(runs.filter((r: { id: string }) => r.id === id).map((r: { side: string }) => r.side).sort(), [...SIDES].sort());
  const first = (id: string) => runs.find((r: { id: string }) => r.id === id).side;
  assert.notEqual(first(QUESTIONS[0][0]), first(QUESTIONS[1][0]));
  assert.equal(first(QUESTIONS[0][0]), first(QUESTIONS[2][0]));
});

test('--only and --repeat narrow and widen the plan, and a wrong name or count is refused', () => {
  assert.deepEqual(planRuns({ only: 'arm,pulley' }).map((r: { id: string }) => r.id), ['arm', 'arm', 'pulley', 'pulley']);
  assert.equal(planRuns({ only: 'arm', repeat: 3 }).length, 6);
  assert.throws(() => planRuns({ only: 'arm,nothing' }), /no such question: nothing/);
  assert.throws(() => planRuns({ repeat: 0 }), /whole number/);
});

test('the options read as name and value, a bare name meaning yes', () => {
  const a = parseArgs(['--before', 'x', '--live', '--out', 'y']);
  assert.equal(a.get('before'), 'x');
  assert.equal(a.get('live'), 'yes');
  assert.equal(a.get('out'), 'y');
});

test('the stand-in picture is a valid PNG of the size and colour asked', () => {
  const png: Buffer = blankPng(7, 3, [10, 20, 30]);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 7);
  assert.equal(png.readUInt32BE(20), 3);
  const idat = png.indexOf('IDAT');
  const raw = inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)));
  assert.equal(raw.length, 3 * (1 + 7 * 3));
  assert.deepEqual([...raw.subarray(1, 4)], [10, 20, 30]);
});

test('a tape reads as steps, actions, ops, timing and tokens, and an empty one as zeros', () => {
  const tape = { calls: [{ outputs: [
    { at: 900, output: { type: 'step', step: { say: 'One.', actions: [{ op: 'add' }, { op: 'add' }, { op: 'spin' }] } } },
    { at: 1500, output: { type: 'usage', usage: { input: 100, output: 20 } } },
    { at: 4000, output: { type: 'step', step: { say: 'Two.', actions: [{ op: 'pin' }] } } },
  ] }] };
  const m = tapeMetrics(tape);
  assert.deepEqual([m.steps, m.actions, m.firstMs, m.lastMs, m.input, m.output], [2, 4, 900, 4000, 100, 20]);
  assert.deepEqual(m.ops, { add: 2, spin: 1, pin: 1 });
  assert.deepEqual(tapeMetrics({}), { steps: 0, actions: 0, ops: {}, sayChars: 0, firstMs: undefined, lastMs: 0, input: 0, output: 0 });
});

test('the log notes are the validator and loader lines only', () => {
  const log = 'start\nrepaired: "g-shaft" is the shaft added\npin warning: no visible surface\nsteady\nunknown field ignored\n';
  assert.equal(logNotes(log).length, 3);
  assert.equal(logNotes('answer-raw "a dropped word"\nstep-open "ignored"\nreport {"x":"trimmed"}').length, 0, 'what the model said is not a note about it');
});

test('the report puts both sides of each question in one table with the guide lengths and totals', () => {
  const metrics = tapeMetrics({ calls: [{ outputs: [{ at: 1, output: { type: 'step', step: { say: 'x', actions: [{ op: 'add' }] } } }] }] });
  const results = SIDES.map((side: string) => ({ id: 'arm', group: 'judge', question: 'q', side, n: 1, exit: 0, metrics, notes: side === 'before' ? 2 : 1, frames: 5 }));
  const md = reportMarkdown({ results, guide: { before: 44792, after: 43714 }, route: 'claude claude-sonnet-5-5', mode: 'live (models asked)' });
  assert.match(md, /Guide length: before 44792, after 43714/);
  assert.match(md, /\| arm \| before \| 1 \| 0 \| 1 \| 1 \| add 1 \|/);
  assert.match(md, /\| arm \| after \|/);
  assert.match(md, /\| before \| 1 \| 0 \| 1 \| 2 \|/);
  assert.match(md, /\| after \| 1 \| 0 \| 1 \| 1 \|/);
});

test('the route check passes only the subscription routes: a key route or a local model on any step is refused, so a live run cannot spend elsewhere', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'route-'));
  try {
    const check = async (name: string, settings: Record<string, unknown>) => {
      const file = join(dir, name + '.json');
      writeFileSync(file, JSON.stringify(settings));
      return routeCheck('.', file);
    };
    const exe = process.execPath;
    assert.equal((await check('claude', { model: 'claude', claudeCommand: exe })).ok, true);
    assert.equal((await check('codex', { model: 'codex' })).ok, true);
    for (const [name, settings] of [
      ['openai', { model: 'openai', claudeCommand: exe }],
      ['local', { model: 'local', claudeCommand: exe }],
      ['later-openai-on-claude', { model: 'claude', claudeCommand: exe, laterRoute: 'openai', laterModel: 'gpt-x' }],
      ['later-openai-on-codex', { model: 'codex', laterRoute: 'openai', laterModel: 'gpt-5' }],
      ['detail-openai', { model: 'claude', claudeCommand: exe, detailRoute: 'openai' }],
    ] as const) {
      const r = await check(name, settings);
      assert.equal(r.ok, false, name);
      assert.match(r.text, /not (a subscription route|claude or codex)/, name);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
