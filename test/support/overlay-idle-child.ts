// Run by main-overlay-idle.test.ts in its own process with --experimental-test-module-mocks: the real overlay manager (src/main/overlay-windows.ts) over a
// stand-in for Electron, with the clock under our hand. No window is ever made. It prints what the stand-in saw, as JSON, for the test to judge.

import { mock } from 'node:test';

type Call = [string, ...unknown[]];
const log: Call[] = [];
const handlers = new Map<string, Array<(event: { sender: unknown }, ...args: unknown[]) => void>>();
const screenHandlers = new Map<string, () => void>();
/** The 'throws' mode: setting a window's mouse state fails while this is true. */
let throwing = false;

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
  readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  on(event: string, fn: (...args: unknown[]) => void): void { this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn]); }
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
  /** What the window really does with the mouse, which the manager cannot read back: the stand-in lets a test change it behind the manager's back. */
  realIgnore = true;
  setIgnoreMouseEvents(ignore: boolean): void { if (process.argv[2] === 'throws' && throwing) throw new Error('the system refused'); this.realIgnore = ignore; if (process.argv[2] === 'pen' || process.argv[2] === 'drift') log.push([`${this.tag}.ignore`, ignore]); }
  setContentProtection(on: boolean): void { log.push([`${this.tag}.protect`, on]); }
  on(): void {}
  once(event: string, fn: () => void): void { this.once$.set(event, fn); }
  loadFile(): Promise<void> { return Promise.resolve(); }
  showInactive(): void { this.visible = true; if (process.argv[2] === 'drift') this.realIgnore = true; log.push([`${this.tag}.show`]); }
  hide(): void { this.visible = false; log.push([`${this.tag}.hide`]); }
  setBounds(b: { x: number; y: number; width: number; height: number }): void { this.bounds = b; if (process.argv[2] === 'drift') this.realIgnore = true; log.push([`${this.tag}.bounds`, b.width, b.height]); }
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
    screen: { getAllDisplays: () => displays, getCursorScreenPoint: () => ({ x: 0, y: 0 }), on: (event: string, fn: () => void) => { screenHandlers.set(event, fn); }, off: () => undefined },
  },
});

mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });

const { createOverlayManager } = await import('../../src/main/overlay-windows.ts');
const { CHANNEL } = await import('../../src/shared/ipc.ts');
const { createCaptureShield } = await import('../../src/main/capture-shield.ts');

const mode = process.argv[2] ?? 'normal';
const shield = createCaptureShield({ enabled: true, wait: async () => { log.push(['settle']); } });
let busy = false;
const manager = createOverlayManager({
  preload: 'preload.js', page: 'overlay.html', shield, globalKeys: false,
  ...(mode === 'hidden' ? { hidden: true } : {}),
  ...(mode === 'backdrop' ? { backdrop: 'page.png' } : {}),
  answerBusy: () => busy,
  onStroke: (displayId, stroke) => { log.push(['stroke', displayId, stroke.id]); },
  onPenRefused: (displayId, why) => { log.push(['refused', displayId, why]); },
  onMouseState: (line) => { log.push(['mouse', line]); },
  onFollowup: (_displayId, command) => { if (command === 'dismiss') manager.dismissAll(); },
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
  pen() {
    // An answer is up and the page owns the background; a click on it dismisses; the next chord takes the pen and the window takes the mouse; strokes
    // reach the program while it is on and, once, a refusal is reported if the page keeps sending them after it is off.
    manager.send(1, { kind: 'play', scene: { v: 1, steps: [] }, turn: 1 } as never);
    emit(CHANNEL.visibleRegions, one, snapshot([{ id: 'model-geometry', kind: 'content', alpha: 1 }]));
    emit(CHANNEL.showing, one, true);
    wait(1000);
    mark('the background is pressed');
    emit(CHANNEL.pointerHeld, one, true);
    emit(CHANNEL.followup, one, 'dismiss');
    emit(CHANNEL.pointerHeld, one, false);
    emit(CHANNEL.visibleRegions, one, snapshot([]));
    emit(CHANNEL.showing, one, false);
    wait(3000);
    mark('the answer is dismissed');
    manager.setPen(1);
    mark('the pen is on');
    emit(CHANNEL.stroke, one, { id: 1, points: [[10, 10], [20, 20]], done: true });
    wait(500);
    manager.setPen(null);
    emit(CHANNEL.stroke, one, { id: 2, points: [[10, 10]], done: true });
    mark('a stroke right after the pen went off');
    wait(2000);
    emit(CHANNEL.stroke, one, { id: 3, points: [[10, 10]], done: true });
    emit(CHANNEL.stroke, one, { id: 4, points: [[10, 10]], done: true });
    mark('strokes long after the pen went off');
    manager.setPen(1);
    wait(500);
    manager.setPen(null);
    wait(2000);
    emit(CHANNEL.stroke, one, { id: 5, points: [[10, 10]], done: true });
    mark('the end');
  },
  throws() {
    // Setting the state keeps failing, with a drawing up and the pointer moving: the record says so once for each show of the window, not at each try (every 25 ms).
    manager.send(1, { kind: 'play', scene: { v: 1, steps: [] }, turn: 1 } as never);
    emit(CHANNEL.visibleRegions, one, snapshot([{ id: 'model-geometry', kind: 'content', alpha: 1 }]));
    emit(CHANNEL.showing, one, true);
    throwing = true;
    manager.setPen(1);
    wait(5000);
    mark('five seconds of failing');
    emit(CHANNEL.showing, one, false);
    emit(CHANNEL.visibleRegions, one, snapshot([]));
    manager.setPen(null);
    wait(5000);
    mark('the pen is off and the window down');
    manager.setPen(1);
    wait(5000);
    mark('shown again, failing again');
    throwing = false;
    wait(1500);
    log.push(['real', one.realIgnore]);
    mark('it works again');
  },
  drift() {
    // The window's real mouse state is changed behind the manager's back (a show, a new size, the system's own doing): the manager never leaves it so.
    manager.send(1, { kind: 'play', scene: { v: 1, steps: [] }, turn: 1 } as never);
    manager.setPen(1);
    log.push(['real', one.realIgnore]);
    mark('the pen is on');
    one.realIgnore = true;
    wait(1250);
    log.push(['real', one.realIgnore]);
    mark('it was undone, and a second later');
    screenHandlers.get('display-metrics-changed')?.();
    log.push(['real', one.realIgnore]);
    mark('the display changed');
    for (const l of one.webContents.listeners.get('before-mouse-event') ?? []) { l({}, { type: 'mouseDown' }); l({}, { type: 'mouseMove' }); l({}, { type: 'mouseMove' }); }
    manager.setPen(null);
    wait(5000);
    mark('the pen is off and the window down');
    manager.setPen(1);
    log.push(['real', one.realIgnore]);
    mark('the pen is on again');
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
if (mode === 'shield') {
  // A capture of ours while the answer is up on display 1 (and display 2's window is down): every window is out of it for the read, and only then.
  manager.send(1, { kind: 'status', status: 'listening' });
  emit(CHANNEL.visibleRegions, one, snapshot([{ id: 'status', kind: 'pill', alpha: 1 }]));
  mark('before the capture');
  await shield.around(async (settled) => {
    mark('the capture starts');
    await settled;
    log.push(['read']);
  });
  mark('after the capture');
}
steps[mode]?.();
manager.dispose();
void two;
console.log(JSON.stringify(log));
