import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHelper, HELPER_SOURCE } from '../src/main/ps-helper.ts';
import { PS_PRELUDE } from '../src/main/ps-prelude.ts';
import { NAV_SCRIPT } from '../src/main/nav-script.ts';
import { createNavigator, parseFacts } from '../src/main/nav.ts';

// The app never acts in a window whose process runs elevated, or whose level it cannot read. No window is opened here and nothing is sent to the
// system: the checks are the pure ones, the helper's own function on process ids, and the helper started for one request that finds no window.

const onWindows = process.platform === 'win32';

test('the helper checks the level of the window before it asks the accessibility API anything, and of the control after it', () => {
  const at = (s: string) => NAV_SCRIPT.indexOf(s);
  assert.ok(at('Window-Elevated $rootAt') > at('Has-Browser $rootAt'), 'after the browser check');
  assert.ok(at('Window-Elevated $rootAt') < at('::FromPoint'), 'and before any accessibility call');
  assert.ok(at('Is-Elevated $e.Current.ProcessId') > at('::FromPoint'), 'a control hosted by another process is checked too');
  assert.ok(at('Is-Elevated $e.Current.ProcessId') < at('$ct = Ct-Of $e'), 'before anything is read from it');
  assert.equal((NAV_SCRIPT.match(/an elevated window/g) ?? []).length, 2);
});

test('a helper answer that does not say the window is not elevated is read as elevated', () => {
  const ok = { ok: true, ct: 'tabitem', enabled: true, offscreen: false, password: false, name: 'x', win: 'w', proc: 'p', dlg: '', selected: false, token: 't' };
  const read = (over: Record<string, unknown>) => parseFacts({ ...ok, ...over }).facts;
  const missing = read({});
  assert.ok(missing.ok && missing.elevated, 'no answer means elevated');
  for (const odd of ['no', 0, null, 'false']) {
    const f = read({ elevated: odd });
    assert.ok(f.ok && f.elevated, `${JSON.stringify(odd)} means elevated`);
  }
  const plain = read({ elevated: false });
  assert.ok(plain.ok && !plain.elevated);
});

/** Whether this test process itself runs elevated (then "my own process is not elevated" cannot be asked). */
function weAreElevated(): boolean {
  const r = spawnSync('whoami', ['/groups'], { encoding: 'utf8', windowsHide: true });
  return r.stdout.includes('S-1-16-12288') || r.stdout.includes('S-1-16-16384');
}

test('the helper says a process runs elevated unless it can read that it does not: the system, a missing process and process 0 are all elevated', { skip: !onWindows }, () => {
  const probe = (pids: Array<number | string>): Record<string, string> => {
    const script = `${PS_PRELUDE}\n${pids.map((p) => `Write-Output ("p${p}=" + (Is-Elevated ${p}))`).join('\n')}\nWrite-Output ("self=" + (Is-Elevated $PID))`;
    const r = spawnSync(`${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    assert.equal(r.status, 0, r.stderr);
    return Object.fromEntries(r.stdout.split(/\r?\n/).filter((l) => l.includes('=')).map((l) => l.split('=') as [string, string]));
  };
  const got = probe([0, 4, 4294967295]);
  assert.equal(got.p0, 'True', 'process 0');
  assert.equal(got.p4, 'True', 'the system process cannot be read');
  assert.equal(got.p4294967295, 'True', 'a process that is not there');
  if (!weAreElevated()) assert.equal(got.self, 'False', 'a process of the person\'s own level is not elevated');
});

test('the whole helper, navigation included, starts and answers a request for a point where there is no window (it is a script, and a script with an error would not start)', { skip: !onWindows }, async () => {
  assert.ok(HELPER_SOURCE.includes('Window-Elevated'));
  const helper = createHelper({ nav: true });
  assert.ok(helper, 'a helper on this system');
  try {
    const navigator = createNavigator({ helper });
    assert.ok(navigator);
    const r = await navigator.probe({ x: -30000, y: -30000 }, { kind: 'tab' });
    assert.deepEqual(r.facts, { ok: false, why: 'not the window in front' });
  } finally {
    helper.stop();
  }
});
