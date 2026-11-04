// Runs in a worker thread of its own: reads the window in front when asked and answers with its name, program file and title. It is
// a thread so that a read that never returns can only stop this thread, never the app; the caller gives up on it after a deadline.

import { parentPort } from 'node:worker_threads';

type Reply = { id: number; window: { title?: string; appName?: string; path?: string } | null } | { id: number; error: string } | { fatal: string } | { ready: true };

const port = parentPort;
if (port) {
  const send = (reply: Reply): void => port.postMessage(reply);
  void (async () => {
    try {
      const { activeWindowSync } = await import('get-windows');
      activeWindowSync(); // the first read is the slow one
      port.on('message', (request: { id?: unknown }) => {
        if (typeof request?.id !== 'number') return;
        try {
          const w = activeWindowSync();
          send({ id: request.id, window: w ? { title: w.title, appName: w.owner?.name, path: w.owner?.path } : null });
        } catch (error) {
          send({ id: request.id, error: error instanceof Error ? error.message : 'the read failed' });
        }
      });
      send({ ready: true });
    } catch (error) {
      send({ fatal: error instanceof Error ? error.message : 'the reader would not load' });
    }
  })();
}
