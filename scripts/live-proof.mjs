// Development tool: the live proof as one command. The same questions are put to two builds of the app (before and after a
// change to the guide or the scene language), each on a stand-in screenshot made here, with frames and logs kept side by side.
//
//   node scripts/live-proof.mjs --before <built checkout> --after <built checkout> --settings <settings file> --out <dir>
//        [--only arm,pulley] [--repeat 2] [--gpu yes] [--max 170] [--settle 22]
//        (nothing is asked: prints the plan, the route check and the guide length of each side)
//   ... --live yes     ask the models: two calls a question, the route checked first, every call a paid one
//   ... --replay <folder of tapes, <id>.json>     run the tapes through both builds: no model, no cost (a test of the pipeline)
//
// Both checkouts must be built (`node scripts/build.mjs`). Every run uses a plain stand-in screenshot as the capture and the
// backdrop, so the real screen is never captured (the app refuses a check run without one). Each question runs once on each
// side, the side that goes first alternating from one question to the next, so neither always has the warmer machine. The app
// draws on the software rasteriser unless --gpu yes. Per run, under <out>/<question>/<side>-<n>/: f (frames), run.log,
// tape.json (a live run's answer, which --replay can play again), meta.json. Under <out>: sheets/<question>.png (the middle and
// the last frame, before on the left, after on the right) and report.md.

import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

/** The seventeen questions of the baseline: [id, group, question]. */
export const QUESTIONS = [
  ['arm', 'judge', 'How does the arm bend at the elbow? Show the bones, the muscles and the elbow joint.'],
  ['engine', 'judge', 'How does a four-stroke engine work?'],
  ['chain', 'judge', 'How do a bicycle chain and gears work?'],
  ['heart', 'judge', 'How does the heart pump blood?'],
  ['pulley', 'judge', 'How does a pulley lift a weight?'],
  ['door', 'judge', 'How does a door swing on its hinges?'],
  ['differential', 'complex', "How does a car's differential work?"],
  ['jet', 'complex', 'How does a jet engine work?'],
  ['eye', 'complex', 'How does the human eye work?'],
  ['geartrain', 'complex', "How does a clock's gear train work?"],
  ['lock', 'complex', 'How does a lock and key work?'],
  ['washer', 'complex', 'How does a washing machine drum work?'],
  ['mousetrap', 'real', 'How does a mousetrap work?'],
  ['drill', 'real', 'How does a drill work?'],
  ['camera', 'real', 'How does a camera work?'],
  ['alarmclock', 'real', 'How does an alarm clock work?'],
  ['motor', 'real', 'How does an electric motor work?'],
];

export const SIDES = ['before', 'after'];

/** The options: `--name value`, or `--name` alone for yes. */
export function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args.set(a.slice(2), 'yes');
    else { args.set(a.slice(2), next); i++; }
  }
  return args;
}

/** The runs in order: each question once on each side (or `repeat` times), the side that goes first alternating by question. */
export function planRuns({ only, repeat = 1, questions = QUESTIONS } = {}) {
  const wanted = only === undefined ? undefined : new Set(only.split(',').map((s) => s.trim()).filter(Boolean));
  if (wanted) {
    const known = new Set(questions.map((q) => q[0]));
    const unknown = [...wanted].filter((id) => !known.has(id));
    if (unknown.length > 0) throw new Error(`no such question: ${unknown.join(', ')}`);
  }
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error('--repeat is a whole number of at least 1');
  const runs = [];
  let index = 0;
  for (const [id, group, question] of questions) {
    if (wanted && !wanted.has(id)) continue;
    for (let n = 1; n <= repeat; n++) {
      const order = (index + n) % 2 === 1 ? SIDES : [...SIDES].reverse();
      for (const side of order) runs.push({ id, group, question, side, n });
    }
    index++;
  }
  return runs;
}

/** A plain picture, as a PNG made here, for the capture and the backdrop. */
export function blankPng(width, height, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
    const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** What a tape holds: steps, actions, the ops by count, the time of the first and the last output, and the tokens. */
export function tapeMetrics(tape) {
  const ops = {};
  let steps = 0, actions = 0, firstMs, lastMs = 0, input = 0, output = 0, say = 0;
  for (const call of tape?.calls ?? []) {
    for (const o of call.outputs ?? []) {
      const out = o.output ?? {};
      if (typeof o.at === 'number') { lastMs = Math.max(lastMs, o.at); if (firstMs === undefined) firstMs = o.at; }
      if (out.type === 'step' && out.step) {
        steps++;
        say += String(out.step.say ?? '').length;
        for (const a of out.step.actions ?? []) { actions++; const op = a?.op ?? '?'; ops[op] = (ops[op] ?? 0) + 1; }
      } else if (out.type === 'usage' && out.usage) { input += Number(out.usage.input ?? 0); output += Number(out.usage.output ?? 0); }
    }
  }
  return { steps, actions, ops, sayChars: say, firstMs, lastMs, input, output };
}

/** The lines of a log that are notes of the validator or the loader about what an answer wrote. */
export function logNotes(log) {
  return log.split('\n').filter((l) => !/\b(answer-raw|step-open|report \{)/.test(l) && /\b(trimmed|dropped|repaired|ignored|unknown field|no visible surface)\b/i.test(l)).map((l) => l.trim());
}

const topOps = (ops, n = 4) => Object.entries(ops).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v}`).join(', ');

/** report.md: one table per question, before beside after, then the totals. */
export function reportMarkdown({ results, guide, route, mode }) {
  const lines = ['# Live proof: before and after', '', `Mode: ${mode}. Route: ${route}.`, '', `Guide length: before ${guide.before ?? '?'}, after ${guide.after ?? '?'}.`, ''];
  const ids = [...new Set(results.map((r) => r.id))];
  lines.push('| question | side | run | exit | steps | actions | ops (top) | first output ms | last output ms | tokens in/out | log notes | frames |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const id of ids) {
    for (const r of results.filter((x) => x.id === id).sort((a, b) => a.n - b.n || SIDES.indexOf(a.side) - SIDES.indexOf(b.side))) {
      const m = r.metrics;
      lines.push(`| ${id} | ${r.side} | ${r.n} | ${r.exit} | ${m ? m.steps : '-'} | ${m ? m.actions : '-'} | ${m ? topOps(m.ops) : '-'} | ${m?.firstMs ?? '-'} | ${m ? m.lastMs : '-'} | ${m ? `${m.input}/${m.output}` : '-'} | ${r.notes} | ${r.frames} |`);
    }
  }
  const total = (side) => results.filter((r) => r.side === side).reduce((t, r) => ({ runs: t.runs + 1, notes: t.notes + r.notes, actions: t.actions + (r.metrics?.actions ?? 0), failed: t.failed + (r.exit === 0 ? 0 : 1) }), { runs: 0, notes: 0, actions: 0, failed: 0 });
  lines.push('', '| side | runs | failed | actions | log notes |', '|---|---|---|---|---|');
  for (const side of SIDES) { const t = total(side); lines.push(`| ${side} | ${t.runs} | ${t.failed} | ${t.actions} | ${t.notes} |`); }
  lines.push('', 'The frames of each question are side by side in sheets/<question>.png (middle and last frame; before left, after right). These are numbers for orientation; the frames are what to judge.');
  return `${lines.join('\n')}\n`;
}

function ffmpegPath() {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8' });
  return probe.status === 0 ? probe.stdout.split(/\r?\n/)[0].trim() : undefined;
}

const framesOf = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')).sort().map((f) => join(dir, f)) : []);

function sheetFor(ffmpeg, before, after, file) {
  const pick = (frames) => (frames.length === 0 ? [] : [frames[Math.floor((frames.length - 1) / 2)], frames[frames.length - 1]]);
  const [b, a] = [pick(before), pick(after)];
  if (b.length === 0 || a.length === 0) return false;
  const run = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', b[0], '-i', a[0], '-i', b[1], '-i', a[1], '-filter_complex',
    '[0]scale=960:-1[p0];[1]scale=960:-1[p1];[2]scale=960:-1[p2];[3]scale=960:-1[p3];[p0][p1][p2][p3]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0', '-frames:v', '1', file], { encoding: 'utf8' });
  return run.status === 0;
}

const claudeOk = (m) => /^claude-(haiku|sonnet)-5-5$/.test(String(m));

/** The route check, as the app reads the settings: the route and models named, an executable that exists, no warning. */
export async function routeCheck(root, settingsFile) {
  const { loadSettings } = await import(pathToFileURL(join(root, 'src/main/settings.ts')).href);
  const warnings = [];
  const settings = loadSettings(settingsFile, (m) => warnings.push(m));
  const command = settings.claudeCommand;
  const codex = settings.model === 'codex';
  const present = typeof command === 'string' && command !== '' && existsSync(command);
  const ok = warnings.length === 0 && (codex ? settings.codexModel === 'gpt-6-luna' : claudeOk(settings.claudeModel) && (!settings.claudeLaterModel || claudeOk(settings.claudeLaterModel)) && present);
  const text = codex ? `codex ${settings.codexModel}` : `claude ${settings.claudeModel}${settings.claudeLaterModel ? ` then ${settings.claudeLaterModel}` : ''}, executable ${present ? 'present' : typeof command === 'string' && command ? 'MISSING' : 'unset'}`;
  return { ok, text: warnings.length > 0 ? `${text}; warnings: ${warnings.join(' | ')}` : text };
}

async function guideLength(root) {
  try { return (await import(pathToFileURL(join(root, 'src/scene/index.ts')).href)).sceneGuide.length; } catch { return undefined; }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fail = (message) => { console.error(message); process.exit(2); };
  const dirs = {};
  for (const side of SIDES) {
    const d = args.get(side);
    if (!d || d === 'yes') fail(`give --${side} <a built checkout of the app>`);
    dirs[side] = resolve(d);
    if (!existsSync(join(dirs[side], 'dist/main/main.cjs'))) fail(`${side}: ${dirs[side]} is not built (run node scripts/build.mjs there)`);
  }
  if (dirs.before === dirs.after) fail('--before and --after are the same folder');
  const live = args.get('live') === 'yes', replay = args.get('replay');
  if (live && replay) fail('--live and --replay together: choose one');
  const settingsArg = args.get('settings');
  if (!settingsArg && (live || !replay)) fail('give --settings <the settings file of the route>');
  const outArg = args.get('out');
  if (!outArg || outArg === 'yes') fail('give --out <a folder for the proof>');
  const out = resolve(outArg);
  let runs;
  try { runs = planRuns({ only: args.get('only'), repeat: Number(args.get('repeat') ?? 1) }); } catch (e) { fail(e.message); }
  if (replay) for (const id of new Set(runs.map((r) => r.id))) if (!existsSync(join(resolve(replay), `${id}.json`))) fail(`no tape for ${id} in ${replay} (use --only for the ones that have)`);

  const settingsFile = settingsArg ? resolve(settingsArg) : undefined;
  const route = settingsFile ? await routeCheck(dirs.after, settingsFile) : { ok: true, text: 'none (tapes)' };
  const guide = { before: await guideLength(dirs.before), after: await guideLength(dirs.after) };
  const mode = live ? 'live (models asked)' : replay ? 'replay of tapes (no model)' : 'plan only';
  const repeat = Number(args.get('repeat') ?? 1);
  console.log(`mode: ${mode}\nroute: ${route.text}${route.ok ? '' : live ? ' (REFUSED)' : ' (would be refused for a live run)'}\nguide: before ${guide.before}, after ${guide.after}\nruns: ${runs.length}${live ? ' (each one a paid model call)' : ''}\n${runs.map((r) => `  ${r.id} ${r.side}${repeat > 1 ? ` #${r.n}` : ''}`).join('\n')}`);
  if (!live && !replay) { console.log('\nNothing was run. Add --live yes to ask the models, or --replay <tapes> to play tapes.'); return; }
  if (live && !route.ok) fail('REFUSED: the settings do not give the route and models asked for (Haiku or Sonnet on claude with an executable that exists, or gpt-6-luna on codex); nothing was started.');

  mkdirSync(out, { recursive: true });
  const fixture = join(out, 'stand-in.png');
  writeFileSync(fixture, blankPng(1920, 1080, [236, 238, 242]));
  const env = { ...process.env, DISABLE_AUTOUPDATER: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const results = [];
  for (const r of runs) {
    const dir = join(out, r.id, `${r.side}-${r.n}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'f'), { recursive: true });
    const code = dirs[r.side];
    const tape = join(dir, 'tape.json');
    const logFile = join(dir, 'run.log');
    const fd = openSync(logFile, 'w');
    const started = Date.now();
    const run = spawnSync(join(code, 'node_modules/electron/dist/electron.exe'), [code,
      '--hidden', '--silent-voice', ...(args.get('gpu') === 'yes' ? ['--gpu'] : ['--software']), '--self-chord', '--exit-after-chord', '1',
      '--settle-seconds', args.get('settle') ?? '22', '--log-steps', '--max-seconds', args.get('max') ?? '170',
      '--capture-image', fixture, '--backdrop', fixture, '--question', r.question,
      ...(settingsFile ? ['--settings', settingsFile] : []),
      `--user-data-dir=${join(dir, 'ud')}`, '--frames-dir', join(dir, 'f'), '--frame-every', '1500',
      ...(replay ? ['--replay-answer', join(resolve(replay), `${r.id}.json`)] : ['--save-answer', tape]),
    ], { cwd: code, env, stdio: ['ignore', fd, fd], timeout: 260_000 });
    closeSync(fd);
    rmSync(join(dir, 'ud'), { recursive: true, force: true });
    const log = readFileSync(logFile, 'utf8');
    const source = replay ? join(resolve(replay), `${r.id}.json`) : tape;
    let metrics;
    try { metrics = tapeMetrics(JSON.parse(readFileSync(source, 'utf8'))); } catch { metrics = undefined; }
    const result = { ...r, exit: run.status ?? 'timeout', seconds: Math.round((Date.now() - started) / 100) / 10, metrics, notes: logNotes(log).length, frames: framesOf(join(dir, 'f')).length };
    results.push(result);
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ ...result, guide: guide[r.side] }, null, 2));
    console.log(`${r.id} ${r.side} #${r.n}: exit ${result.exit}, ${result.frames} frames, ${metrics ? `${metrics.steps} steps, ${metrics.actions} actions` : 'no tape'}, ${result.seconds}s`);
  }

  const ffmpeg = ffmpegPath();
  mkdirSync(join(out, 'sheets'), { recursive: true });
  if (!ffmpeg) console.log('no ffmpeg on the path: no side-by-side sheets (the frames are under each run)');
  else for (const id of new Set(results.map((r) => r.id))) {
    const made = sheetFor(ffmpeg, framesOf(join(out, id, 'before-1', 'f')), framesOf(join(out, id, 'after-1', 'f')), join(out, 'sheets', `${id}.png`));
    if (!made) console.log(`no sheet for ${id} (a side drew no frames)`);
  }
  writeFileSync(join(out, 'report.md'), reportMarkdown({ results, guide, route: route.text, mode }));
  console.log(`report: ${join(out, 'report.md')}`);
  process.exit(results.some((r) => r.exit !== 0) ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
