// The window in front, for the list of windows to skip (skip-list.ts). Read by name, program file and title only, on demand, and not
// kept. The read is done in a worker thread (front-window-worker.ts), so a read that hangs cannot freeze the app; whoever asks gives up
// after a deadline. If the reader will not load or stops, every read fails (which the skip check treats as "do not look"), and the
// reader is started again on a later read, at most every few seconds.

import { Worker } from 'node:worker_threads';
import { SKIP_DEADLINE_MS } from './skip-list.ts';
import type { FrontWindow } from './skip-list.ts';

export type FrontWindowReader = {
  /** The window in front now. Rejects if the reader is not there or says it failed; may never settle if the read hangs (the caller times out). */
  read(): Promise<FrontWindow | null>;
  dispose(): void;
};

type Pending = { resolve(w: FrontWindow | null): void; reject(e: Error): void; miss?: ReturnType<typeof setTimeout> };

/** How long a reader that stopped is left before it is started again. */
const RESTART_AFTER_MS = 5000;
/** A reader that misses this many reads in a row (no answer within the deadline each time) is stopped and replaced on the next read. */
export const MISSES_BEFORE_REPLACING = 3;
/** A reader that has this many answers owing is not asked more (the oldest are dropped): a hung one must not pile them up. */
const PENDING_MAX = 20;

export function createFrontWindowReader(options: { file: string; log?(line: string): void; now?(): number; start?(file: string): Worker; /** How long a read may take before it counts as missed. Default: the skip check's deadline. */ missAfterMs?: number }): FrontWindowReader {
  const missAfterMs = options.missAfterMs ?? SKIP_DEADLINE_MS;
  let misses = 0;
  const now = options.now ?? (() => Date.now());
  const start = options.start ?? ((file: string) => new Worker(file));
  const log = options.log ?? (() => undefined);
  let worker: Worker | null = null;
  let ready = false;
  let failure: string | null = null;
  let lastStart = -Infinity;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  const failAll = (why: string): void => {
    for (const p of pending.values()) {
      if (p.miss) clearTimeout(p.miss);
      p.reject(new Error(why));
    }
    pending.clear();
  };

  function launch(): void {
    lastStart = now();
    failure = null;
    ready = false;
    misses = 0;
    let w: Worker;
    try {
      w = start(options.file);
    } catch (error) {
      failure = error instanceof Error ? error.message : 'the reader would not start';
      return;
    }
    worker = w;
    const gone = (why: string): void => {
      if (worker !== w) return;
      worker = null;
      ready = false;
      failure = why;
      failAll(why);
    };
    w.on('message', (m: { id?: number; window?: FrontWindow | null; error?: string; fatal?: string; ready?: boolean }) => {
      if (m.ready) {
        ready = true;
        return;
      }
      if (m.fatal) {
        gone(m.fatal);
        void w.terminate();
        return;
      }
      const p = typeof m.id === 'number' ? pending.get(m.id) : undefined;
      if (!p || typeof m.id !== 'number') return; // a late answer to a read already given up on
      pending.delete(m.id);
      if (p.miss) clearTimeout(p.miss);
      misses = 0; // it answered, so it is not stuck
      if (m.error) p.reject(new Error(m.error));
      else p.resolve(m.window ?? null);
    });
    w.on('error', (error) => gone(error.message));
    w.on('exit', () => gone('the reader stopped'));
  }

  return {
    read() {
      if (!worker && now() - lastStart >= RESTART_AFTER_MS) launch();
      if (!worker) return Promise.reject(new Error(failure ?? 'the reader is not running'));
      return new Promise<FrontWindow | null>((resolve, reject) => {
        const id = nextId++;
        if (pending.size >= PENDING_MAX) {
          const oldest = pending.keys().next().value as number;
          pending.get(oldest)?.reject(new Error('the read did not finish'));
          pending.delete(oldest);
        }
        const entry: Pending = { resolve, reject };
        const w = worker!;
        // A read that has not been answered in time is a miss; three in a row means the thread is stuck, so it is replaced (the next read starts a fresh one).
        entry.miss = setTimeout(() => {
          if (!pending.has(id) || worker !== w) return;
          if (++misses < MISSES_BEFORE_REPLACING) return;
          log(`the window reader missed ${misses} reads in a row; replacing it`);
          worker = null;
          ready = false;
          failure = 'the reader was stuck and was stopped';
          lastStart = -Infinity; // the next read starts a fresh one at once
          failAll(failure);
          void w.terminate();
        }, missAfterMs);
        pending.set(id, entry);
        w.postMessage({ id });
      });
    },
    dispose() {
      const w = worker;
      worker = null;
      failAll('the reader was closed');
      void w?.terminate();
    },
  };
}
