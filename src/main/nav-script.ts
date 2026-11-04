// The one function of the PowerShell helper that may act on a window for the person in guide mode (see nav.ts, and
// shared/nav-guard.ts for the policy). Its inputs are numbers and a few fixed words from a request line, never text the
// model wrote. Two modes:
//
//   probe: says what is at a screen point (its kind, its state, which patterns it has), changing nothing.
//   act:   looks again, requires the very same control the probe saw (kind, place, runtime id, name), checks the structure
//          itself (it has its own refusals, whatever the caller asked), and does ONE of three things:
//            select a tab item that is not selected          (SelectionItemPattern.Select)
//            expand a menu item that has a submenu           (ExpandCollapsePattern.Expand)
//            scroll a scrollable area by a page              (ScrollPattern.Scroll)
//
// It never moves the pointer, never sends a key or a mouse event, never sets a value, toggles, collapses or invokes: a
// button has no way to be pressed here, whatever it is called. It looks only at the window in front, and never at a
// browser window (before any accessibility call it checks the window classes; see ps-prelude.ts).

export const NAV_SCRIPT = String.raw`
function Pat($el, $p) { $o = $null; if ($el.TryGetCurrentPattern($p, [ref]$o)) { return $o } else { return $null } }
function Ct-Of($el) { return ($el.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '').ToLower() }

function Invoke-Nav($req) {
  $mode = [string]$req.mode; $kind = [string]$req.kind; $dir = [string]$req.dir
  if ($mode -ne 'probe' -and $mode -ne 'act') { return @{ ok = $false; why = 'bad mode' } }
  if ($kind -notin 'tab', 'open', 'scroll') { return @{ ok = $false; why = 'bad kind' } }
  if ($dir -and $dir -notin 'down', 'up', 'left', 'right') { return @{ ok = $false; why = 'bad direction' } }
  $x = [int]$req.x; $y = [int]$req.y

  # Only the window in front (or, for a check on a window of its own, that window) is ever looked into, and never a browser.
  $rootAt = Root-At $x $y
  if ([int64]$req.hwnd -ne 0) { $front = $Win::GetAncestor([IntPtr][int64]$req.hwnd, 3) } else { $front = Front-Window }
  if ($rootAt -eq [IntPtr]::Zero -or $rootAt -ne $front) { return @{ ok = $false; why = 'not the window in front' } }
  if (Has-Browser $rootAt) { return @{ ok = $false; why = 'a browser window' } }


  $AE = [System.Windows.Automation.AutomationElement]
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $e = $AE::FromPoint((New-Object System.Windows.Point($x, $y)))
  if ($null -eq $e) { return @{ ok = $false; why = 'nothing there' } }

  # A point usually lands on the text or picture inside a control: the control itself is the nearest ancestor that can be acted on.
  $actionable = 'button', 'tabitem', 'menuitem', 'hyperlink', 'checkbox', 'radiobutton', 'edit', 'combobox', 'slider', 'spinner', 'splitbutton', 'listitem', 'treeitem', 'menu', 'menubar'
  $up = $e
  for ($i = 0; $i -lt 6 -and $null -ne $up; $i++) {
    $t = Ct-Of $up
    if ($t -eq 'window') { break }
    $any = ($t -in $actionable)
    foreach ($p in @([System.Windows.Automation.InvokePattern]::Pattern, [System.Windows.Automation.SelectionItemPattern]::Pattern, [System.Windows.Automation.ExpandCollapsePattern]::Pattern, [System.Windows.Automation.TogglePattern]::Pattern, [System.Windows.Automation.RangeValuePattern]::Pattern, [System.Windows.Automation.ValuePattern]::Pattern)) {
      if (-not $any -and $null -ne (Pat $up $p)) { $any = $true }
    }
    if ($any) { $e = $up; break }
    $up = $walker.GetParent($up)
  }

  # The ancestors that matter: the nearest dialog, and a scrollable area.
  $dlg = ''; $scroller = $null
  $cur = $e; $depth = 0
  while ($null -ne $cur -and $depth -lt 40) {
    if ($null -eq $scroller) { $sp = Pat $cur ([System.Windows.Automation.ScrollPattern]::Pattern); if ($null -ne $sp) { $scroller = $cur } }
    if ((Ct-Of $cur) -eq 'window' -and $dlg -eq '' -and $depth -gt 0) { $dlg = [string]$cur.Current.Name }
    $cur = $walker.GetParent($cur); $depth++
  }
  $win = [string]($AE::FromHandle($rootAt)).Current.Name
  $ct = Ct-Of $e
  $c = $e.Current
  $procName = ''
  try { $procName = [string](Get-Process -Id $c.ProcessId -ErrorAction Stop).ProcessName } catch { }
  $ex = Pat $e ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
  $expand = ''
  if ($null -ne $ex) { switch ($ex.Current.ExpandCollapseState.ToString()) { 'Collapsed' { $expand = 'collapsed' } 'Expanded' { $expand = 'expanded' } 'LeafNode' { $expand = 'leaf' } default { $expand = 'partial' } } }
  $sel = Pat $e ([System.Windows.Automation.SelectionItemPattern]::Pattern)
  $selected = $null; if ($null -ne $sel) { $selected = [bool]$sel.Current.IsSelected }
  $inv = Pat $e ([System.Windows.Automation.InvokePattern]::Pattern)
  $tog = Pat $e ([System.Windows.Automation.TogglePattern]::Pattern)
  $rng = Pat $e ([System.Windows.Automation.RangeValuePattern]::Pattern)
  $val = Pat $e ([System.Windows.Automation.ValuePattern]::Pattern)
  $readOnly = $true; if ($null -ne $val) { $readOnly = [bool]$val.Current.IsReadOnly }
  $scrollFacts = $null
  if ($null -ne $scroller) {
    $sp = Pat $scroller ([System.Windows.Automation.ScrollPattern]::Pattern)
    $v = [bool]$sp.Current.VerticallyScrollable; $h = [bool]$sp.Current.HorizontallyScrollable
    $vp = [double]$sp.Current.VerticalScrollPercent; $hp = [double]$sp.Current.HorizontalScrollPercent
    $scrollFacts = @{ v = $v; h = $h; canUp = ($v -and $vp -gt 0.5); canDown = ($v -and $vp -lt 99.5); canLeft = ($h -and $hp -gt 0.5); canRight = ($h -and $hp -lt 99.5) }
  }
  # The control a verb would act on: the scrolling area for a scroll, otherwise the control under the point.
  $target = $e; if ($kind -eq 'scroll') { $target = $scroller }
  $token = ''
  if ($null -ne $target) {
    $tr = $target.Current.BoundingRectangle
    $token = (@((Ct-Of $target), [int]$tr.X, [int]$tr.Y, [int]$tr.Width, [int]$tr.Height, (($target.GetRuntimeId()) -join '.'), $target.Current.Name) -join '|')
  }

  if ($mode -eq 'probe') {
    return @{
      ok = $true; ct = $ct; enabled = [bool]$c.IsEnabled; offscreen = [bool]$c.IsOffscreen; password = [bool]$c.IsPassword
      name = [string]$c.Name; autoId = [string]$c.AutomationId; help = [string]$c.HelpText
      win = $win; proc = $procName; dlg = $dlg
      invoke = ($null -ne $inv); expand = $expand; selected = $selected; toggle = ($null -ne $tog)
      valuePattern = ($null -ne $val); valueReadOnly = $readOnly; range = ($null -ne $rng)
      scroll = $scrollFacts; token = $token
    }
  }

  # ---- act: the same control, and the structure checked again here, whatever the caller said ----
  if ($token -eq '' -or $token -ne [string]$req.token) { return @{ ok = $true; acted = $false; why = 'it changed' } }
  $holds = ($ct -in 'edit', 'combobox', 'slider', 'spinner', 'checkbox', 'radiobutton')
  if ([bool]$c.IsPassword -or $null -ne $tog -or $null -ne $rng -or $holds) { return @{ ok = $true; acted = $false; why = 'not a thing to act on' } }
  if ($kind -ne 'scroll' -and $ct -in 'button', 'splitbutton') { return @{ ok = $true; acted = $false; why = 'not a thing to act on' } }
  if (-not [bool]$c.IsEnabled -or [bool]$c.IsOffscreen) { return @{ ok = $true; acted = $false; why = 'not available' } }
  switch ($kind) {
    'tab' {
      if ($ct -ne 'tabitem' -or $null -eq $sel -or $sel.Current.IsSelected) { return @{ ok = $true; acted = $false; why = 'not a tab to open' } }
      $sel.Select()
    }
    'open' {
      if ($ct -ne 'menuitem' -or $expand -ne 'collapsed') { return @{ ok = $true; acted = $false; why = 'not a menu to open' } }
      $ex.Expand()
    }
    'scroll' {
      if ($null -eq $scrollFacts -or $ct -in 'edit', 'combobox', 'slider', 'spinner') { return @{ ok = $true; acted = $false; why = 'nothing to scroll' } }
      $sp = Pat $scroller ([System.Windows.Automation.ScrollPattern]::Pattern)
      $none = [System.Windows.Automation.ScrollAmount]::NoAmount
      $inc = [System.Windows.Automation.ScrollAmount]::LargeIncrement
      $dec = [System.Windows.Automation.ScrollAmount]::LargeDecrement
      if ($dir -eq 'up' -and $scrollFacts.canUp) { $sp.Scroll($none, $dec) }
      elseif ($dir -eq 'left' -and $scrollFacts.canLeft) { $sp.Scroll($dec, $none) }
      elseif ($dir -eq 'right' -and $scrollFacts.canRight) { $sp.Scroll($inc, $none) }
      elseif (($dir -eq 'down' -or $dir -eq '') -and $scrollFacts.canDown) { $sp.Scroll($none, $inc) }
      else { return @{ ok = $true; acted = $false; why = 'cannot scroll that way' } }
    }
  }
  return @{ ok = $true; acted = $true }
}
`;
