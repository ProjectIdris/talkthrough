import test from 'node:test';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { UIA_SCRIPT, createUiaReader, parseControls, toDisplayBoxes } from '../src/main/uia.ts';
import { createHelper } from '../src/main/ps-helper.ts';
import { fakeChild } from './support/fake-helper-child.ts';
import { haveElectron, startPage } from './support/electron-page.ts';

test('the controls text is read strictly: anything that is not numbers and a type name is dropped', () => {
  const got = parseControls('10,20,80,30,button;5,5,3,3,tabitem;bad;1,2,3,4,Button;1,2,3,4,x y;-10,0,40,20,edit;1,2,3;');
  assert.deepEqual(got.map((c) => c.kind), ['button', 'tabitem', 'edit']);
  assert.deepEqual(got[2], { x: -10, y: 0, w: 40, h: 20, kind: 'edit' });
  assert.equal(parseControls('x'.repeat(100_000)).length, 0);
});

test('the script only reads: no call that invokes, selects, expands, toggles, focuses or types', () => {
  for (const banned of ['Invoke', 'SelectionItem', 'ExpandCollapse', 'Toggle', 'SetFocus', 'SendKeys', 'SendInput', 'mouse_event', 'SetValue', 'Click', 'Pattern(', 'GetCurrentPattern', 'TryGetCurrentPattern', 'Start-Process', 'Net.', 'Invoke-WebRequest']) {
    assert.ok(!UIA_SCRIPT.includes(banned), `the script must not contain ${banned}`);
  }
  // It asks for the rectangle, the type and the off-screen flag, and never a name or a value.
  assert.ok(!/NameProperty|ValuePattern|HelpText|AutomationId|LabeledBy|(Current|Cached)\.(Name|Value)\b/.test(UIA_SCRIPT));
});

test('controls in screen pixels become boxes on the display\'s 0..1000 scale; off-screen and tiny ones are dropped', () => {
  const dip = (p: { x: number; y: number }) => ({ x: p.x / 2, y: p.y / 2 }); // a display scaled to 200%
  const boxes = toDisplayBoxes(
    [{ x: 200, y: 100, w: 100, h: 60, kind: 'button' }, { x: 5000, y: 0, w: 50, h: 50, kind: 'button' }, { x: 10, y: 10, w: 4, h: 4, kind: 'edit' }, { x: -20, y: 0, w: 120, h: 80, kind: 'tabitem' }],
    dip,
    { x: 0, y: 0, width: 960, height: 540 },
  );
  assert.deepEqual(boxes[0], { x: 104.2, y: 92.6, w: 52.1, h: 55.6, kind: 'button' });
  assert.equal(boxes.length, 2, 'the control off the display and the one too small are gone');
  assert.equal(boxes[1]?.x, 0, 'a control partly off the display is cut to it');
  const second = toDisplayBoxes([{ x: 2000, y: 100, w: 100, h: 60, kind: 'button' }], (p) => p, { x: 1920, y: 0, width: 1920, height: 1080 });
  assert.equal(second[0]?.x, 41.7, 'a second display is measured from its own corner');
});

test('a reader that is never answered gives up at the time limit, a cancelled one answers at once, and a failed or skipped one gives nothing', async () => {
  const hang = fakeChild(() => undefined);
  const reader = createUiaReader({ helper: createHelper({ startupMs: 0, start: () => hang })!, timeoutMs: 40 })!;
  const timedOut = await reader.read();
  assert.equal(timedOut.why, 'timed out');
  assert.deepEqual(timedOut.controls, []);
  assert.equal(hang.killed, 1, 'the child that did not answer was stopped');
  const abort = new AbortController();
  const quiet = fakeChild(() => undefined);
  const cancelled = createUiaReader({ helper: createHelper({ start: () => quiet })!, timeoutMs: 5000 })!.read(abort.signal);
  abort.abort();
  assert.equal((await cancelled).why, 'cancelled');
  const answers = (body: Record<string, unknown>) => createUiaReader({ helper: createHelper({ start: () => fakeChild(() => body) })! })!.read();
  assert.deepEqual((await answers({ out: '1,2,30,40,button' })).controls, [{ x: 1, y: 2, w: 30, h: 40, kind: 'button' }]);
  const skipped = await answers({ skip: 'browser' });
  assert.deepEqual(skipped.controls, []);
  assert.equal(skipped.why, 'browser', 'a browser window is reported as skipped, not as empty');
  const dead = fakeChild(() => undefined);
  const failing = createUiaReader({ helper: createHelper({ start: () => dead })!, timeoutMs: 5000 })!.read();
  dead.die();
  assert.equal((await failing).why, 'failed');
});

// A window of our own (never anyone else's), made with WPF because it describes itself to the accessibility tree
// the way real applications do: two buttons, a field and a tab strip. The check is that what the tree reports is where
// the window itself says its controls are, in the same pixels.
const WINDOW_SCRIPT = String.raw`
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class W { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[void][W]::SetProcessDPIAware()
$w = New-Object System.Windows.Window
$w.Title = 'tt-uia-check'; $w.WindowStartupLocation = 'Manual'; $w.Left = 120; $w.Top = 120; $w.Width = 520; $w.Height = 360; $w.ShowInTaskbar = $false
$canvas = New-Object System.Windows.Controls.Canvas
$w.Content = $canvas
function Put($el, $x, $y, $wd, $ht) { $el.Width = $wd; $el.Height = $ht; [System.Windows.Controls.Canvas]::SetLeft($el, $x); [System.Windows.Controls.Canvas]::SetTop($el, $y); [void]$canvas.Children.Add($el); $el }
$b1 = New-Object System.Windows.Controls.Button; $b1.Content = 'One'; [void](Put $b1 20 20 110 36)
$b2 = New-Object System.Windows.Controls.Button; $b2.Content = 'Two'; [void](Put $b2 150 20 110 36)
$t = New-Object System.Windows.Controls.TextBox; [void](Put $t 20 80 300 28)
$tabs = New-Object System.Windows.Controls.TabControl
foreach ($n in 'Alpha', 'Beta') { $i = New-Object System.Windows.Controls.TabItem; $i.Header = $n; [void]$tabs.Items.Add($i) }
[void](Put $tabs 20 130 400 150)
$w.Show()
# A real dispatcher loop, so the window answers the accessibility tree as promptly as a real application does.
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(700)
$timer.Add_Tick({
  $timer.Stop()
  $s = [System.Windows.PresentationSource]::FromVisual($w).CompositionTarget.TransformToDevice.M11
  $lines = @('HWND=' + (New-Object System.Windows.Interop.WindowInteropHelper($w)).Handle.ToInt64())
  foreach ($c in @($b1, $b2, $t, $tabs.Items[0], $tabs.Items[1])) {
    $p = $c.PointToScreen((New-Object System.Windows.Point(0, 0)))
    $lines += ('{0},{1},{2},{3}' -f [int][math]::Round($p.X), [int][math]::Round($p.Y), [int][math]::Round($c.ActualWidth * $s), [int][math]::Round($c.ActualHeight * $s))
  }
  [Console]::Out.WriteLine(($lines -join ';')); [Console]::Out.Flush()
})
$timer.Start()
$stop = New-Object System.Windows.Threading.DispatcherTimer
$stop.Interval = [TimeSpan]::FromSeconds(25)
$stop.Add_Tick({ $w.Close(); [System.Windows.Threading.Dispatcher]::CurrentDispatcher.InvokeShutdown() })
$stop.Start()
[System.Windows.Threading.Dispatcher]::Run()
`;

function openOwnWindow(): Promise<{ child: ChildProcess; hwnd: number; rects: number[][] }> {
  const ps = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(ps, ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(WINDOW_SCRIPT, 'utf16le').toString('base64')], { windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the test window did not start: ${text}`)); }, 20000);
    child.stdout!.on('data', (d: Buffer) => {
      text += d.toString();
      const line = text.trim();
      if (!line.includes(';') || !line.startsWith('HWND=')) return;
      clearTimeout(timer);
      const parts = line.split(';');
      resolve({ child, hwnd: Number(parts[0]!.slice(5)), rects: parts.slice(1).map((p) => p.split(',').map(Number)) });
    });
    child.on('error', reject);
  });
}

test('on a window of our own the reader finds the buttons, the field and the tabs where the window puts them', { skip: process.platform !== 'win32', timeout: 60000 }, async () => {
  const win = await openOwnWindow();
  try {
    const helper = createHelper()!;
    const reader = createUiaReader({ hwnd: win.hwnd, helper, timeoutMs: 15000 })!;
    const first = await reader.read();
    const read = await reader.read();
    helper.stop();
    console.log(`uia: first read (the helper starts) ${first.ms} ms, the next ${read.ms} ms`);
    assert.ok(read.controls.length >= 5, `found ${read.controls.length}: ${JSON.stringify(read.controls)}`);
    const near = (want: number[], kinds: string[]): void => {
      const c = read.controls.find((k) => kinds.includes(k.kind) && Math.abs(k.x - want[0]!) <= 3 && Math.abs(k.y - want[1]!) <= 3 && Math.abs(k.w - want[2]!) <= 4 && Math.abs(k.h - want[3]!) <= 4);
      assert.ok(c, `a ${kinds.join('/')} at ${want.join(',')} among ${JSON.stringify(read.controls)}`);
    };
    near(win.rects[0]!, ['button']);
    near(win.rects[1]!, ['button']);
    near(win.rects[2]!, ['edit']);
    near(win.rects[3]!, ['tabitem']);
    near(win.rects[4]!, ['tabitem']);
  } finally {
    win.child.kill();
  }
});

test('a browser window is never read: the reader answers "browser" before the accessibility API is touched, and the page is left as it was', { skip: process.platform !== 'win32' || !haveElectron, timeout: 90000 }, async () => {
  const page = await startPage();
  const helper = createHelper()!;
  try {
    const reader = createUiaReader({ hwnd: page.hwnd, helper, timeoutMs: 15000 })!;
    for (let i = 0; i < 2; i++) {
      const read = await reader.read();
      assert.equal(read.why, 'browser');
      assert.deepEqual(read.controls, []);
    }
  } finally {
    helper.stop();
    page.stop();
  }
});
