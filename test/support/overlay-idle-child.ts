// Run by main-overlay-idle.test.ts in its own process with --experimental-test-module-mocks: the real overlay manager (src/main/overlay-windows.ts) over a
// stand-in for Electron, with the clock under our hand. No window is ever made. It prints what the stand-in saw, as JSON, for the test to judge.

import { mock } from 'node:test';

type Call = [string, ...unknown[]];
const log: Call[] = [];
const handlers = new Map<string, Array<(event: { sender: unknown }, ...args: unknown[]) => void>>();

class FakeWebContents {
  static next = 100;
  id = FakeWebContents.next++;
  send(...args: unknown[]): void {
    const name = (a: unknown): unknown => {
      if (!a || typeof a !== 'object' || !('kind' in a)) return a;
      const m = a as { kind: string; status?: string };
      return m.status ? `${m.kind}:${m.status}` : m.kind;
    };
    log.push([`page${this.id}.send`, ...args.map(name)]);
  }
  setAudioMuted(): void {}
  setWindowOpenHandler(): void {}
  on(): void {}
  isDestroyed(): boolean { return false; }
}

class FakeWindow {
  static all: FakeWindow[] = [];
  webContents = new FakeWebContents();
  bounds: { x: number; y: number; width: number; height: number };
  visible = false;
  readonly once$ = new Map<string, () => void>();
  constructor(options: { x: number; y: number; width: number; height: number }) {
    this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
    FakeWindow.all.push(this);
  }
  get tag(): string { return `window${this.webContents.id}`; }
  setAlwaysOnTop(): void {}
  setIgnoreMouseEvents(): void {}
  setContentProtection(on: boolean): void { log.push([`${this.tag}.protect`, on]); }
  on(): void {}
  once(event: string, fn: () => void): void { this.once$.set(event, fn); }
  loadFile(): Promise<void> { return Promise.resolve(); }
  showInactive(): void { this.visible = true; log.push([`${this.tag}.show`]); }
  hide(): void { this.visible = false; log.push([`${this.tag}.hide`]); }
  setBounds(b: { x: number; y: number; width: number; height: number }): void { this.bounds = b; log.push([`${this.tag}.bounds`, b.width, b.height]); }
  getBounds(): { x: number; y: number; width: number; height: number } { return this.bounds; }
  isDestroyed(): boolean { return false; }
  isVisible(): boolean { return this.visible; }
  isAlwaysOnTop(): boolean { return true; }
  isFocusable(): boolean { return false; }
  destroy(): void {}
}

const displays = [
  { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
  { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
];

mock.module('electron', {
  namedExports: {
    BrowserWindow: FakeWindow,
    globalShortcut: { register: () => true, unregister: () => undefined },
    ipcMain: { on: (channel: string, fn: (event: { sender: unknown }, ...args: unknown[]) => void) => { handlers.set(channel, [...(handlers.get(channel) ?? []), fn]); } },
    screen: { getAllDisplays: () => displays, getCursorScreenPoint: () => ({ x: 0, y: 0 }), on: () => undefined, off: () => undefined },
  },
});

mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });

const { createOverlayManager } = await import('../../src/main/overlay-windows.ts');
const { CHANNEL } = await import('../../src/shared/ipc.ts');

const mode = process.argv[2] ?? 'normal';
let busy = false;
const manager = createOverlayManager({
  preload: 'preload.js', page: 'overlay.html', hideFromCapture: true, globalKeys: false,
  ...(mode === 'hidden' ? { hidden: true } : {}),
  ...(mode === 'backdrop' ? { backdrop: 'page.png' } : {}),
  answerBusy: () => busy,
});
manager.start();

const emit = (channel: string, window: FakeWindow, ...args: unknown[]): void => { for (const fn of handlers.get(channel) ?? []) fn({ sender: window.webContents }, ...args); };
const [one, two] = FakeWindow.all as [FakeWindow, FakeWindow];
for (const w of FakeWindow.all) { w.once$.get('ready-to-show')?.(); emit(CHANNEL.ready, w); }

let revision = 0;
const snapshot = (regions: Array<{ id: string; kind: string; alpha: number }>) => ({
  version: 1, revision: ++revision, units: 'css-px', width: 1920, height: 1080,
  regions: regions.map((r) => ({ ...r, shape: { type: 'rect', x: 10, y: 10, w: 100, h: 40 } })),
});
const mark = (label: string): void => { log.push(['--', label]); };
const wait = (ms: number): void => { for (let t = 0; t < ms; t += 250) mock.timers.tick(250); };

const steps: Record<string, () => void> = {
  normal() {
    mark('idle at start');
    wait(5000);
    mark('a question starts');
    manager.send(1, { kind: 'status', status: 'hush' });
    manager.send(1, { kind: 'status', status: 'listening' });
    emit(CHANNEL.visibleRegions, one, snapshot([{ id: 'status', kind: 'pill', alpha: 1 }]));
    wait(5000);
    mark('the answer draws');
    emit(CHANNEL.visibleRegions, one, snapshot([{ id: 'model-geometry', kind: 'content', alpha: 1 }, { id: 'caption', kind: 'content', alpha: 0.6 }]));
    emit(CHANNEL.showing, one, true);
    busy = true;
    wait(10000);
    mark('the answer is over, the drawing still up');
    busy = false;
    wait(5000);
    mark('the drawing is gone');
    emit(CHANNEL.showing, one, false);
    emit(CHANNEL.visibleRegions, one, snapshot([]));
    wait(500);
    mark('a pause shorter than the grace');
    wait(700);
    mark('past the grace');
    manager.send(1, { kind: 'clear' });
    manager.send(1, { kind: 'dismiss' });
    wait(3000);
    mark('a clear or dismiss never raises it');
    busy = true;
    wait(3000);
    mark('busy alone never raises it');
    busy = false;
    manager.send(1, { kind: 'step-open', say: 'hello' });
    mark('a step raises it again');
    wait(4000);
    mark('a step that drew nothing lets it go');
    manager.setPen(1);
    mark('the pen is on');
    wait(2000);
    manager.setPen(null);
    wait(1000);
    mark('the pen is off, its stroke fading');
    wait(4000);
    mark('the stroke is gone');
    manager.send(1, { kind: 'status', status: 'waiting' });
    emit(CHANNEL.visibleRegions, one, snapshot([{ id: 'guide-target', kind: 'guide-target', alpha: 1 }, { id: 'status', kind: 'pill', alpha: 1 }]));
    wait(30000);
    mark('a guide step waits for the click');
    emit(CHANNEL.visibleRegions, one, snapshot([]));
    wait(1500);
    mark('the guide step is over');
    manager.send(1, { kind: 'play', scene: { v: 1, steps: [] }, turn: 1 } as never);
    mark('a fresh play on display 1 clears display 2 and leaves it down');
    wait(0);
  },
  hidden() {
    manager.send(1, { kind: 'status', status: 'listening' });
    emit(CHANNEL.visibleRegions, one, snapshot([{ id: 'status', kind: 'pill', alpha: 1 }]));
    wait(2000);
  },
  backdrop() {
    wait(10000);
  },
};
steps[mode]?.();
manager.dispose();
void two;
console.log(JSON.stringify(log));
