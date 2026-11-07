// Offline only. No model, microphone, user's screen, credentials or network route is opened.
// node scripts/prototypes/benchmark-first-visual.ts [--entries 21|1000|10000] [--out directory]
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { partCards } from './catalogue-parts.ts';
import { electronRuntime } from '../../test/support/electron-runtime.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let entries = 21;
let out: string | undefined;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--entries') entries = Number(process.argv[++i]);
  else if (arg === '--out' && process.argv[i + 1]) out = resolve(process.argv[++i]!);
  else throw new Error('usage: benchmark-first-visual.ts [--entries 21|1000|10000] [--out directory]');
}
if (![21, 1_000, 10_000].includes(entries)) throw new Error('entries must be 21, 1000 or 10000');
// Headless Ozone supports the offscreen 2D compositor without changing sandbox/GPU security.
const headless = process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
const runtime = electronRuntime({ env: { ...process.env, ...(headless ? { DISPLAY: 'headless-probe' } : {}) } });
if (!runtime.executable) throw new Error(runtime.reason);
const work = mkdtempSync(join(tmpdir(), 'tt-first-visual-'));
const profile = join(work, 'profile');
mkdirSync(profile);
try {
  const cards = entries === 21 ? partCards : Array.from({ length: entries }, (_, i) => ({ ...partCards[i % partCards.length]!, id: `item${i}` }));
  writeFileSync(join(work, 'catalogue.json'), JSON.stringify(cards));
  // Rebuild this checkout's actual renderer/preload privately, with no shared dist dependency.
  const assets = join(work, 'assets');
  await build({ entryPoints: [join(root, 'src/overlay/overlay.ts')], outfile: join(assets, 'overlay.js'), bundle: true, platform: 'browser', format: 'iife', target: 'es2023' });
  await build({ entryPoints: [join(root, 'src/main/preload.ts')], outfile: join(assets, 'preload.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'es2023' });
  copyFileSync(join(root, 'src/overlay/index.html'), join(assets, 'index.html'));
  const executable = join(work, 'probe.cjs');
  await build({ entryPoints: [join(root, 'scripts/prototypes/first-visual-electron.ts')], outfile: executable, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'es2023' });
  const env: NodeJS.ProcessEnv = { ...process.env, TT_PROBE_ROOT: root, TT_PROBE_WORK: work, TT_TEST_PROFILE: profile, XDG_CACHE_HOME: join(work, 'cache'), GSETTINGS_BACKEND: 'memory' };
  for (const key of Object.keys(env)) if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete env[key as keyof typeof env];
  const child = spawn(runtime.executable, [executable, `--user-data-dir=${profile}`, ...(headless ? ['--ozone-platform=headless', '--ozone-override-screen-size=640,480'] : [])], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostic = '';
  const collect = (buffer: Buffer) => { diagnostic = (diagnostic + buffer.toString()).slice(-16_000); };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  let forceStop: ReturnType<typeof setTimeout> | undefined;
  const timeout = setTimeout(() => {
    child.kill();
    forceStop = setTimeout(() => child.kill('SIGKILL'), 2_000);
  }, 25_000);
  try {
    const code = await new Promise<number | null>((done, fail) => { child.once('error', fail); child.once('exit', done); });
    if (code !== 0 || !existsSync(join(work, 'result.json'))) throw new Error(`renderer probe failed (${code}): ${diagnostic}`);
  } finally { clearTimeout(timeout); clearTimeout(forceStop); }
  const report = readFileSync(join(work, 'result.json'), 'utf8');
  if (out) {
    mkdirSync(out, { recursive: true });
    for (const file of ['result.json', 'first-paint.png']) copyFileSync(join(work, file), join(out, file));
  }
  console.log(report);
} finally { rmSync(work, { recursive: true, force: true }); }
