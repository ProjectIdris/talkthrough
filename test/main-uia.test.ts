import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { UIA_SCRIPT, createUiaReader, parseControls, toDisplayBoxes } from '../src/main/uia.ts';

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

test('a reader that is never answered gives up at the time limit, and a cancelled one stops its child', async () => {
  let killed = 0;
  const hang = (_file: string, _args: string[], _env: NodeJS.ProcessEnv, _ms: number, _done: (e: Error | null, s: string) => void) => ({ kill: () => { killed++; return true; } }) as unknown as ChildProcess;
  const reader = createUiaReader({ run: hang, timeoutMs: 50 })!;
  const abort = new AbortController();
  const pending = reader.read(abort.signal);
  abort.abort();
  assert.equal(killed, 1);
  // The fake child never calls back, so the read stays pending: the session never awaits it (see main-session.test.ts).
  const raced = await Promise.race([pending.then(() => 'done'), new Promise<string>((r) => setTimeout(() => r('pending'), 30))]);
  assert.equal(raced, 'pending');
  const failing = createUiaReader({ run: (_f, _a, _e, _t, done) => { setImmediate(() => done(new Error('boom'), '')); return { kill: () => true } as unknown as ChildProcess; } })!;
  const failed = await failing.read();
  assert.deepEqual(failed.controls, []);
  assert.equal(failed.why, 'failed');
  const ok = createUiaReader({ run: (_f, _a, _e, _t, done) => { setImmediate(() => done(null, '1,2,30,40,button')); return { kill: () => true } as unknown as ChildProcess; } })!;
  assert.deepEqual((await ok.read()).controls, [{ x: 1, y: 2, w: 30, h: 40, kind: 'button' }]);
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
    const reader = createUiaReader({ hwnd: win.hwnd, timeoutMs: 15000 })!;
    const read = await reader.read();
    assert.ok(read.controls.length >= 5, `found ${read.controls.length}: ${JSON.stringify(read.controls)}`);
    console.log(`uia: ${read.controls.length} controls in ${read.ms} ms`);
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

test('on a web page of our own (a browser window) the first read already finds the page\'s controls, though a page builds its tree only when asked', { skip: process.platform !== 'win32' || !existsSync(resolve('node_modules/electron/dist/electron.exe')), timeout: 60000 }, async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
  const child = spawn(resolve('node_modules/electron/dist/electron.exe'), [resolve('test/support/uia-page.cjs')], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const ready = await new Promise<RegExpExecArray>((ok, fail) => {
      let text = '';
      const timer = setTimeout(() => fail(new Error('the test page did not start')), 25000);
      child.stdout!.on('data', (d: Buffer) => {
        text += d.toString();
        const m = /READY (\d+) (.*)/.exec(text);
        if (m) { clearTimeout(timer); ok(m); }
      });
      child.on('error', fail);
    });
    const want = ready[2]!.trim().split(';').map((s) => { const [kind, ...n] = s.split(','); return { kind: kind!, n: n.map(Number) }; });
    const read = await createUiaReader({ hwnd: Number(ready[1]), timeoutMs: 15000 })!.read();
    console.log(`uia (web page, first read): ${read.controls.length} controls in ${read.ms} ms`);
    for (const w of want) {
      const c = read.controls.find((k) => k.kind === w.kind && Math.abs(k.x - w.n[0]!) <= 3 && Math.abs(k.y - w.n[1]!) <= 3 && Math.abs(k.w - w.n[2]!) <= 4 && Math.abs(k.h - w.n[3]!) <= 4);
      assert.ok(c, `a ${w.kind} at ${w.n.join(',')} among ${JSON.stringify(read.controls)}`);
    }
  } finally {
    child.kill();
  }
});
