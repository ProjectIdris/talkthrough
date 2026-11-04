// Makes sure Electron's own files are downloaded. npm 11 skips a package's install script on `npm ci`
// unless it is allowed, so a fresh clone can have the `electron` package but not the program it carries
// (`node_modules/electron/dist`); `npm start` and `npm run dist` then fail with "Electron failed to install
// correctly" or a missing electronDist. This runs the package's own installer once when that is the case.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const downloaded = (dir) => existsSync(join(dir, 'dist')) && existsSync(join(dir, 'path.txt'));

/**
 * @param {{ electronDir?: string, run?: (script: string) => number }} [options] for tests: where the
 * package is, and how the installer is run (returns its exit code).
 * @returns {boolean} true when the installer had to run.
 * @throws {Error} when the installer fails, or exits without leaving Electron's files (it does that when
 * ELECTRON_SKIP_BINARY_DOWNLOAD is set); the message says what to do.
 */
export function ensureElectron(options = {}) {
  const dir = options.electronDir ?? dirname(createRequire(import.meta.url).resolve('electron/package.json'));
  if (downloaded(dir)) return false;
  console.log('Electron has not been downloaded yet; running its installer (a one-time download).');
  const script = join(dir, 'install.js');
  const code = (options.run ?? ((file) => spawnSync(process.execPath, [file], { stdio: 'inherit' }).status ?? 1))(script);
  if (code !== 0) throw new Error("Electron's installer failed. Check your network connection, then run: node node_modules/electron/install.js");
  if (!downloaded(dir)) throw new Error("Electron's installer ran but left nothing to start (ELECTRON_SKIP_BINARY_DOWNLOAD is set?). Unset it and run: node node_modules/electron/install.js");
  return true;
}

/** For the scripts: ensure Electron, and stop with a plain message instead of a stack trace when it cannot. */
export function ensureElectronOrExit() {
  try {
    ensureElectron();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
