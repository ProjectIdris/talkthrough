# Press probe (Windows): do real mouse presses reach the overlay after an answer has been shown, and does a pen stroke made with a real mouse arrive?
# Runs this work copy as a check run on its own user-data folder: the real overlay, the real session, real screen capture, but the model is a tape
# made from a bundled sample (no model call, no network), the question text is fixed (no microphone), and the chord is made in-process (no keys sent).
#   Phase 1  answer 1 is shown; 3 real left clicks (the first on the background should dismiss it): the positive control.
#   Phase 2  answer 2 is shown (the failing case); the same 3 clicks.
#   Phase 3  still in answer 2: a chord is held and one short pen drag (button down, 8 moves, up) is made on our overlay before the chord is released.
# A click or drag is sent only where the OS says the window under the point is one of ours; otherwise nothing is sent and the window is named.
# Takes about 50 s of the screen (the script's own waits stop at 58 s), moves the pointer to the points and puts it back.
# The pointer's left button is released, the app is stopped and the temp folder removed in a finally, whatever happens.
# Software rendering is the default (the GPU is not touched); -Gpu uses hardware acceleration.
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\press-probe.ps1 [-Gpu]
param([string]$Repo = (Split-Path -Parent $PSScriptRoot), [switch]$Gpu)
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class P {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowLongW(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
'@
[void][P]::SetProcessDPIAware()
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$work = Join-Path $env:TEMP ('tt-press-probe-' + [guid]::NewGuid().ToString('N').Substring(0, 8)); New-Item -ItemType Directory $work | Out-Null
# The tape: the bundled sample's steps, answered the same way to each of three questions.
$tape = Join-Path $work 'tape.json'
& node -e "const s=require(process.argv[1]);const call={outputs:s.steps.map((step,k)=>({at:150*(k+1),output:{type:'step',step}}))};require('fs').writeFileSync(process.argv[2],JSON.stringify({calls:[call,call,call]}))" (Join-Path $Repo 'samples\scenes\anchor-assembly.json') $tape
$cli = @('.', "--user-data-dir=$work\ud", '--self-chord', '--self-chord-gap', '17000', '--chord-hold', '3000', '--exit-after-chord', '3', '--replay-answer', $tape,
  '--question', 'what is this||and this||and this', '--fake-mic', '--silent-voice', '--max-seconds', '58', $(if ($Gpu) { '--gpu' } else { '--software' }))
$app = Start-Process -FilePath (Join-Path $Repo 'node_modules\electron\dist\electron.exe') -ArgumentList $cli -WorkingDirectory $Repo -RedirectStandardOutput "$work\out.txt" -RedirectStandardError "$work\err.txt" -WindowStyle Hidden -PassThru
$began = Get-Date
$deadline = $began.AddSeconds(58)
$tree = @{}
# The app's process tree, rebuilt from the root each time (a dead child's reused PID does not stay in it).
function Refresh-Tree {
  $t = @{ [uint32]$app.Id = $true }
  try { $all = @(Get-CimInstance Win32_Process) } catch { $all = @() }
  do { $grew = $false; foreach ($c in $all) { if ($t.ContainsKey([uint32]$c.ParentProcessId) -and -not $t.ContainsKey([uint32]$c.ProcessId)) { $t[[uint32]$c.ProcessId] = $true; $grew = $true } } } while ($grew)
  $script:tree = $t
}
Refresh-Tree
$script:down = $false
function Describe($h) {
  $id = [uint32]0; [void][P]::GetWindowThreadProcessId($h, [ref]$id); $sb = New-Object System.Text.StringBuilder 96; [void][P]::GetClassNameW($h, $sb, 96)
  $r = New-Object P+RECT; [void][P]::GetWindowRect($h, [ref]$r); $ex = [P]::GetWindowLongW($h, -20)
  $n = try { (Get-Process -Id $id -ErrorAction Stop).ProcessName } catch { '?' }
  [pscustomobject]@{ h = $h; ours = $tree.ContainsKey($id); proc = $n; cls = $sb.ToString(); rect = ('{0},{1} {2}x{3}' -f $r.L, $r.T, ($r.R-$r.L), ($r.B-$r.T)); ex = ('{0:X8}' -f $ex) }
}
function Lines { try { $fs = [IO.File]::Open("$work\out.txt", 'Open', 'Read', 'ReadWrite'); $sr = New-Object IO.StreamReader($fs); $t = $sr.ReadToEnd(); $sr.Dispose(); $fs.Dispose(); @($t -split "`r?`n" | Where-Object { $_ }) } catch { @() } }
function Count($pattern) { @(Lines | Where-Object { $_ -match $pattern }).Count }
function Wait-For($pattern, $atLeast, $seconds) { $end = (Get-Date).AddSeconds($seconds); if ($end -gt $deadline) { $end = $deadline }; while ((Get-Date) -lt $end) { if ((Count $pattern) -ge $atLeast) { return $true }; Start-Sleep -Milliseconds 150 }; return $false }
# The answer is on the page when the page marks its first mark; if that line never comes, the end of the answer plus a few seconds.
function Answer-Up($n) { if (Wait-For 'milestone first-mark' $n 25) { Start-Sleep -Milliseconds 1000; return $true }; if (Wait-For 'key hook: during this answer' $n 3) { Start-Sleep -Seconds 4; return $true }; return $false }
function Under($x, $y) { Refresh-Tree; $q = New-Object P+POINT; $q.X = $x; $q.Y = $y; $u = Describe ([P]::WindowFromPoint($q)); $r = Describe ([P]::GetAncestor($u.h, 2)); [pscustomobject]@{ under = $u; root = $r; text = "OS says $($u.proc)/$($u.cls) [$($u.rect)] ex=$($u.ex), top-level $($r.proc)/$($r.cls) ours=$($r.ours)" } }
function Press-Down { $script:down = $true; [P]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero) }
function Press-Up { [P]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero); $script:down = $false }
# The window is asked before the pointer moves, and asked again (tree rebuilt) at the new position right before the press.
function Guard($what, $x, $y) {
  if ((Get-Date) -ge $deadline) { return @{ ok = $false; say = "$what ${x},${y}: past the 58 s cap -> NOT sent" } }
  $o = Under $x $y
  if (-not $o.root.ours) { return @{ ok = $false; say = "$what ${x},${y}: $($o.text) -> NOT sent (not our window)" } }
  [void][P]::SetCursorPos($x, $y); Start-Sleep -Milliseconds 200
  $o = Under $x $y
  if (-not $o.root.ours) { return @{ ok = $false; say = "$what ${x},${y}: $($o.text) (asked again just before the press) -> NOT sent (not our window)" } }
  return @{ ok = $true; say = "$what ${x},${y}: $($o.text)" }
}
function Click-At($x, $y) {
  $g = Guard 'click' $x $y
  if (-not $g.ok) { return $g.say }
  Press-Down; Start-Sleep -Milliseconds 80; Press-Up
  "$($g.say) -> sent"
}
function Drag-From($x, $y) {
  $g = Guard 'drag from' $x $y
  if (-not $g.ok) { return $g.say }
  Press-Down
  foreach ($k in 1..8) { Start-Sleep -Milliseconds 40; [void][P]::SetCursorPos($x + 40 * $k, $y + [int](25 * [Math]::Sin($k))) }
  Start-Sleep -Milliseconds 60; Press-Up
  "$($g.say) -> sent (down, 8 moves of 40 px, up; ends at $($x + 320))"
}
$show = 'window mouse|dismissed|chord pressed|chord released|pen:|stroke|question heard|screenshot|key hook|tape'
$report = New-Object System.Collections.Generic.List[string]
$script:from = 0
function Phase($title, $actions) {
  $report.Add("=== $title"); foreach ($a in $actions) { $report.Add("  [" + [int]((Get-Date) - $began).TotalSeconds + " s] " + $a) }
  $all = @(Lines); $report.Add("  app log:"); foreach ($l in ($all | Select-Object -Skip $script:from | Where-Object { $_ -match $show })) { $report.Add('    ' + ($l -replace '^\[talkthrough ', '[')) }
  $script:from = $all.Count
}
$points = @(@(1720, 300), @(400, 1000), @(3000, 700))
$saved = New-Object P+POINT; [void][P]::GetCursorPos([ref]$saved)
try {
  # Phase 1: answer 1
  $act = @()
  if (Wait-For 'chord pressed' 1 25) { if (Answer-Up 1) { foreach ($p in $points) { $act += (Click-At $p[0] $p[1]); Start-Sleep -Milliseconds 1200 } } else { $act += 'answer 1 never came up; nothing sent' } } else { $act += 'no chord in 25 s; nothing sent' }
  Phase 'Phase 1: answer 1, three clicks (the first on the background should dismiss it)' $act
  # Phase 2: answer 2
  $act = @()
  if (Wait-For 'chord pressed' 2 30) { if (Answer-Up 2) { foreach ($p in $points) { $act += (Click-At $p[0] $p[1]); Start-Sleep -Milliseconds 1200 } } else { $act += 'answer 2 never came up; nothing sent' } } else { $act += 'second chord did not come in 30 s; nothing sent' }
  Phase 'Phase 2: answer 2, the same three clicks' $act
  # Phase 3: the pen, in answer 2 (the third chord is held 3 s)
  $act = @()
  if (Wait-For 'chord pressed' 3 30) { if (Wait-For 'pen: on' 3 5) { Start-Sleep -Milliseconds 500; $act += (Drag-From 1000 600) } else { $act += 'the pen did not go on; nothing sent' } } else { $act += 'third chord did not come in 30 s; nothing sent' }
  Start-Sleep -Seconds 5
  Phase 'Phase 3: chord held in answer 2, one pen drag before release' $act
} finally {
  if ($script:down) { [P]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero); $script:down = $false }
  [void][P]::SetCursorPos($saved.X, $saved.Y)
  if (-not $app.HasExited) { & taskkill /T /F /PID $app.Id | Out-Null }
  $report
  "=== end after $([int]((Get-Date) - $began).TotalSeconds) s. A 'window mouse' line counts presses and moves that reached the page since the previous line, so read the line order, not the phase heading; look for 'pen: N stroke(s)' in phase 3."
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
