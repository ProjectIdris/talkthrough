// The read of a window's controls, as a function of the PowerShell helper (see ps-helper.ts, and uia.ts for what it is
// for). It is READ-ONLY by construction: it asks the accessibility tree for each control's rectangle, kind and whether it
// is off screen, and nothing else. It never invokes, selects, expands, toggles, focuses or types into anything, and never
// reads a control's name or value. What it gives back is numbers and the control type's name. Its only input is a window
// handle (zero: the window in front). A browser window is answered with "skip" before the accessibility API is touched.

export const UIA_SCRIPT = String.raw`
function Read-Controls($hwndArg) {
  if ($hwndArg -ne 0) { $handle = [IntPtr]$hwndArg } else { $handle = Front-Window }
  if ($handle -eq [IntPtr]::Zero) { return @{ out = '' } }
  if (Has-Browser $handle) { return @{ skip = 'browser' } }
  $AE = [AutomationElement]
  $CT = [ControlType]
  $root = $AE::FromHandle($handle)
  $types = @($CT::Button, $CT::CheckBox, $CT::ComboBox, $CT::Edit, $CT::Hyperlink, $CT::ListItem, $CT::MenuItem, $CT::RadioButton, $CT::TabItem, $CT::TreeItem, $CT::SplitButton)
  $conds = @(foreach ($t in $types) { New-Object PropertyCondition($AE::ControlTypeProperty, $t) })
  $cond = New-Object OrCondition([Condition[]]$conds)
  $cache = New-Object CacheRequest
  $cache.Add($AE::BoundingRectangleProperty)
  $cache.Add($AE::ControlTypeProperty)
  $cache.Add($AE::IsOffscreenProperty)
  $cache.TreeScope = [TreeScope]::Element
  $scope = $cache.Activate()
  try { $found = $root.FindAll([TreeScope]::Descendants, $cond) } finally { $scope.Dispose() }
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
  return @{ out = ($out -join ';') }
}
`;
