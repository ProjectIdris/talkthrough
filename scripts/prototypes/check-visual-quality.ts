// Offline native rendering only. Never opens the user's screen, profile, microphone or model.
import { spawn, execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { wantsSoftware } from '../../src/main/args.ts';
import { electronRuntime } from '../../test/support/electron-runtime.ts';
import { inspectionHtml } from './visual-quality-report.ts';
import { visualFixtures, visualViews } from './visual-quality-fixtures.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let out: string | undefined, tier = 'mid', software = false;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--out' && process.argv[i + 1]) out = resolve(process.argv[++i]!);
  else if (process.argv[i] === '--tier' && process.argv[i + 1]) tier = process.argv[++i]!;
  else if (process.argv[i] === '--software') software = true;
  else throw new Error('Usage: node scripts/prototypes/check-visual-quality.ts --out NEW_DIRECTORY [--tier low|mid|high] [--software]');
}
if (!out || !['low', 'mid', 'high'].includes(tier)) throw new Error('A new output directory and valid tier are required');
const requestedRenderingMode = wantsSoftware({ software }) ? 'software' : 'default';
// Keep each evidence set intact: never mix new diagnostics with stale successful screenshots.
if (existsSync(out)) throw new Error('Output directory already exists; choose a new directory for this run');
mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'tt-visual-quality-'));
const assets = join(work, 'assets'), output = join(work, 'output'), profile = join(work, 'profile');
mkdirSync(output); mkdirSync(profile);
const sourceHashes: Record<string, string> = {};
const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
let diagnostic = '', report: Record<string, any> = { status: 'failed', requestedRenderingMode, nativeVisualAcceptance: null, modelCalled: false, captures: [] };
try {
  const headless = process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
  const runtime = electronRuntime({ env: { ...process.env, ...(headless ? { DISPLAY: 'headless-probe' } : {}) } });
  if (!runtime.executable) throw new Error(runtime.reason);
  const overlay = await build({ absWorkingDir: root, entryPoints: ['src/overlay/overlay.ts'], outfile: join(assets, 'overlay.js'), bundle: true, platform: 'browser', format: 'iife', target: 'es2023', metafile: true });
  for (const file of Object.keys(overlay.metafile.inputs)) if (!file.startsWith('node_modules/')) sourceHashes[file] = hash(join(root, file));
  await build({ entryPoints: [join(root, 'src/main/preload.ts')], outfile: join(assets, 'preload.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'es2023' });
  copyFileSync(join(root, 'src/overlay/index.html'), join(assets, 'index.html'));
  const executable = join(work, 'visual-check.cjs');
  const worker = await build({ absWorkingDir: root, entryPoints: ['scripts/prototypes/visual-quality-electron.ts'], outfile: executable, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'es2023', metafile: true });
  for (const file of Object.keys(worker.metafile.inputs)) if (!file.startsWith('node_modules/')) sourceHashes[file] = hash(join(root, file));
  for (const file of ['src/overlay/index.html', 'src/main/preload.ts', 'src/main/args.ts', 'test/support/electron-profile-guard.cjs', 'test/support/electron-runtime.ts', 'package-lock.json', ...readdirSync(join(root, 'scripts/prototypes')).filter(f => /^(visual-quality-|check-visual-quality)/.test(f)).map(f => 'scripts/prototypes/' + f)]) sourceHashes[file] = hash(join(root, file));
  const env = { ...process.env, TT_VISUAL_ROOT: root, TT_VISUAL_WORK: work, TT_VISUAL_TIER: tier, TT_VISUAL_RENDERING_MODE: requestedRenderingMode, TT_TEST_PROFILE: profile, XDG_CACHE_HOME: join(work, 'cache'), GSETTINGS_BACKEND: 'memory' };
  for (const key of Object.keys(env)) if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete (env as NodeJS.ProcessEnv)[key];
  const args = [executable, `--user-data-dir=${profile}`, ...(headless ? ['--ozone-platform=headless', '--ozone-override-screen-size=800,600'] : [])];
  const child = spawn(runtime.executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const collect = (data: Buffer) => { diagnostic = (diagnostic + data.toString()).slice(-32_000); };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  let force: ReturnType<typeof setTimeout> | undefined;
  const timeout = setTimeout(() => { child.kill(); force = setTimeout(() => child.kill('SIGKILL'), 2_000); }, 70_000);
  let code: number | null;
  try { code = await new Promise<number | null>((done, fail) => { child.once('error', fail); child.once('close', done); }); }
  finally { clearTimeout(timeout); clearTimeout(force); }
  if (!existsSync(join(output, 'native-result.json'))) throw new Error(`Electron did not return a report (exit ${code}); see native.log`);
  report = JSON.parse(readFileSync(join(output, 'native-result.json'), 'utf8'));
  if (!((code === 0 && report.status === 'passed-smoke-checks') || (code === 2 && report.status === 'unsupported') || (code === 1 && report.status === 'failed'))) throw new Error(`Electron exit ${code} disagrees with report status ${report.status}`);
  report.execution = { headless, ozone: headless ? 'headless' : 'default', sandbox: true, gpuOverride: false, requestedRenderingMode };
  report.buildHashes = { ...Object.fromEntries(['index.html', 'preload.cjs', 'overlay.js'].map(f => [f, hash(join(assets, f))])), 'visual-check.cjs': hash(executable) };
} catch (error) { report.status = 'failed'; report.reason = String(error); }
finally {
  report.requestedRenderingMode = requestedRenderingMode;
  report.sourceHashes = sourceHashes;
  try { report.git = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) }; } catch { report.git = null; }
  report.fixtures = visualFixtures.map(f => ({ ...f, sha256: createHash('sha256').update(JSON.stringify(f.scene)).digest('hex') }));
  report.views = visualViews;
  for (const file of readdirSync(output).filter(f => f.endsWith('.png'))) copyFileSync(join(output, file), join(out, file));
  writeFileSync(join(out, 'native.log'), diagnostic);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(out, 'inspection.html'), inspectionHtml({ status: String(report.status), captures: report.captures }));
  rmSync(work, { recursive: true, force: true });
}
console.log(JSON.stringify({ status: report.status, reason: report.reason ?? null, captures: report.captures.length, requestedRenderingMode, nativeVisualAcceptance: null, report: join(out, 'report.json') }, null, 2));
process.exitCode = report.status === 'passed-smoke-checks' ? 0 : report.status === 'unsupported' ? 2 : 1;
