// Bundles the Electron main process and the overlay with esbuild into dist/.
// The main process and preload are CommonJS (.cjs) because package.json is type: module.
// Entry points that do not exist yet are skipped, so this runs from the first commit on.
import { existsSync } from 'node:fs';
import { build } from 'esbuild';

const targets = [
  { entry: 'src/main/main.ts', out: 'dist/main/main.cjs', platform: 'node', external: ['electron', 'uiohook-napi', 'get-windows'] },
  { entry: 'src/main/preload.ts', out: 'dist/main/preload.cjs', platform: 'node', external: ['electron'] },
  { entry: 'src/overlay/overlay.ts', out: 'dist/overlay/overlay.js', platform: 'browser', external: [] },
];

for (const { entry, out, platform, external } of targets) {
  if (!existsSync(entry)) {
    console.log(`skip ${entry} (not written yet)`);
    continue;
  }
  await build({ entryPoints: [entry], outfile: out, bundle: true, platform, format: platform === 'node' ? 'cjs' : 'iife', target: 'es2023', external, sourcemap: true });
  console.log(`built ${out}`);
}
