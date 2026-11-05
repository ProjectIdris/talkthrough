import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modelLine, normaliseLater, prettyModel, stepPlan } from '../src/main/model-plan.ts';

const base = { model: 'claude' as const, codexModel: 'gpt-6-luna', claudeModel: 'claude-sonnet-5-5', openaiModel: 'gpt-6-luna', localModel: 'gemma3:12b' };

test('with no later model every step has the first model, and the Claude route follows the setting for how it is written', () => {
  assert.deepEqual(stepPlan({ ...base, splitAnswer: 'two' }), { first: { route: 'claude', name: 'claude-sonnet-5-5' }, later: null, split: 'two' });
  assert.equal(stepPlan({ ...base, model: 'codex' }).split, 'off', 'one call on the other routes');
});

test('a different model for the later steps, on any route, is written one step to a call', () => {
  const p = stepPlan({ ...base, model: 'codex', laterRoute: 'claude', laterModel: 'claude-sonnet-5-5' });
  assert.deepEqual(p.later, { route: 'claude', name: 'claude-sonnet-5-5' });
  assert.equal(p.split, 'steps');
  assert.equal(stepPlan({ ...base, model: 'local', laterRoute: 'openai' }).later?.name, 'gpt-6-luna', 'a route alone: its own model');
  assert.equal(stepPlan({ ...base, splitAnswer: 'off', laterModel: 'claude-haiku-5-5' }).split, 'steps');
});

test('a later model that is the first one is no different', () => {
  assert.deepEqual(normaliseLater({ ...base, laterRoute: 'claude', laterModel: 'claude-sonnet-5-5' }), { laterRoute: '', laterModel: '' });
  assert.deepEqual(normaliseLater({ ...base, laterRoute: 'claude', laterModel: '' }), { laterRoute: '', laterModel: '' });
  assert.deepEqual(normaliseLater({ ...base, laterRoute: 'openai', laterModel: '' }), { laterRoute: 'openai', laterModel: '' });
});

test('the first-run line says what the settings hold', () => {
  assert.equal(modelLine(base), 'Claude Code: Sonnet 5.5 for every step.');
  assert.equal(modelLine({ ...base, claudeModel: 'claude-haiku-5-5', laterModel: 'claude-sonnet-5-5' }), 'Claude Code: Haiku 5.5 for the first step, Sonnet 5.5 for the rest.');
  assert.equal(modelLine({ ...base, model: 'codex', laterRoute: 'claude', laterModel: 'claude-sonnet-5-5' }), 'Codex (gpt-6-luna) for the first step, Claude Code (Sonnet 5.5) for the rest.');
  assert.equal(modelLine({ ...base, model: 'local' }), 'A local model: gemma3:12b for every step.');
  assert.equal(prettyModel('gpt-6-luna'), 'gpt-6-luna');
});
