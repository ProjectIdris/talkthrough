// Makes sure Electron's own files are downloaded. npm 11 skips a package's install script on `npm ci`
// unless it is allowed, so a fresh clone can have the `electron` package but not the program it carries
// (`node_modules/electron/dist`); `npm start` and `npm run dist` then fail with "Electron failed to install
// correctly" or a missing electronDist. This runs the package's own installer once when that is the case.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * @param {{ electronDir?: string, run?: (script: string) => number }} [options] for tests: where the
 * package is, and how the installer is run (returns its exit code).
 * @returns {boolean} true when the installer had to run.
 */
export function ensureElectron(options = {}) {
  const dir = options.electronDir ?? dirname(createRequire(import.meta.url).resolve('electron/package.json'));
  if (existsSync(join(dir, 'dist')) && existsSync(join(dir, 'path.txt'))) return false;
  console.log('Electron has not been downloaded yet; running its installer (a one-time download).');
  const script = join(dir, 'install.js');
  const code = (options.run ?? ((file) => spawnSync(process.execPath, [file], { stdio: 'inherit' }).status ?? 1))(script);
  if (code !== 0) {
    console.error('Electron\'s installer failed. Check your network connection, then run: node node_modules/electron/install.js');
    process.exit(code || 1);
  }
  return true;
}
