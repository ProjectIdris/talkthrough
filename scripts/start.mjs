// Builds, then launches the app. Electron is started with ELECTRON_RUN_AS_NODE removed, because
// when it is set (some tools set it) Electron runs as plain Node and never opens a window.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { ensureElectronOrExit } from './ensure-electron.mjs';
import { launchElectron } from './launch.mjs';

ensureElectronOrExit();
const build = spawnSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const electron = createRequire(import.meta.url)('electron');
launchElectron(electron, ['.', ...process.argv.slice(2)]);
