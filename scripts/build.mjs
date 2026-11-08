// Bundles the Electron main process, the preload scripts, the overlay and the audio page with
// esbuild into dist/. The main process and preloads are CommonJS (.cjs) because package.json is
// type: module. Entry points that do not exist yet are skipped.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { build } from 'esbuild';
import { shipModels } from './assets/ship.mjs';

const node = { platform: 'node', format: 'cjs' };
const browser = { platform: 'browser', format: 'iife' };
const targets = [
  { entry: 'src/main/main.ts', out: 'dist/main/main.cjs', ...node, external: ['electron', 'uiohook-napi', 'get-windows'] },
  { entry: 'src/main/front-window-worker.ts', out: 'dist/main/front-window-worker.cjs', ...node, external: ['get-windows'] },
  { entry: 'src/main/preload.ts', out: 'dist/main/preload.cjs', ...node, external: ['electron'] },
  { entry: 'src/main/audio-preload.ts', out: 'dist/main/audio-preload.cjs', ...node, external: ['electron'] },
  { entry: 'src/main/visual-tour-preload.ts', out: 'dist/main/visual-tour-preload.cjs', ...node, external: ['electron'] },
  { entry: 'src/tour/tour.ts', out: 'dist/tour/tour.js', ...browser, external: [] },
  { entry: 'src/main/settings-preload.ts', out: 'dist/main/settings-preload.cjs', ...node, external: ['electron'] },
  { entry: 'src/settings/settings.ts', out: 'dist/settings/settings.js', ...browser, external: [] },
  { entry: 'src/firstrun/firstrun.ts', out: 'dist/firstrun/firstrun.js', ...browser, external: [] },
  { entry: 'src/overlay/overlay.ts', out: 'dist/overlay/overlay.js', ...browser, external: [] },
  { entry: 'src/audio/audio.ts', out: 'dist/audio/audio.js', ...browser, external: [] },
];
const pages = [
  ['src/overlay/index.html', 'dist/overlay/index.html'],
  ['src/audio/index.html', 'dist/audio/index.html'],
  ['src/settings/index.html', 'dist/settings/index.html'],
  ['src/firstrun/index.html', 'dist/firstrun/index.html'],
  ['src/tour/index.html', 'dist/tour/index.html'],
  ['src/shared/glass.css', 'dist/shared/glass.css'],
];

for (const { entry, out, platform, format, external } of targets) {
  if (!existsSync(entry)) {
    console.log(`skip ${entry} (not written yet)`);
    continue;
  }
  await build({ entryPoints: [entry], outfile: out, bundle: true, platform, format, target: 'es2023', external, sourcemap: true, logLevel: 'warning' });
  console.log(`built ${out}`);
}
for (const [from, to] of pages) {
  if (!existsSync(from)) {
    console.log(`skip ${from} (not written yet)`);
    continue;
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`copied ${to}`);
}
const models = shipModels();
if (models.shipped.length) console.log('copied models', models.shipped.join(', '));
