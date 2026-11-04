// Development tool: times one question on the Codex route from the moment it is asked to its first word, with the
// process warm (as the app keeps it), and keeps the answer. One live model call per question; --max-calls caps them.
//
//   node scripts/measure-codex-first-word.ts --model gpt-6-luna --effort low --fast yes --max-calls 2 --idle 5 \
//        --question "Explain this" --image a.png,b.png --out answers-prefix
//
// Prints per question: time to the first output, to the first complete `say` (the app's "first word"), to the first
// complete step and to the end, the tokens the provider reports, and what the answer drew.

import { readFileSync, writeFileSync } from 'node:fs';
import { createCodexModel } from '../src/adapters/codex-model.ts';
import type { Usage } from '../src/adapters/model.ts';
import { sceneSchemaLean } from '../src/scene/index.ts';

const args = process.argv.slice(2);
const at = (n: string, d?: string): string | undefined => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
const images = (at('image') ?? '').split(',').filter(Boolean);
const maxCalls = Number(at('max-calls', '0'));
if (images.length === 0 || images.length > maxCalls) { console.error('give --image a.png[,b.png] and --max-calls at least as many as the images'); process.exit(2); }
const model = createCodexModel({
  model: at('model', 'gpt-6-luna') as string,
  effort: at('effort', 'low') as string,
  fast: at('fast') === 'yes',
  ...(at('command') ? { command: at('command') as string } : {}),
  log: (l) => console.log(`  codex: ${l}`),
});
console.log(`${images.length} live call(s) on codex ${at('model', 'gpt-6-luna')}, effort ${at('effort', 'low')}, fast ${at('fast') === 'yes'}`);
await model.warm?.();
await new Promise((r) => setTimeout(r, Number(at('idle', '5')) * 1000));
for (const [i, file] of images.entries()) {
  const base64 = readFileSync(file).toString('base64');
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  let firstOut = -1, firstSay = -1, firstStep = -1, usage: Usage | undefined;
  const steps: unknown[] = [];
  for await (const out of model.ask({ question: at('question', 'Explain this') as string, screenshot: { mime: 'image/png', base64, width: 1280, height: 536 }, thread: [], schema: sceneSchemaLean, pieces: true })) {
    if (out.type !== 'usage' && firstOut < 0) firstOut = ms();
    if (out.type === 'say' && firstSay < 0) firstSay = ms();
    if (out.type === 'step') { if (firstStep < 0) firstStep = ms(); steps.push(out.step); }
    if (out.type === 'usage') usage = out.usage;
  }
  const end = ms();
  const ops: Record<string, number> = {};
  for (const m of JSON.stringify(steps).matchAll(/"op":"([a-z0-9-]+)"/g)) ops[m[1]!] = (ops[m[1]!] ?? 0) + 1;
  console.log(JSON.stringify({ image: file.split(/[\/]/).pop(), firstOutputMs: firstOut, firstSayMs: firstSay, firstStepMs: firstStep, endMs: end, steps: steps.length, usage, drew: ops }));
  if (at('out')) writeFileSync(`${at('out')}-${i + 1}.json`, JSON.stringify(steps, null, 1));
}
await model.close?.();
