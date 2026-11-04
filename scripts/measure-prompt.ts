// Development tool: what does the fixed part of the prompt cost? Asks one model the same question about
// the same picture several times, one after another, and prints per question the tokens the provider
// reports (input, of them cached, output) and the time to the first piece and to the end.
// Each question is one live model call, so the tool prints the count first and stops at --max-calls.
//
//   node scripts/measure-prompt.ts --image page.png[,other.png,...] --model codex:gpt-6-luna|claude:claude-haiku-5-5 \
//        [--n 3] [--question "what is this?"] [--schema lean|full] [--codex-config key=json ...] \
//        [--follow-up] [--keep-thread] [--prime [--prime-wait 4]] --max-calls 4 [--out results.json]
//
// --codex-config sets a Codex config key for each thread (value as JSON), e.g. include_permissions_instructions=false.
// --follow-up asks each question as a follow-up of the last (the model is told the earlier turns).
// --prime (Codex) primes a spare thread before each question, as the app does when the key chord completes, and
// waits --prime-wait seconds (the time to speak a question) before asking.
// --keep-thread (Codex) continues one thread for the follow-ups instead of starting a new one each time.

import { readFileSync, writeFileSync } from 'node:fs';
import { createClaudeModel } from '../src/adapters/claude-model.ts';
import { createCodexModel } from '../src/adapters/codex-model.ts';
import type { Model, ThreadTurn, Usage } from '../src/adapters/model.ts';
import { sceneSchema, sceneSchemaLean } from '../src/scene/index.ts';

const args = process.argv.slice(2);
const many = (name: string): string[] => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1] ?? ''] : []));
const one = (name: string, fallback?: string): string | undefined => many(name)[0] ?? fallback;
const flag = (name: string): boolean => args.includes(`--${name}`);

const image = one('image');
const modelSpec = one('model', 'codex:gpt-6-luna') as string;
const n = Number(one('n', '3'));
const maxCalls = Number(one('max-calls', '0'));
const question = one('question', 'What is this?') as string;
const schema = one('schema', 'lean') === 'full' ? sceneSchema : sceneSchemaLean;
// a primed question is two calls: the primer and the question
const calls = flag('prime') ? 2 * n : n;
if (!image || !(maxCalls >= calls) || !(n >= 1)) {
  console.error('usage: node scripts/measure-prompt.ts --image <png> --model codex:<name>|claude:<name> --n 3 --max-calls <at least n, or 2n with --prime> [--codex-config key=json ...] [--follow-up] [--out file]');
  process.exit(2);
}
console.log(`${calls} live call(s) on ${modelSpec}${flag('prime') ? ` (${n} questions, each with a primer)` : ''}`);

const [kind, name] = modelSpec.split(':') as [string, string];
const threadConfig: Record<string, unknown> = {};
for (const pair of many('codex-config')) {
  const at = pair.indexOf('=');
  threadConfig[pair.slice(0, at)] = JSON.parse(pair.slice(at + 1));
}
const model: Model = kind === 'claude'
  ? createClaudeModel({ model: name, schema, ...(process.env.TALKTHROUGH_CLAUDE ? { command: process.env.TALKTHROUGH_CLAUDE } : {}) })
  : createCodexModel({ model: name, ...(process.env.TALKTHROUGH_CODEX ? { command: process.env.TALKTHROUGH_CODEX } : {}), keepThread: flag('keep-thread'), prime: flag('prime'), log: (l) => console.log(`  ${l}`), ...(Object.keys(threadConfig).length > 0 ? { threadConfig } : {}) });
await model.warm?.();

// several pictures (comma-separated) are used in turn, as different screens would be
const pictures = image.split(',').map((f) => readFileSync(f).toString('base64'));
const rows: Array<{ n: number; usage?: Usage; firstPieceMs?: number; totalMs: number; steps: number; error?: string }> = [];
const thread: ThreadTurn[] = [];
for (let i = 1; i <= n; i++) {
  if (flag('prime')) {
    model.prime?.();
    await new Promise((resolve) => setTimeout(resolve, Number(one('prime-wait', '4')) * 1000));
  }
  const started = performance.now();
  let first: number | undefined;
  let usage: Usage | undefined;
  const steps: unknown[] = [];
  let error: string | undefined;
  try {
    for await (const out of model.ask({ question, screenshot: { mime: 'image/png', base64: pictures[(i - 1) % pictures.length] as string, width: 1280, height: 536 }, thread: flag('follow-up') ? thread : [], schema })) {
      first ??= performance.now() - started;
      if (out.type === 'step') steps.push(out.step);
      else if (out.type === 'usage') usage = out.usage;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  if (flag('follow-up')) thread.push({ question, steps: steps as never });
  const row = { n: i, ...(usage ? { usage } : {}), ...(first === undefined ? {} : { firstPieceMs: Math.round(first) }), totalMs: Math.round(performance.now() - started), steps: steps.length, ...(error ? { error } : {}) };
  rows.push(row);
  console.log(JSON.stringify(row));
}
await model.close?.();
const out = one('out');
if (out) writeFileSync(out, JSON.stringify({ model: modelSpec, config: threadConfig, followUp: flag('follow-up'), rows }, null, 1));
