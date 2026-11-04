// Runs in a worker thread of its own: reads the window in front when asked and answers with its name, program file and title. It is
// a thread so that a read that never returns can only stop this thread, never the app; the caller gives up on it after a deadline.
//
// It loads the native part of the `get-windows` package (a .node file) directly instead of through the package's JavaScript, which
// finds the file with a helper package that a packaged app keeps inside its archive, where a file outside the archive cannot reach it.

import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';

type Reply = { id: number; window: { title?: string; appName?: string; path?: string } | null } | { id: number; error: string } | { fatal: string } | { ready: true };
type Addon = { getActiveWindow(): { title?: string; owner?: { name?: string; path?: string } } | null | undefined };

/** The package's own folder (given by the app; failing that, the one in the working folder). */
const dir: string = (workerData as { addonDir?: string } | null)?.addonDir ?? join(process.cwd(), 'node_modules', 'get-windows');

function findBinding(): string {
  const found: string[] = [];
  const bindings = join(dir, 'lib', 'binding');
  // The folder names say the platform and architecture (napi-9-win32-unknown-x64): only this computer's own is loaded.
  if (existsSync(bindings)) for (const name of readdirSync(bindings)) if (name.includes(`-${process.platform}-`) && name.endsWith(`-${process.arch}`)) found.push(join(bindings, name, 'node-get-windows.node'));
  found.push(join(dir, 'build', 'Release', 'node-get-windows.node'));
  const file = found.find((f) => existsSync(f));
  if (!file) throw new Error('the window reader has no native part to load');
  return file;
}

const port = parentPort;
if (port) {
  const send = (reply: Reply): void => port.postMessage(reply);
  try {
    const addon = createRequire(process.execPath)(findBinding()) as Addon;
    addon.getActiveWindow(); // the first read is the slow one
    port.on('message', (request: { id?: unknown }) => {
      if (typeof request?.id !== 'number') return;
      try {
        const w = addon.getActiveWindow();
        send({ id: request.id, window: w ? { title: w.title, appName: w.owner?.name, path: w.owner?.path } : null });
      } catch (error) {
        send({ id: request.id, error: error instanceof Error ? error.message : 'the read failed' });
      }
    });
    send({ ready: true });
  } catch (error) {
    send({ fatal: error instanceof Error ? error.message : 'the reader would not load' });
  }
}
