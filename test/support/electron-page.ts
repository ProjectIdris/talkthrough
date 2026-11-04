// Starts test/support/nav-page.cjs (a web page of our own in an Electron window) with a profile folder of its own, so two
// of them can run at once, and reports where its controls are. The folder is removed when it is stopped.

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const electronExe = resolve('node_modules/electron/dist/electron.exe');
export const haveElectron = existsSync(electronExe);

export type Page = {
  hwnd: number;
  /** x, y, w, h in screen pixels, by the page's data-t names. */
  rects: Record<string, [number, number, number, number]>;
  /** The paths the page's own server was asked for, in order. */
  requests: string[];
  at(name: string): { x: number; y: number };
  stop(): void;
};

export function startPage(): Promise<Page> {
  const profile = mkdtempSync(join(tmpdir(), 'tt-page-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
  env.TT_TEST_PROFILE = profile;
  const child: ChildProcess = spawn(electronExe, [resolve('test/support/nav-page.cjs')], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  const requests: string[] = [];
  const stop = (): void => {
    child.kill();
    setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch { /* still in use: the system clears its temp */ } }, 1500).unref();
  };
  return new Promise((resolvePage, reject) => {
    let text = '';
    const timer = setTimeout(() => { stop(); reject(new Error('the test page did not start')); }, 40000);
    child.on('error', (e) => { clearTimeout(timer); stop(); reject(e); });
    child.stdout!.on('data', (d: Buffer) => {
      text += d.toString();
      for (const m of text.matchAll(/EVENT GET (\S+)/g)) if (!requests.includes(m[1]!)) requests.push(m[1]!);
      const m = /READY (\d+) (.*)/.exec(text);
      if (!m) return;
      clearTimeout(timer);
      child.stdout!.removeAllListeners('data');
      child.stdout!.on('data', (more: Buffer) => { for (const g of more.toString().matchAll(/EVENT GET (\S+)/g)) if (!requests.includes(g[1]!)) requests.push(g[1]!); });
      const rects = Object.fromEntries(m[2]!.trim().split(';').map((s) => { const [k, ...n] = s.split(','); return [k!, n.map(Number) as [number, number, number, number]]; }));
      resolvePage({ hwnd: Number(m[1]), rects, requests, at: (name) => ({ x: rects[name]![0] + rects[name]![2] / 2, y: rects[name]![1] + rects[name]![3] / 2 }), stop });
    });
  });
}
