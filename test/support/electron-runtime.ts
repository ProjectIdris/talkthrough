// Never import `electron` to probe availability: its resolver can download a missing binary.
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, posix, win32 } from 'node:path';

export type ElectronRuntime = { executable: string; reason?: never } | { executable?: never; reason: string };

export function electronRuntime(options: { electronDir?: string; platform?: string; env?: NodeJS.ProcessEnv } = {}): ElectronRuntime {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  let executable: string;
  try {
    const dir = options.electronDir ?? dirname(createRequire(import.meta.url).resolve('electron/package.json'));
    const path = readFileSync(join(dir, 'path.txt'), 'utf8');
    if (!path || posix.isAbsolute(path) || win32.isAbsolute(path) || path.split(/[\\/]/).includes('..')) {
      return { reason: 'Electron executable path is invalid; reinstall Electron before desktop checks' };
    }
    executable = join(dir, 'dist', path);
    if (!statSync(executable).isFile()) return { reason: 'Electron executable is not installed' };
  } catch {
    return { reason: 'Electron executable is not installed; run node node_modules/electron/install.js before desktop checks' };
  }
  if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
    return { reason: 'Electron desktop checks need a display server (DISPLAY or WAYLAND_DISPLAY)' };
  }
  return { executable };
}
