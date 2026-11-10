# overlay-reshow-input.ps1 <hwnd> <x> <y>: prints "child visible=Y|n", and "os gives child|TOP-LEVEL|nothing" for the point (x+0, y+0 given offset by 30000 so a negative point can be passed).
param([string]$WinH, [int]$PX, [int]$PY)
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class C {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  public static string Class(IntPtr h) { var sb = new StringBuilder(96); GetClassNameW(h, sb, 96); return sb.ToString(); }
  public static string Kid(IntPtr p) { string r = "none"; EnumChildWindows(p, (h, x) => { if (Class(h) == "Chrome_RenderWidgetHostHWND") r = IsWindowVisible(h) ? "Y" : "n"; return true; }, IntPtr.Zero); return r; }
}
'@
$top = [IntPtr][int64]$WinH
$p = New-Object C+POINT; $p.X = $PX - 30000; $p.Y = $PY - 30000
$u = [C]::WindowFromPoint($p)
$at = if ($u -eq [IntPtr]::Zero) { 'nothing' } elseif ($u -eq $top) { 'TOP-LEVEL' } elseif ([C]::Class($u) -eq 'Chrome_RenderWidgetHostHWND') { 'child' } else { 'other:' + [C]::Class($u) }
"child visible=" + [C]::Kid($top) + " os gives=" + $at
