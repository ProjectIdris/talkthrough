import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStageModel } from '../src/adapters/stage-model.ts';
import type { Model, ModelOutput, ModelRequest } from '../src/adapters/model.ts';

function named(id: string, log: string[]): Model {
  return {
    id,
    async *ask(req: ModelRequest): AsyncGenerator<ModelOutput> {
      log.push(`${id} ask ${req.stage ? req.stage.part : 'plain'}`);
      yield { type: 'usage', usage: { input: 1, cached: 0, output: 1 } };
    },
    warm: async () => void log.push(`${id} warm`),
    prime: () => void log.push(`${id} prime`),
    unprime: () => void log.push(`${id} unprime`),
    close: async () => void log.push(`${id} close`),
  };
}
const base = { question: 'q', screenshot: { mime: 'image/png' as const, base64: 'A', width: 4, height: 4 }, thread: [], schema: {} };
const drain = async (m: Model, req: ModelRequest) => { for await (const _ of m.ask(req)) void _; };

test('step 1 goes to the first model and every later call to the other; a question with no stage goes to the first', async () => {
  const log: string[] = [];
  const m = createStageModel(named('fast', log), named('strong', log));
  await drain(m, { ...base, stage: { part: 'first', plan: true } });
  await drain(m, { ...base, stage: { part: 'next', n: 2, shown: [], plan: [] } });
  await drain(m, { ...base, stage: { part: 'next', n: 3, shown: [], plan: [] } });
  await drain(m, { ...base, stage: { part: 'rest' } });
  await drain(m, base);
  assert.deepEqual(log.filter((l) => / ask /.test(l)), ['fast ask first', 'strong ask next', 'strong ask next', 'strong ask rest', 'fast ask plain']);
  assert.equal(m.id, 'fast+strong');
});

test('the later model is started when step 1 is asked for, and not for a question with no stage', async () => {
  const log: string[] = [];
  const m = createStageModel(named('fast', log), named('strong', log));
  await drain(m, base);
  assert.equal(log.includes('strong warm'), false);
  await drain(m, { ...base, stage: { part: 'first' } });
  assert.deepEqual(log.slice(-2), ['strong warm', 'fast ask first']);
});

test('warm and close reach both; prime and unprime only the first (the later call is not made until step 1 is)', async () => {
  const log: string[] = [];
  const m = createStageModel(named('fast', log), named('strong', log));
  await m.warm?.();
  m.prime?.();
  m.unprime?.();
  await m.close?.();
  assert.deepEqual(log.sort(), ['fast close', 'fast prime', 'fast unprime', 'fast warm', 'strong close', 'strong warm']);
});
