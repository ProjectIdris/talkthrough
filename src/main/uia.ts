// Reads where the real controls of the window in front are (a button, a tab, a menu item, a field), so a mark the
// model drew at one can be put exactly on it (shared/controls.ts). Windows only, through the .NET UI Automation that
// ships with Windows PowerShell: nothing to install. It is READ-ONLY by construction: the script asks the accessibility
// tree for each control's rectangle, kind and whether it is off screen, and nothing else. It never invokes, selects,
// expands, toggles, focuses or types into anything, and never reads a control's name or value. What it prints is
// numbers and the control type's name; nothing from the model reaches it.
//
// It runs as one short-lived child per question, started when the key goes down and never waited for: the answer's
// first mark does not depend on it (the model takes seconds), and a read that is late, fails or finds nothing leaves
// the page snapping marks to the picture alone. A child that is still running after the time limit is killed.

import { execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';

/** A control as the system reports it: a rectangle in physical screen pixels, and the control type (button, tabitem, ...). */
export type ScreenControl = { x: number; y: number; w: number; h: number; kind: string };

/** The whole script. Read it as the guard: the only calls are FromHandle, FindAll and cached property reads. */
export const UIA_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TtWin {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
[void][TtWin]::SetProcessDPIAware()
if ($env:TT_UIA_HWND) { $handle = [IntPtr][int64]$env:TT_UIA_HWND } else { $handle = [TtWin]::GetForegroundWindow() }
if ($handle -eq [IntPtr]::Zero) { exit 0 }
$AE = [System.Windows.Automation.AutomationElement]
$CT = [System.Windows.Automation.ControlType]
$root = $AE::FromHandle($handle)
$types = @($CT::Button, $CT::CheckBox, $CT::ComboBox, $CT::Edit, $CT::Hyperlink, $CT::ListItem, $CT::MenuItem, $CT::RadioButton, $CT::TabItem, $CT::TreeItem, $CT::SplitButton)
$conds = @(foreach ($t in $types) { New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $t) })
$cond = New-Object System.Windows.Automation.OrCondition([System.Windows.Automation.Condition[]]$conds)
$cache = New-Object System.Windows.Automation.CacheRequest
$cache.Add($AE::BoundingRectangleProperty)
$cache.Add($AE::ControlTypeProperty)
$cache.Add($AE::IsOffscreenProperty)
$cache.TreeScope = [System.Windows.Automation.TreeScope]::Element
$scope = $cache.Activate()
# A browser builds a page's accessibility tree only once something asks for it: the first ask finds the page empty. In a
# browser window (Chromium's window class) the page is asked about first, up to three times a short while apart, until its document has a control in it.
$web = $root.Current.ClassName -like 'Chrome_WidgetWin*'
$docCond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $CT::Document)
try {
  if ($web) {
    for ($try = 0; $try -lt 3; $try++) {
      $doc = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $docCond)
      if ($null -ne $doc -and $doc.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond).Count -gt 0) { break }
      Start-Sleep -Milliseconds 350
    }
  }
  $found = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
} finally { $scope.Dispose() }
$out = New-Object System.Collections.Generic.List[string]
foreach ($e in $found) {
  if ($out.Count -ge 800) { break }
  $c = $e.Cached
  if ($c.IsOffscreen) { continue }
  $r = $c.BoundingRectangle
  if ($r.IsEmpty -or [double]::IsInfinity($r.X) -or $r.Width -lt 6 -or $r.Height -lt 6) { continue }
  $kind = ($c.ControlType.ProgrammaticName -replace '^ControlType\.', '').ToLower()
  $out.Add(('{0},{1},{2},{3},{4}' -f [int][math]::Round($r.X), [int][math]::Round($r.Y), [int][math]::Round($r.Width), [int][math]::Round($r.Height), $kind))
}
[Console]::Out.Write(($out -join ';'))
`;

/** Reads the controls text the script prints: x,y,w,h,kind separated by semicolons. Anything that is not that is dropped. */
export function parseControls(text: string): ScreenControl[] {
  const out: ScreenControl[] = [];
  for (const part of text.split(';')) {
    const m = /^(-?\d{1,6}),(-?\d{1,6}),(\d{1,6}),(\d{1,6}),([a-z]{1,20})$/.exec(part.trim());
    if (!m) continue;
    out.push({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]), kind: m[5] as string });
    if (out.length >= 800) break;
  }
  return out;
}

/**
 * Controls in physical screen pixels become boxes on the 0..1000 scale of one display: `toDip` is the system's
 * conversion of a screen point, `bounds` the display's rectangle in the same units it gives. What lies outside the
 * display is dropped, what is partly off it is cut to it, and nothing too small to aim at is kept.
 */
export function toDisplayBoxes(
  controls: readonly ScreenControl[],
  toDip: (p: { x: number; y: number }) => { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number },
): { x: number; y: number; w: number; h: number; kind: string }[] {
  const out: { x: number; y: number; w: number; h: number; kind: string }[] = [];
  const round1 = (v: number): number => Math.round(v * 10) / 10;
  for (const c of controls) {
    const a = toDip({ x: c.x, y: c.y }), b = toDip({ x: c.x + c.w, y: c.y + c.h });
    const x0 = Math.max(0, ((a.x - bounds.x) / bounds.width) * 1000), y0 = Math.max(0, ((a.y - bounds.y) / bounds.height) * 1000);
    const x1 = Math.min(1000, ((b.x - bounds.x) / bounds.width) * 1000), y1 = Math.min(1000, ((b.y - bounds.y) / bounds.height) * 1000);
    if (x1 - x0 < 4 || y1 - y0 < 4) continue;
    out.push({ x: round1(x0), y: round1(y0), w: round1(x1 - x0), h: round1(y1 - y0), kind: c.kind });
  }
  return out;
}

export type UiaRead = { controls: ScreenControl[]; ms: number; why?: string };

export type UiaReaderOptions = {
  /** Gives up (and stops the child) after this long. */
  timeoutMs?: number;
  /** Read this window and not the one in front: for checks on a window of their own. */
  hwnd?: number;
  /** For tests: how a child is started. */
  run?: (file: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number, done: (error: Error | null, stdout: string) => void) => ChildProcess;
};

export type UiaReader = { read(signal?: AbortSignal): Promise<UiaRead> };

function powershellPath(): string {
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/** The reader for this system: only Windows has one (elsewhere the page keeps snapping to the picture). */
export function createUiaReader(options: UiaReaderOptions = {}): UiaReader | undefined {
  if (process.platform !== 'win32' && !options.run) return undefined;
  const timeoutMs = options.timeoutMs ?? 2500;
  const encoded = Buffer.from(UIA_SCRIPT, 'utf16le').toString('base64');
  const args = ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encoded];
  return {
    read(signal) {
      const started = Date.now();
      return new Promise<UiaRead>((resolve) => {
        const finish = (controls: ScreenControl[], why?: string): void => resolve({ controls, ms: Date.now() - started, ...(why ? { why } : {}) });
        if (signal?.aborted) return finish([], 'cancelled');
        const env: NodeJS.ProcessEnv = { ...process.env };
        delete env.TT_UIA_HWND;
        if (options.hwnd !== undefined && Number.isSafeInteger(options.hwnd) && options.hwnd > 0) env.TT_UIA_HWND = String(options.hwnd);
        const start = options.run ?? ((file, a, e, t, done) => execFile(file, a, { env: e, timeout: t, windowsHide: true, maxBuffer: 256 * 1024, encoding: 'utf8' }, (error, stdout) => done(error, stdout)));
        const child = start(powershellPath(), args, env, timeoutMs, (error, stdout) => {
          signal?.removeEventListener('abort', onAbort);
          if (error) return finish([], error.message.includes('timed out') || (error as { killed?: boolean }).killed ? 'timed out' : 'failed');
          finish(parseControls(stdout));
        });
        const onAbort = (): void => {
          child.kill();
        };
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    },
  };
}
