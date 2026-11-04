// A window of our own for the navigation tests (never anyone else's): a menu with a submenu and a command, a strip of
// tabs, a Save button, a check box, a toggle, a text field, a password field, a combo box, a disclosure, a link and a
// scroll area. Every one reports what was done to it on stdout as `EVENT <what>`, so a test can require that the
// things that must never be touched were never touched. It is shown without taking the keyboard, on top, and closes itself.

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';

export type Rect = { x: number; y: number; w: number; h: number };

const SCRIPT = String.raw`
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class W { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[void][W]::SetProcessDPIAware()
function Say($t) { [Console]::Out.WriteLine($t); [Console]::Out.Flush() }
$w = New-Object System.Windows.Window
$w.Title = 'tt-nav-check'; $w.WindowStartupLocation = 'Manual'; $w.Left = 100; $w.Top = 100; $w.Width = 560; $w.Height = 640
$w.ShowInTaskbar = $false; $w.ShowActivated = $false; $w.Topmost = $true
$dock = New-Object System.Windows.Controls.DockPanel
$w.Content = $dock
$menu = New-Object System.Windows.Controls.Menu
[System.Windows.Controls.DockPanel]::SetDock($menu, 'Top')
$file = New-Object System.Windows.Controls.MenuItem; $file.Header = 'File'
$recent = New-Object System.Windows.Controls.MenuItem; $recent.Header = 'Recent'
$a = New-Object System.Windows.Controls.MenuItem; $a.Header = 'a.txt'; [void]$recent.Items.Add($a)
$open = New-Object System.Windows.Controls.MenuItem; $open.Header = 'Open'
[void]$file.Items.Add($recent); [void]$file.Items.Add($open); [void]$menu.Items.Add($file)
[void]$dock.Children.Add($menu)
$canvas = New-Object System.Windows.Controls.Canvas
$canvas.Background = [System.Windows.Media.Brushes]::White
[void]$dock.Children.Add($canvas)
function Put($el, $x, $y, $wd, $ht) { $el.Width = $wd; $el.Height = $ht; [System.Windows.Controls.Canvas]::SetLeft($el, $x); [System.Windows.Controls.Canvas]::SetTop($el, $y); [void]$canvas.Children.Add($el); $el }
$tabs = New-Object System.Windows.Controls.TabControl
foreach ($n in 'Alpha', 'Beta', 'Gamma') { $i = New-Object System.Windows.Controls.TabItem; $i.Header = $n; [void]$tabs.Items.Add($i) }
[void](Put $tabs 20 20 400 100)
$save = New-Object System.Windows.Controls.Button; $save.Content = 'Save'; [void](Put $save 20 140 110 32)
$check = New-Object System.Windows.Controls.CheckBox; $check.Content = 'Remember me'; [void](Put $check 150 146 130 24)
$toggle = New-Object System.Windows.Controls.Primitives.ToggleButton; $toggle.Content = 'Mode'; [void](Put $toggle 300 140 90 32)
$text = New-Object System.Windows.Controls.TextBox; [void](Put $text 20 190 300 26)
$pass = New-Object System.Windows.Controls.PasswordBox; [void](Put $pass 20 230 300 26)
$combo = New-Object System.Windows.Controls.ComboBox; [void]$combo.Items.Add('one'); [void]$combo.Items.Add('two'); [void](Put $combo 340 190 120 26)
$exp = New-Object System.Windows.Controls.Expander; $exp.Header = 'More'; $exp.Content = 'hidden words'; [void](Put $exp 20 270 300 60)
$tb = New-Object System.Windows.Controls.TextBlock
$link = New-Object System.Windows.Documents.Hyperlink; $link.NavigateUri = New-Object System.Uri('https://example.org/'); [void]$link.Inlines.Add('a link')
[void]$tb.Inlines.Add($link); [void](Put $tb 20 350 200 24)
$scroll = New-Object System.Windows.Controls.ScrollViewer; $scroll.VerticalScrollBarVisibility = 'Auto'
$stack = New-Object System.Windows.Controls.StackPanel
for ($i = 1; $i -le 40; $i++) { $t = New-Object System.Windows.Controls.TextBlock; $t.Text = ('line ' + $i); [void]$stack.Children.Add($t) }
$scroll.Content = $stack
[void](Put $scroll 20 390 400 100)

$tabs.Add_SelectionChanged({ if ($_.OriginalSource -eq $tabs) { Say ('EVENT tab ' + $tabs.SelectedIndex) } })
$save.Add_Click({ Say 'EVENT save' })
$check.Add_Checked({ Say 'EVENT check' }); $check.Add_Unchecked({ Say 'EVENT check' })
$toggle.Add_Checked({ Say 'EVENT toggle' }); $toggle.Add_Unchecked({ Say 'EVENT toggle' })
$text.Add_TextChanged({ Say 'EVENT text' })
$pass.Add_PasswordChanged({ Say 'EVENT password' })
$combo.Add_SelectionChanged({ Say 'EVENT combo' })
$exp.Add_Expanded({ Say 'EVENT expander' })
$link.Add_RequestNavigate({ Say 'EVENT link' }); $link.Add_Click({ Say 'EVENT link' })
$scroll.Add_ScrollChanged({ if ($_.VerticalChange -ne 0) { Say ('EVENT scroll ' + [int]$scroll.VerticalOffset) } })
$open.Add_Click({ Say 'EVENT open-command' })
$a.Add_Click({ Say 'EVENT recent-file' })
$file.Add_SubmenuOpened({ if ($_.OriginalSource -eq $file) { Say 'EVENT menu file'; $later.Start() } })
$recent.Add_SubmenuOpened({ if ($_.OriginalSource -eq $recent) { Say 'EVENT menu recent' } })

function RectOf($el) {
  $s = [System.Windows.PresentationSource]::FromVisual($w).CompositionTarget.TransformToDevice.M11
  $p = $el.PointToScreen((New-Object System.Windows.Point(0, 0)))
  ('{0},{1},{2},{3}' -f [int][math]::Round($p.X), [int][math]::Round($p.Y), [int][math]::Round($el.ActualWidth * $s), [int][math]::Round($el.ActualHeight * $s))
}
$later = New-Object System.Windows.Threading.DispatcherTimer
$later.Interval = [TimeSpan]::FromMilliseconds(400)
$later.Add_Tick({ $later.Stop(); Say ('MENURECTS recent=' + (RectOf $recent) + ';open=' + (RectOf $open)) })
$w.Show()
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(700)
$timer.Add_Tick({
  $timer.Stop()
  $parts = @('hwnd=' + (New-Object System.Windows.Interop.WindowInteropHelper($w)).Handle.ToInt64())
  $items = @{ 'tab-alpha' = $tabs.Items[0]; 'tab-beta' = $tabs.Items[1]; 'tab-gamma' = $tabs.Items[2]; save = $save; check = $check; toggle = $toggle; text = $text; password = $pass; combo = $combo; expander = $exp; link = $tb; scroll = $scroll; file = $file }
  foreach ($k in $items.Keys) { $parts += ($k + '=' + (RectOf $items[$k])) }
  Say ('READY ' + ($parts -join ';'))
})
$timer.Start()
$stop = New-Object System.Windows.Threading.DispatcherTimer
$stop.Interval = [TimeSpan]::FromSeconds(40)
$stop.Add_Tick({ $w.Close(); [System.Windows.Threading.Dispatcher]::CurrentDispatcher.InvokeShutdown() })
$stop.Start()
[System.Windows.Threading.Dispatcher]::Run()
`;

export type NavWindow = {
  child: ChildProcess;
  hwnd: number;
  rects: Record<string, Rect>;
  /** Everything the window has reported being done to it, oldest first. */
  events: string[];
  /** Waits for a line `EVENT <text>` (already seen counts), and returns it. */
  waitEvent(match: RegExp, ms?: number): Promise<string | undefined>;
  /** Where a control's middle is, in screen pixels. */
  centre(name: string): { x: number; y: number };
  menuRects(): Promise<Record<string, Rect>>;
  close(): void;
};

const parseRect = (s: string): Rect => {
  const [x, y, w, h] = s.split(',').map(Number) as [number, number, number, number];
  return { x, y, w, h };
};

export function openNavWindow(): Promise<NavWindow> {
  const ps = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(ps, ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64')], { windowsHide: false, stdio: ['ignore', 'pipe', 'ignore'] });
  const events: string[] = [];
  const waiters: Array<{ match: RegExp; resolve: (s: string | undefined) => void }> = [];
  let menu: Record<string, Rect> | undefined;
  const menuWaiters: Array<(r: Record<string, Rect>) => void> = [];
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('the test window did not start')); }, 25000);
    child.on('error', reject);
    child.stdout!.on('data', (d: Buffer) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.startsWith('EVENT ')) {
          events.push(line.slice(6));
          for (const w of [...waiters]) if (w.match.test(line.slice(6))) { waiters.splice(waiters.indexOf(w), 1); w.resolve(line.slice(6)); }
        } else if (line.startsWith('MENURECTS ')) {
          menu = Object.fromEntries(line.slice(10).split(';').map((p) => { const [k, v] = p.split('='); return [k!, parseRect(v!)]; }));
          for (const w of menuWaiters.splice(0)) w(menu);
        } else if (line.startsWith('READY ')) {
          clearTimeout(timer);
          events.length = 0; // what the window said while it was being built is not something that was done to it
          const kv = Object.fromEntries(line.slice(6).split(';').map((p) => p.split('=') as [string, string]));
          const hwnd = Number(kv.hwnd);
          const rects: Record<string, Rect> = {};
          for (const [k, v] of Object.entries(kv)) if (k !== 'hwnd') rects[k] = parseRect(v);
          const win: NavWindow = {
            child, hwnd, rects, events,
            waitEvent: (match, ms = 4000) => {
              const seen = events.find((e) => match.test(e));
              if (seen) return Promise.resolve(seen);
              return new Promise((res) => { waiters.push({ match, resolve: res }); setTimeout(() => res(undefined), ms); });
            },
            centre: (name) => { const r = rects[name] ?? menu?.[name]; if (!r) throw new Error(`no control ${name}`); return { x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) }; },
            menuRects: () => (menu ? Promise.resolve(menu) : new Promise((res) => { menuWaiters.push(res); setTimeout(() => res({}), 5000); })),
            close: () => { child.kill(); },
          };
          resolve(win);
        }
      }
    });
  });
}
