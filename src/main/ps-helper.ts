// One long-lived Windows PowerShell child that answers the app's requests about a window's controls (uia.ts reads them,
// nav.ts looks at one and, when allowed, acts). It is started once, the first time something asks, and kept for the
// session: nothing is compiled or written to disk for a request (user32 is called through an in-memory assembly, see
// ps-prelude.ts), so a request costs milliseconds after the first, and what a security tool sees is one start and not
// a new PowerShell with a compile at every key press. One request is one line of JSON in and one line of JSON out; the
// script is this app's own text and nothing the model wrote reaches it, only numbers and a few fixed words.
//
// A request that is not answered in time stops the child (it may be stuck inside the accessibility API) and the next
// request starts a fresh one. When the app quits the child is stopped, and it also ends by itself when its input closes.

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { PS_LOOP, PS_PRELUDE } from './ps-prelude.ts';
import { UIA_SCRIPT } from './uia-script.ts';
import { NAV_SCRIPT } from './nav-script.ts';

/**
 * What the helper runs, in order: the shared part, the reader, (only when the person has allowed the app to act for them) the
 * navigation functions, and the request loop. Without navigation the helper holds no verb at all: it is read-only as a whole.
 * Comment lines and indentation are dropped: the whole text travels on the command line (-EncodedCommand), which Windows limits
 * to 32,767 characters, and a helper that is too long fails to start without a word.
 */
export function helperSource(options: { nav?: boolean } = {}): string {
  const parts = [PS_PRELUDE, UIA_SCRIPT, ...(options.nav ? [NAV_SCRIPT] : []), PS_LOOP].join('\n');
  return parts.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#')).join('\n');
}

export const HELPER_SOURCE = helperSource({ nav: true });
export const HELPER_READ_SOURCE = helperSource();
/** The longest a helper may be, encoded, with room for the program path and flags under the limit. */
export const HELPER_ENCODED_MAX = 30_000;

/** The child as the client sees it: tests stand in for the real one with something that answers by itself. */
export type HelperChild = {
  write(line: string): void;
  onData(listener: (chunk: string) => void): void;
  onExit(listener: () => void): void;
  kill(): void;
};

export type HelperAnswer = { body: Record<string, unknown> | null; ms: number; why?: string };

export type Helper = {
  /** One request and its answer. Never throws: a request that fails comes back with `why` (cancelled, timed out, failed). */
  request(request: Record<string, unknown>, options: { timeoutMs: number; signal?: AbortSignal }): Promise<HelperAnswer>;
  /** Ends the child (the app is quitting, or the person turned the feature off). */
  stop(): void;
};

export type HelperOptions = {
  /** For tests: how a child is started. */
  start?: () => HelperChild;
  /** Whether the helper carries the navigation verbs (select a tab, expand a menu, scroll). Default no: it only reads. */
  nav?: boolean;
  /** Extra time the first request after a start may take, for the start itself. */
  startupMs?: number;
};

function powershellPath(): string {
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function startPowerShell(nav: boolean): HelperChild {
  const encoded = Buffer.from(nav ? HELPER_SOURCE : HELPER_READ_SOURCE, 'utf16le').toString('base64');
  const child = spawn(powershellPath(), ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encoded], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  child.stdout.setEncoding('utf8');
  child.stdin.on('error', () => undefined); // a child that is gone is noticed by its exit
  return {
    write: (line) => void child.stdin.write(line),
    onData: (listener) => void child.stdout.on('data', listener),
    onExit: (listener) => { child.on('exit', listener); child.on('error', listener); },
    kill: () => { try { child.stdin.end(); } catch { /* already closed */ } child.kill(); },
  };
}

/** The helper for this system: only Windows has one (or a test's stand-in). */
export function createHelper(options: HelperOptions = {}): Helper | undefined {
  if (process.platform !== 'win32' && !options.start) return undefined;
  const startChild = options.start ?? (() => startPowerShell(options.nav === true));
  const startupMs = options.startupMs ?? 5000;
  let child: HelperChild | null = null;
  let fresh = false;
  let buffer = '';
  let nextId = 1;
  const pending = new Map<number, { resolve: (a: HelperAnswer) => void; started: number; timer: NodeJS.Timeout }>();

  function failAll(why: string): void {
    for (const [id, p] of [...pending]) {
      pending.delete(id);
      clearTimeout(p.timer);
      p.resolve({ body: null, ms: Date.now() - p.started, why });
    }
  }

  function stopChild(why: string): void {
    const c = child;
    child = null;
    buffer = '';
    c?.kill();
    failAll(why);
  }

  function ensure(): HelperChild {
    if (child) return child;
    const c = startChild();
    child = c;
    fresh = true;
    c.onData((chunk) => {
      if (child !== c) return;
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim().replace(/^\uFEFF/, '');
        buffer = buffer.slice(nl + 1);
        let body: Record<string, unknown> | null = null;
        try {
          const parsed: unknown = JSON.parse(line);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
        } catch { /* not an answer: PowerShell's own chatter */ }
        const id = body && typeof body.id === 'number' ? body.id : undefined;
        const p = id === undefined ? undefined : pending.get(id);
        if (!p || id === undefined) continue; // an answer to a request nobody waits for any more
        pending.delete(id);
        clearTimeout(p.timer);
        p.resolve({ body, ms: Date.now() - p.started });
      }
    });
    c.onExit(() => {
      if (child === c) {
        child = null;
        buffer = '';
        failAll('failed');
      }
    });
    return c;
  }

  return {
    request(request, { timeoutMs, signal }) {
      const started = Date.now();
      if (signal?.aborted) return Promise.resolve({ body: null, ms: 0, why: 'cancelled' });
      return new Promise<HelperAnswer>((resolve) => {
        let c: HelperChild;
        try {
          c = ensure();
        } catch {
          return resolve({ body: null, ms: Date.now() - started, why: 'failed' });
        }
        const id = nextId++;
        const grace = fresh ? startupMs : 0;
        fresh = false;
        const onAbort = (): void => {
          const p = pending.get(id);
          if (!p) return;
          pending.delete(id);
          clearTimeout(p.timer);
          resolve({ body: null, ms: Date.now() - started, why: 'cancelled' }); // the child's late answer is dropped
        };
        const timer = setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          signal?.removeEventListener('abort', onAbort);
          resolve({ body: null, ms: Date.now() - started, why: 'timed out' });
          stopChild('failed'); // it may be stuck inside the accessibility API: start afresh next time
        }, timeoutMs + grace);
        timer.unref();
        pending.set(id, { resolve: (a) => { signal?.removeEventListener('abort', onAbort); resolve(a); }, started, timer });
        signal?.addEventListener('abort', onAbort, { once: true });
        try {
          c.write(`${JSON.stringify({ ...request, id })}\n`);
        } catch {
          const p = pending.get(id);
          if (p) { pending.delete(id); clearTimeout(p.timer); }
          resolve({ body: null, ms: Date.now() - started, why: 'failed' });
        }
      });
    },
    stop() {
      stopChild('cancelled');
    },
  };
}
