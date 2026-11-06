// Keep startup failures visible to npm and callers, including an Electron process killed by a signal.
import { spawn } from 'node:child_process';

export function launchElectron(executable, args, options = {}) {
  const env = { ...(options.env ?? process.env) };
  delete env.ELECTRON_RUN_AS_NODE;
  const error = options.error ?? console.error;
  const exit = options.exit ?? ((code) => process.exit(code));
  let finished = false;
  const finish = (code) => {
    if (finished) return;
    finished = true;
    exit(code);
  };
  const child = (options.spawn ?? spawn)(executable, args, { stdio: 'inherit', env });
  child.on('error', (cause) => {
    error(`Electron could not start: ${cause.message}`);
    finish(1);
  });
  child.on('exit', (code, signal) => {
    if (signal) error(`Electron stopped with signal ${signal}.`);
    finish(code ?? 1);
  });
  return child;
}
