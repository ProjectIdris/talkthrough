// Development tool: runs the whole question loop (chord pressed through the key hook, microphone,
// a real page screenshot, the model on the user's subscription, the validator, a stand-in overlay)
// and prints the time from key release to the first mark and word. Each run is ONE live model call;
// the number is printed first and --max-calls caps it.
//
//   node scripts/measure-loop.ts --shots <folder> --page <name> --model codex:gpt-6-luna[:fast]|claude:<name>
//        --runs 3 --out <results.json> --max-calls 3 [--speech-url http://127.0.0.1:PORT --wav question.wav]
//
// Without --speech-url the question text is fixed (the speech server is not used). The overlay is a
// hidden stand-in page, so nothing appears on screen and nothing is spoken.

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { scoreFirstMark } from './pointing-eval.ts';
import type { Rect } from './pointing-eval.ts';

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : fallback;
  if (v === undefined) throw new Error(`missing --${name}`);
  return v;
}

const shots = resolve(arg('shots'));
const page = arg('page');
const spec = arg('model');
const runs = Number(arg('runs', '1'));
const out = arg('out');
const maxCalls = Number(arg('max-calls'));
const speechUrl = process.argv.includes('--speech-url') ? arg('speech-url') : undefined;
const wav = process.argv.includes('--wav') ? resolve(arg('wav')) : undefined;
if (runs > maxCalls) throw new Error(`${runs} calls needed but --max-calls is ${maxCalls}`);
console.log(`${runs} live calls on ${spec}, page ${page}${speechUrl ? ', with the speech server' : ', question text fixed'}`);

const meta = JSON.parse(readFileSync(join(shots, `${page}.json`), 'utf8')) as { question: string; target: Rect };
const electron = resolve('node_modules/electron/dist/electron.exe');
const overlayPage = resolve('test/support/stub-overlay/index.html');
const [kind, name, flag] = spec.split(':') as [string, string, string | undefined];

type Row = Record<string, unknown>;
const rows: Row[] = [];
for (let n = 1; n <= runs; n++) {
  const dir = mkdtempSync(join(tmpdir(), 'tt-measure-'));
  const settingsFile = join(dir, 'settings.json');
  const settings: Record<string, unknown> = kind === 'claude'
    ? { model: 'claude', claudeModel: name, ...(process.env.TALKTHROUGH_CLAUDE ? { claudeCommand: process.env.TALKTHROUGH_CLAUDE } : {}) }
    : { model: 'codex', codexModel: name, codexFast: flag === 'fast', ...(process.env.TALKTHROUGH_CODEX ? { codexCommand: process.env.TALKTHROUGH_CODEX } : {}) };
  if (speechUrl) settings.speechServerUrl = speechUrl;
  writeFileSync(settingsFile, JSON.stringify(settings));
  const args = [
    '.', '--settings', settingsFile, '--hidden', '--silent-voice', '--fake-mic', '--capture-image', join(shots, `${page}.png`),
    '--backdrop', join(shots, `${page}.png`), '--self-chord', '--exit-after-chord', '1', '--settle-seconds', '2', '--log-steps', '--max-seconds', '90',
    ...(wav ? ['--fake-mic-file', wav] : []),
    ...(speechUrl ? [] : ['--question', meta.question]),
  ];
  const env: NodeJS.ProcessEnv = { ...process.env, TALKTHROUGH_OVERLAY_PAGE: overlayPage };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  child.stdout.on('data', (c: Buffer) => (text += c.toString()));
  child.stderr.on('data', (c: Buffer) => (text += c.toString()));
  const killer = setTimeout(() => child.kill(), 120_000);
  await new Promise<void>((done) => child.on('exit', () => done()));
  clearTimeout(killer);
  rmSync(dir, { recursive: true, force: true });

  const reports = [...text.matchAll(/report (\{.*\})/g)].map((m) => JSON.parse(m[1]!) as Record<string, unknown>);
  const report = reports.at(-1) ?? {};
  const steps = [...text.matchAll(/ step (\{.*\})/g)].map((m) => JSON.parse(m[1]!) as unknown);
  const scored = scoreFirstMark(meta.target, steps);
  const timings = /codex timings: (.*)/.exec(text)?.[1];
  const row = { run: n, model: spec, page, ...report, scored, ...(timings ? { timings } : {}) };
  rows.push(row);
  console.log(`${spec} run ${n}: ${report.error ? 'ERROR ' + String(report.error) : `question ${JSON.stringify(report.question)}`} | transcript ${report.transcriptMs ?? '-'} ms, first piece ${report.firstPieceMs ?? '-'} ms, first mark ${report.firstMarkMs ?? '-'} ms, first word ${report.firstWordMs ?? '-'} ms, end ${report.endMs ?? '-'} ms, steps ${report.steps ?? 0} | ${scored ? `${scored.op} iou ${scored.iou === null ? '-' : scored.iou.toFixed(2)} hit ${scored.hit}` : 'no mark'}${timings ? ` | ${timings}` : ''}`);
}
writeFileSync(out, JSON.stringify(rows, null, 1));
