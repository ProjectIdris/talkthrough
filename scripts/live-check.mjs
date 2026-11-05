// Development tool: one live question to the Claude (Haiku) route on a saved screenshot, with the route checked first.
//
//   node scripts/live-check.mjs --claude-command <path to the claude executable> --page <screenshot.png> --question "Explain this" [--out <dir>] [--settle 20] [--max 150] [--gpu yes] [--detail-after <seconds>]
//   node scripts/live-check.mjs --claude-command <path> --claude-model claude-sonnet-5-5 [--later-model claude-sonnet-5-5] ...   (another Claude model; --later-model writes the steps after step 1)
//   node scripts/live-check.mjs --route codex [--codex-fast] --page ... --question ...        (the Codex route, model gpt-6-luna; --codex-fast is its priority tier)
//   node scripts/live-check.mjs --settings <settings file> --page ... --question ...      (a settings file you wrote yourself)
//   node scripts/live-check.mjs --claude-command <path> --route-only                      (the check alone: no app, no call)
//
// A live call costs money, and a settings file that does not parse makes the app fall back to its default route without
// saying so (it once sent five calls to the wrong model). So this writes the settings with JSON.stringify, reads them back
// the way the app does, and refuses to start unless they name the route and the model(s) asked for (Haiku by default; Sonnet or
// gpt-6-luna when named) and, for the claude route, an executable that exists, with no warning from the loader. The app then runs hidden with a silent voice, a keypress made for it, the screenshot
// (a pen stroke made without a mouse: --fake-stroke "x,y x,y ... | x,y ..." on the 0..1000 scale, strokes told apart by a bar; the pictures the model gets are written to <out>/pen)
// (and the same picture as the backdrop) from file, DISABLE_AUTOUPDATER=1 for the executable, and --log-steps so the log
// holds each answer's raw text (`answer-raw`). Frames every two seconds go to <out>/f, the app's log to <out>/run.log.
// It prints the report line, what the answer drew and what snapping moved. It runs one app at a time and stops it at the end.

import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith('--')) args.set(a.slice(2), 'yes');
  else { args.set(a.slice(2), next); i++; }
}
const fail = (message, code = 2) => { console.error(message); process.exit(code); };

const out = resolve(args.get('out') ?? join(tmpdir(), `tt-live-${Date.now()}`));
mkdirSync(out, { recursive: true });

// 1. The settings: written properly, or the one given.
let settingsFile = args.get('settings');
if (!settingsFile) {
  const codex = args.get('route') === 'codex';
  const command = args.get('claude-command');
  if (!codex && !command) fail('give --claude-command <path to the claude executable> (or --route codex, or --settings <file>)');
  settingsFile = join(out, 'route-prefs.json');
  const prefs = codex
    ? { model: 'codex', codexModel: 'gpt-6-luna', ...(args.has('codex-fast') ? { codexFast: true } : {}) }
    : { model: 'claude', claudeModel: args.get('claude-model') ?? 'claude-haiku-5-5', ...(args.has('later-model') ? { claudeLaterModel: args.get('later-model') } : {}), claudeCommand: command.split('\\').join('/') };
  writeFileSync(settingsFile, JSON.stringify(prefs, null, 2));
}
settingsFile = resolve(settingsFile);

// 2. The route check: read back as the app reads it.
const { loadSettings } = await import(pathToFileURL(join(root, 'src/main/settings.ts')).href);
const warnings = [];
const settings = loadSettings(settingsFile, (m) => warnings.push(m));
const command = settings.claudeCommand;
const route = { model: settings.model, ...(settings.model === 'codex' ? { codexModel: settings.codexModel, codexFast: settings.codexFast } : { claudeModel: settings.claudeModel, ...(settings.claudeLaterModel ? { claudeLaterModel: settings.claudeLaterModel } : {}), command: typeof command === 'string' && command ? (existsSync(command) ? 'present' : 'MISSING') : 'unset' }), warnings };
const claudeOk = (m) => /^claude-(haiku|sonnet)-5-5$/.test(String(m));
route.ok = warnings.length === 0 && (settings.model === 'codex' ? settings.codexModel === 'gpt-6-luna' : claudeOk(settings.claudeModel) && (!settings.claudeLaterModel || claudeOk(settings.claudeLaterModel)) && route.command === 'present');
console.log(`route: ${JSON.stringify(route)}`);
if (!route.ok) fail('REFUSED: the settings do not give the route and models asked for (Haiku or Sonnet on claude with an executable that exists, or gpt-6-luna on codex); nothing was started.');
if (args.has('route-only')) process.exit(0);

// 3. The run.
const page = args.get('page'), question = args.get('question');
if (!page || !question) fail('give --page <screenshot.png> and --question "<text>"');
if (!existsSync(resolve(page))) fail(`no such page: ${page}`);
const frames = join(out, 'f'), data = join(out, 'ud');
rmSync(frames, { recursive: true, force: true });
rmSync(data, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });
mkdirSync(data, { recursive: true });
const env = { ...process.env, DISABLE_AUTOUPDATER: '1' };
delete env.ELECTRON_RUN_AS_NODE;
// The app's own output goes to a file, not a pipe: on Windows its console output is lost on a pipe.
const logFile = join(out, 'run.log');
const logFd = openSync(logFile, 'w');
const run = spawnSync(process.execPath, [
  'scripts/start.mjs', '--hidden', '--silent-voice', '--self-chord', '--exit-after-chord', '1',
  '--settle-seconds', args.get('settle') ?? '20', '--log-steps', '--max-seconds', args.get('max') ?? '150',
  ...(args.has('gpu') ? ['--gpu'] : []), ...(args.has('detail-after') ? ['--detail-after', args.get('detail-after')] : []),
  '--capture-image', resolve(page), '--backdrop', resolve(page), '--question', question,
  ...(args.has('fake-stroke') ? ['--fake-stroke', args.get('fake-stroke')] : []),
  ...(args.has('fake-stroke') || args.has('save-pen') ? ['--save-pen', join(out, 'pen')] : []),
  '--settings', settingsFile, `--user-data-dir=${data}`, '--frames-dir', frames, '--frame-every', '2000',
], { cwd: root, env, stdio: ['ignore', logFd, logFd], timeout: 240_000 });
closeSync(logFd);
const log = readFileSync(logFile, 'utf8');

// 4. What came back.
const lines = log.split('\n');
const report = lines.find((l) => /\breport \{/.test(l));
console.log(report ? `report: ${report.slice(report.indexOf('report {') + 7)}` : `no report line (exit ${run.status}); see ${join(out, 'run.log')}`);
const rawLine = lines.find((l) => l.includes('answer-raw '));
if (rawLine) {
  const raw = JSON.parse(rawLine.slice(rawLine.indexOf('answer-raw ') + 11));
  const counts = {};
  for (const m of raw.matchAll(/"op"\s*:\s*"([a-z0-9-]+)"/g)) counts[m[1]] = (counts[m[1]] ?? 0) + 1;
  console.log(`answer drew: ${JSON.stringify(counts)}`);
}
for (const l of lines) if (l.includes('talkthrough: snapped')) console.log(l.trim());
console.log(`frames: ${frames}\nlog: ${join(out, 'run.log')}`);
process.exit(run.status === 0 ? 0 : 1);
