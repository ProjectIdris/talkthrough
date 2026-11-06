// Which of the tools Talkthrough can use for answers are on this computer: Claude Code and Codex, found by looking along the PATH for the program (the way
// a shell would), or at the path the settings name. Nothing is run, and no sign-in or key file is opened: the first question says if a tool is not signed in.

import { existsSync, statSync } from 'node:fs';
import { posix, win32 } from 'node:path';

export type FindDeps = {
  env?: NodeJS.ProcessEnv;
  platform?: string;
  /** Is there a file at this path? (For tests.) */
  isFile?: (path: string) => boolean;
};

const fileExists = (path: string): boolean => {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
};

/** Whether `command` (a program name, or a path) is there: a path is looked at as it is, a name along the PATH with each of the extensions Windows runs. */
export function onPath(command: string, deps: FindDeps = {}): boolean {
  const env = deps.env ?? process.env;
  const win = (deps.platform ?? process.platform) === 'win32';
  const path = win ? win32 : posix;
  const isFile = deps.isFile ?? fileExists;
  const exts = win ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  const candidates = (base: string): string[] => (win && /\.[a-z0-9]+$/i.test(base) ? [base] : exts.map((e) => base + e.toLowerCase()).concat(win ? exts.map((e) => base + e) : [base]));
  if (path.isAbsolute(command) || /[\\/]/.test(command)) return candidates(command).some(isFile);
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  return dirs.some((dir) => candidates(path.join(dir, command)).some(isFile));
}

export type ToolPaths = { claudeCommand?: string | undefined; codexCommand?: string | undefined };

/** Claude Code and Codex, as found. (The API key is the key store's to say.) */
export function findTools(paths: ToolPaths = {}, deps: FindDeps = {}): { claude: boolean; codex: boolean } {
  return { claude: onPath(paths.claudeCommand ?? 'claude', deps), codex: onPath(paths.codexCommand ?? 'codex', deps) };
}
