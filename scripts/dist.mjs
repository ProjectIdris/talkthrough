// `npm run dist`: builds the app, then packs the Windows installer into release/.
// Extra arguments go to electron-builder (for example `--dir` for an unpacked folder only).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { ensureElectronOrExit } from './ensure-electron.mjs';
import { checkNativeInputs } from './native-packaging.mjs';
import { shipModels } from './assets/ship.mjs';

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

if (checkNativeInputs('node_modules') !== 0) {
  throw new Error('Native debug paths must be sanitized in a disposable packaging copy before building; see docs/setup.md.');
}
ensureElectronOrExit(); // electron-builder packs the Electron in node_modules/electron/dist
run(process.execPath, ['scripts/build.mjs']);
shipModels({ strict: true, release: true }); // the installer carries the real models: refuse to pack one that cannot show them
const cli = createRequire(import.meta.url).resolve('electron-builder/cli.js');
run(process.execPath, [cli, '--win', '--x64', '--publish', 'never', ...process.argv.slice(2)]);
