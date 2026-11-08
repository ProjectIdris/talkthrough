import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { uIOhook } from 'uiohook-napi';
import { createGuide } from '../src/main/guide.ts';
import type { GuideListener } from '../src/main/guide.ts';
import { createGuideNavigation } from '../src/main/guide-nav.ts';
import { createNavConsent } from '../src/main/nav-consent.ts';
import { createNavigator } from '../src/main/nav.ts';
import { createHelper } from '../src/main/ps-helper.ts';
import { watchGuideInput } from '../src/main/hotkey.ts';
import { GRID_COLS, GRID_ROWS } from '../src/shared/screen-diff.ts';
import type { Step } from '../src/scene/index.ts';
import { openNavWindow } from './support/nav-window.ts';

// HELD: these send real mouse input (the pointer is moved onto a window the test makes, and its wheel is turned) and read the
// system's real input hook. They run only when asked, and only when nobody is at the machine:
//   EXPLAINER_REAL_INPUT=1 node --test test/main-guide-real-input.test.ts
// Everything is done to windows the test creates; nothing of anyone else's is touched.

const enabled = process.platform === 'win32' && process.env.EXPLAINER_REAL_INPUT === '1';
const skip = enabled ? false : 'held: sends real input; set EXPLAINER_REAL_INPUT=1 when nobody is at the machine';
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Puts the pointer on a point and turns the wheel there once (the test's own input; the app never does this). */
function turnWheelAt(p: { x: number; y: number }): void {
  const script = `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class In { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, int d, System.UIntPtr e); }'
[void][In]::SetProcessDPIAware(); [void][In]::SetCursorPos(${Math.round(p.x)}, ${Math.round(p.y)}); Start-Sleep -Milliseconds 30; [In]::mouse_event(0x0800, 0, 0, -120, [System.UIntPtr]::Zero)`;
  const r = spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 30_000 });
  assert.equal(r.status, 0, String(r.stderr));
}

test('a real turn of the mouse wheel reaches the guide through the real input hook', { skip, timeout: 60000 }, async () => {
  const win = await openNavWindow();
  let wheels = 0;
  uIOhook.start();
  const stop = watchGuideInput({ down: () => undefined, up: () => undefined, escape: () => undefined, wheel: () => void wheels++ });
  try {
    await wait(300);
    turnWheelAt(win.centre('scroll'));
    for (let i = 0; i < 20 && wheels === 0; i++) await wait(100);
    assert.ok(wheels >= 1, 'the hook told the guide the wheel turned');
  } finally {
    stop();
    uIOhook.stop();
    win.close();
  }
});

const tabStep: Step = { say: 'open the tab', actions: [{ op: 'go', kind: 'tab', x: 500, y: 500 }, { op: 'wait', for: 'click', x: 480, y: 480, w: 40, h: 40 }] };
const flat = { cols: GRID_COLS, rows: GRID_ROWS, luma: new Uint8Array(GRID_COLS * GRID_ROWS).fill(200) };

async function walk(wheel: boolean): Promise<string[]> {
  const win = await openNavWindow();
  const helper = createHelper({ nav: true })!;
  uIOhook.start();
  const after = (ms: number, run: () => void) => { const t = setTimeout(run, ms); return () => clearTimeout(t); };
  const consent = createNavConsent({ after });
  void consent.ask();
  consent.answer(true); // the person's yes, given beforehand
  const navigator = createNavigator({ hwnd: win.hwnd, helper })!;
  const target = win.centre('tab-beta');
  const g = createGuide({
    displayId: 1,
    send: () => undefined,
    capture: async () => ({ screenshot: { mime: 'image/png', base64: 'x', width: 10, height: 10 }, grid: flat }),
    listen: (l: GuideListener) => watchGuideInput({ down: () => undefined, up: () => undefined, escape: () => l.escape(), key: () => l.key?.(), wheel: () => l.wheel?.() }),
    replan: async () => undefined,
    finish: () => undefined,
    onEnd: () => undefined,
    log: () => undefined,
    sleep: wait,
    after,
    navigation: createGuideNavigation({ navigator, consent, toScreen: () => target, log: () => undefined }),
  });
  try {
    await wait(300);
    g.push(tabStep);
    if (wheel) { await wait(150); turnWheelAt(win.centre('scroll')); }
    await wait(8000); // past the probe (about a second) and the longest beat: 2400 + 70 a character + 1500 for the first move, about 4.7 s here
    return [...win.events];
  } finally {
    g.end('superseded');
    helper.stop();
    uIOhook.stop();
    win.close();
  }
}

test('with no wheel turned the guide opens the tab after its beat; one real turn of the wheel in the beat and it does not', { skip, timeout: 120000 }, async () => {
  const left = await walk(false);
  assert.ok(left.some((e) => /^tab 1$/.test(e)), `the tab was selected: ${JSON.stringify(left)}`);
  const stopped = await walk(true);
  assert.ok(!stopped.some((e) => /^tab /.test(e)), `no tab was selected after the wheel: ${JSON.stringify(stopped)}`);
});
