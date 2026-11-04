// Builds, then launches the app. Electron is started with ELECTRON_RUN_AS_NODE removed, because
// when it is set (some tools set it) Electron runs as plain Node and never opens a window.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { ensureElectron } from './ensure-electron.mjs';

ensureElectron();
const build = spawnSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const electron = createRequire(import.meta.url)('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
