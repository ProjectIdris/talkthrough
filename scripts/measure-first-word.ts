// Development tool: where the time goes between sending a question to the Claude route and its first word.
// It starts the command the way the app does, waits --idle seconds (the time the process sits ready while the question is
// spoken), writes the question and logs each event from the command with the time since the write; it stops the process
// shortly after the first complete `say`, so a run costs one call with a short answer.
//
//   node scripts/measure-first-word.ts --command <claude executable> --mode idle [--idle 6]       (no call: only starts the process)
//   node scripts/measure-first-word.ts --command <claude executable> --mode call --image page.png --question "Explain this" [--idle 5]
//        [--debug-file out.log] [--effort low] [--thinking disabled|adaptive] [--thinking-env] [--settings-json '{...}'] [--mime image/jpeg]
//        [--full] [--answer-file out.txt] [--max-calls 1] [--tail 1500]
//
// The three thinking switches are there to be tried: on Haiku 5.5 none of them stops it thinking (see the First Word note).
// `call` is one live model call. The command is started through the same arguments as the app (claudeArgs), with the same
// instructions, schema and question text, so the numbers are the app's own.

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeArgs } from '../src/adapters/claude-model.ts';
import { childEnv, questionText, systemPrompt } from '../src/adapters/subscription-shared.ts';
import { sceneSchemaLean } from '../src/scene/index.ts';

const args = process.argv.slice(2);
const at = (n: string, d?: string): string | undefined => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
const command = at('command');
const mode = at('mode', 'idle');
const idle = Number(at('idle', '5')) * 1000;
const effort = at('effort', 'low') as string;
const tail = Number(at('tail', '1500'));
if (!command || !['idle', 'call'].includes(mode as string)) { console.error('give --command <claude executable> and --mode idle|call'); process.exit(2); }
if (mode === 'call' && Number(at('max-calls', '0')) < 1) { console.error('a call is one live model call: give --max-calls 1'); process.exit(2); }

const dir = mkdtempSync(join(tmpdir(), 'tt-fw-'));
const promptFile = join(dir, 'instructions.txt');
writeFileSync(promptFile, systemPrompt());
const flags = claudeArgs('claude-haiku-5-5', effort, sceneSchemaLean, promptFile);
const debugFile = at('debug-file');
if (debugFile) flags.push('--debug-file', debugFile);
const thinking = at('thinking');
if (thinking) flags.push(`--thinking=${thinking}`);
const inlineSettings = at('settings-json');
if (inlineSettings) flags.push('--settings', inlineSettings);
const env = childEnv({ DISABLE_AUTOUPDATER: '1', ...(args.includes('--thinking-env') ? { CLAUDE_CODE_DISABLE_THINKING: '1', MAX_THINKING_TOKENS: '0' } : {}) });
const full = args.includes('--full');
let textDeltas = 0, lastDelta = 0, thinkingEvents = 0;

const t0 = performance.now();
const ms = (from: number) => `${(performance.now() - from).toFixed(0).padStart(6)} ms`;
let sentAt = 0;
const proc = spawn(command, flags, { cwd: dir, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
console.log(`spawned pid ${proc.pid}`);
let buf = '';
let said = '';
let sayDone = false;
let firstDelta = 0;
let stopTimer: ReturnType<typeof setTimeout> | undefined;
const finish = (why: string) => {
  console.log(`${ms(sentAt || t0)} ${why}; text deltas ${textDeltas}, last at +${(lastDelta - sentAt).toFixed(0)} ms, thinking deltas ${thinkingEvents}`);
  proc.kill();
};
proc.stderr.on('data', () => undefined);
proc.on('error', (e) => { console.error(String(e)); process.exit(1); });
proc.stdout.setEncoding('utf8');
proc.stdout.on('data', (chunk: string) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    let e: any;
    try { e = JSON.parse(line); } catch { continue; }
    const since = sentAt || t0;
    const label = sentAt ? `+${ms(sentAt)}` : `spawn+${ms(t0)}`;
    if (e.type === 'system' && e.subtype === 'thinking_tokens') { thinkingEvents++; if (thinkingEvents === 1) console.log(`${label} thinking started`); continue; }
    if (e.type === 'system') { console.log(`${label} system ${e.subtype}${e.subtype === 'init' ? ` tools=${JSON.stringify(e.tools)} model=${e.model}` : ''}`); continue; }
    if (e.type === 'stream_event') {
      const inner = e.event ?? {};
      if (inner.type === 'content_block_delta') {
        const d = inner.delta ?? {};
        if (d.type === 'input_json_delta') {
          if (!firstDelta) { firstDelta = performance.now(); console.log(`${label} first tool-input delta`); }
          said += d.partial_json;
          const m = /"say"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(said);
          if (m && !sayDone) { sayDone = true; console.log(`${label} first say complete (tool input): ${JSON.stringify(m[1]).slice(0, 80)}`); if (!full) stopTimer = setTimeout(() => finish('stopped (tail after the first say)'), tail); }
        } else if (d.type === 'text_delta') {
          if (!textDeltas++) console.log(`${label} first text delta`);
          lastDelta = performance.now();
          said += d.text;
          const m = /"say"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(said);
          if (m && !sayDone) { sayDone = true; console.log(`${label} first say complete (as text): ${JSON.stringify(m[1]).slice(0, 80)}`); if (!full) stopTimer = setTimeout(() => finish('stopped (tail after the first say)'), tail); }
        } else if (d.type === 'thinking_delta') {
          thinkingEvents++;
        }
      } else if (inner.type === 'message_start') {
        console.log(`${label} message_start ${JSON.stringify(inner.message?.usage ?? {})}`);
      } else if (inner.type === 'content_block_start') {
        console.log(`${label} content_block_start ${inner.content_block?.type}${inner.content_block?.name ? ` ${inner.content_block.name}` : ''}`);
      } else if (inner.type === 'message_delta') {
        console.log(`${label} message_delta ${JSON.stringify(inner.usage ?? {})}`);
      }
      continue;
    }
    if (e.type === 'result') console.log(`${label} result ${e.subtype} usage ${JSON.stringify(e.usage ?? {}).slice(0, 220)} structured=${e.structured_output !== undefined}`); else if (e.type !== 'assistant' && e.type !== 'rate_limit_event') console.log(`${label} ${e.type}${e.subtype ? ` ${e.subtype}` : ''}`);
    if (e.type === 'result') { clearTimeout(stopTimer); finish('result'); }
  }
});
proc.on('exit', (code) => {
  console.log(`${ms(t0)} process exit ${code}`);
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
});

setTimeout(() => {
  if (mode === 'idle') { finish('idle done, no message sent'); return; }
  const image = at('image');
  if (!image) { console.error('give --image'); proc.kill(); return; }
  const png = readFileSync(image);
  const width = Number(at('width', '1280')), height = Number(at('height', '536'));
  const mime = at('mime', 'image/png') as string;
  const req = { question: at('question', 'Explain this') as string, screenshot: { mime, base64: png.toString('base64'), width, height }, thread: [] } as never;
  const text = questionText(req);
  const message = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mime, data: png.toString('base64') } }, { type: 'text', text }] } }) + '\n';
  console.log(`image ${png.length} bytes, message ${message.length} chars`);
  sentAt = performance.now();
  proc.stdin.write(message);
  setTimeout(() => finish('gave up after 40 s'), 40_000);
  if (at('answer-file')) process.on('exit', () => writeFileSync(at('answer-file') as string, said));
}, idle);
