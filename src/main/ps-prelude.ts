// The part of the Windows PowerShell helper that every request shares (see ps-helper.ts, uia.ts, nav-script.ts).
//
// Two things it settles before any request reaches the accessibility API:
//  - user32 is called through a dynamic assembly built in memory (reflection emit), not compiled: no compiler runs and
//    no file is written, so a security tool has no C# compile to flag;
//  - a window that is, or holds, a browser engine (Chromium, Electron, Firefox, Qt) is never asked anything. Asking a
//    browser's accessibility tree to build itself turns accessibility on for the whole browser until it is restarted,
//    and that costs the browser (and every page in it) real CPU. The check looks only at window classes (GetClassName
//    and the window tree), never at the accessibility API.

export const PS_PRELUDE = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase

$ab = [AppDomain]::CurrentDomain.DefineDynamicAssembly((New-Object System.Reflection.AssemblyName 'ttwin'), [System.Reflection.Emit.AssemblyBuilderAccess]::Run)
$tb = $ab.DefineDynamicModule('ttwin').DefineType('Win', 'Public,Class')
function Imp($name, $charset, $ret, $params) {
  $m = $tb.DefinePInvokeMethod($name, 'user32.dll', 'Public,Static,PinvokeImpl', 'Standard', $ret, [Type[]]$params, 'Winapi', $charset)
  $m.SetImplementationFlags('PreserveSig')
}
Imp 'SetProcessDPIAware' 'Auto' ([bool]) @()
Imp 'GetForegroundWindow' 'Auto' ([IntPtr]) @()
Imp 'GetClassNameW' 'Unicode' ([int]) @([IntPtr], [System.Text.StringBuilder], [int])
Imp 'WindowFromPoint' 'Auto' ([IntPtr]) @([long])
Imp 'GetAncestor' 'Auto' ([IntPtr]) @([IntPtr], [uint32])
Imp 'GetWindow' 'Auto' ([IntPtr]) @([IntPtr], [uint32])
$Win = $tb.CreateType()
[void]$Win::SetProcessDPIAware()

# The owner-most window of the one at a screen point (so a menu that belongs to a window counts as that window).
function Root-At($x, $y) { return $Win::GetAncestor($Win::WindowFromPoint(([long]$y -shl 32) -bor ([long]$x -band 0xFFFFFFFFL)), 3) }
function Front-Window() { return $Win::GetAncestor($Win::GetForegroundWindow(), 3) }

$browserClass = '^(Chrome_|MozillaWindowClass|MozillaDialogClass|MozillaUIWindowClass|Qt\d+\w*QWindow|CefBrowser|Intermediate D3D Window)'
function Class-Of($h) { $sb = New-Object System.Text.StringBuilder 256; [void]$Win::GetClassNameW($h, $sb, 256); return $sb.ToString() }
# True when the window, or any window inside it (to a bounded count), is a browser engine's.
function Has-Browser($root) {
  if ((Class-Of $root) -match $browserClass) { return $true }
  $stack = New-Object System.Collections.Generic.Stack[IntPtr]
  $stack.Push($root)
  $n = 0
  while ($stack.Count -gt 0 -and $n -lt 600) {
    $p = $stack.Pop()
    $c = $Win::GetWindow($p, 5)
    while ($c -ne [IntPtr]::Zero -and $n -lt 600) {
      $n++
      if ((Class-Of $c) -match $browserClass) { return $true }
      $stack.Push($c)
      $c = $Win::GetWindow($c, 2)
    }
  }
  return $false
}
`;

/** One request a line, one answer a line, until the input closes. */
export const PS_LOOP = String.raw`
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $id = 0
  $o = $null
  try {
    $req = $line | ConvertFrom-Json
    $id = [int]$req.id
    if ($req.op -eq 'read') { $o = Read-Controls ([int64]$req.hwnd) }
    elseif ($req.op -eq 'nav' -and (Test-Path function:Invoke-Nav)) { $o = Invoke-Nav $req }
    else { $o = @{ ok = $false; why = 'bad request' } }
  } catch {
    $o = @{ ok = $false; why = 'the window would not say' }
  }
  $o['id'] = $id
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}
`;
