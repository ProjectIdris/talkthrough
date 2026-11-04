import test from 'node:test';
import assert from 'node:assert/strict';
import { HELPER_SOURCE, createHelper } from '../src/main/ps-helper.ts';
import { NAV_SCRIPT } from '../src/main/nav-script.ts';
import { createNavigator, parseFacts } from '../src/main/nav.ts';
import type { Navigator } from '../src/main/nav.ts';
import { decideNav } from '../src/shared/nav-guard.ts';
import type { NavIntent } from '../src/shared/nav-guard.ts';
import { fakeChild } from './support/fake-helper-child.ts';
import { haveElectron, startPage } from './support/electron-page.ts';
import { openNavWindow } from './support/nav-window.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const onWindows = process.platform === 'win32';

test('the navigation function can do three things and nothing else: no click, key, value, toggle, collapse, pointer move or invoke', () => {
  for (const banned of ['SendKeys', 'SendInput', 'mouse_event', 'keybd_event', 'SetCursorPos', 'SetValue', 'Toggle()', '.Collapse', 'SetFocus', 'Start-Process', 'Invoke-WebRequest', 'Invoke-Expression', 'iex ', 'DoDefaultAction', 'LegacyIAccessible', 'WindowPattern', 'Close()', '.Invoke(']) {
    assert.ok(!HELPER_SOURCE.includes(banned), `the helper must not contain ${banned}`);
  }
  // Each verb appears in the branch for its kind and nowhere else.
  const verbs = NAV_SCRIPT.match(/\$(?:sel|ex|sp)\.(Select|Expand|Scroll)\(/g) ?? [];
  assert.deepEqual([...verbs].sort(), ['$ex.Expand(', '$sel.Select(', '$sp.Scroll(', '$sp.Scroll(', '$sp.Scroll(', '$sp.Scroll('].sort());
  assert.equal((NAV_SCRIPT.match(/\.Current\.Value\b/g) ?? []).length, 0, 'no value of any control is read');
  // Whatever it is asked, it has looked at the window class (and so refused a browser) before it asks the accessibility API about a point.
  assert.ok(NAV_SCRIPT.indexOf('Has-Browser') < NAV_SCRIPT.indexOf('::FromPoint'));
});

test('what the helper answers is read strictly: odd or missing fields become "no facts" or the safe value', () => {
  assert.equal(parseFacts(null).facts.ok, false);
  assert.deepEqual(parseFacts({ ok: false, why: 'not the window in front' }).facts, { ok: false, why: 'not the window in front' });
  const f = parseFacts({ ok: true, ct: 'TabItem', enabled: true, selected: false, expand: 'weird', token: 't', scroll: { v: true, canDown: true } });
  assert.equal(f.token, 't');
  assert.ok(f.facts.ok);
  if (f.facts.ok) {
    assert.equal(f.facts.ct, 'tabitem');
    assert.equal(f.facts.expand, '');
    assert.equal(f.facts.toggle, false);
    assert.equal(f.facts.valueReadOnly, true, 'a field is read-only unless the window says it is not');
    assert.equal(f.facts.scroll?.canDown, true);
    assert.equal(f.facts.scroll?.canUp, false);
  }
});

test('bad inputs never reach the helper, and what it is asked is only numbers and fixed words', async () => {
  const child = fakeChild(() => ({ ok: false, why: 'nothing there' }));
  const nav = createNavigator({ helper: createHelper({ start: () => child })! })!;
  for (const bad of [{ x: NaN, y: 1 }, { x: 1e9, y: 1 }, { x: 1, y: Infinity }]) assert.equal((await nav.probe(bad, { kind: 'tab' })).facts.ok, false);
  assert.equal((await nav.probe({ x: 1, y: 1 }, { kind: 'format c:' as never })).facts.ok, false);
  assert.equal((await nav.probe({ x: 1, y: 1 }, { kind: 'link' as never })).facts.ok, false, 'a link is not something the app does');
  assert.equal((await nav.probe({ x: 1, y: 1 }, { kind: 'scroll', dir: 'sideways' as never })).facts.ok, false);
  assert.equal((await nav.act({ x: 1, y: 1 }, { kind: 'tab' }, '')).acted, false);
  assert.equal(child.requests.length, 0, 'nothing was asked for any of them');
  await nav.probe({ x: 10.6, y: 20.2 }, { kind: 'scroll', dir: 'up' });
  assert.deepEqual({ ...child.requests[0], id: undefined }, { op: 'nav', mode: 'probe', x: 11, y: 20, kind: 'scroll', dir: 'up', hwnd: 0, id: undefined });
});

test('a helper that does not answer in time is a probe that found nothing and an act that did not happen', async () => {
  const hang = fakeChild(() => undefined);
  const nav = createNavigator({ helper: createHelper({ startupMs: 0, start: () => hang })!, timeoutMs: 30 })!;
  const p = await nav.probe({ x: 5, y: 5 }, { kind: 'tab' });
  assert.equal(p.facts.ok, false);
  const a = await nav.act({ x: 5, y: 5 }, { kind: 'tab' }, 'token');
  assert.equal(a.acted, false);
  assert.equal(a.why, 'timed out');
  await wait(10);
});

/** Looks, asks the guard, and acts only if it says so: what the app does. Returns what the guard said and whether it acted. */
async function guarded(nav: Navigator, point: { x: number; y: number }, intent: NavIntent) {
  const p = await nav.probe(point, intent);
  const d = decideNav(p.facts, intent);
  const acted = d.verdict === 'do' ? (await nav.act(point, intent, p.token)).acted : false;
  return { p, d, acted };
}

test('on a window of our own: a tab is selected, a submenu is opened, an area is scrolled; and nothing else is ever touched', { skip: !onWindows, timeout: 120000 }, async () => {
  const win = await openNavWindow();
  const helper = createHelper({ nav: true })!;
  try {
    const nav = createNavigator({ hwnd: win.hwnd, helper })!;

    // What the guard allows is done.
    const tab = await guarded(nav, win.centre('tab-beta'), { kind: 'tab' });
    assert.equal(tab.d.verdict, 'do');
    assert.equal(tab.acted, true);
    assert.ok(await win.waitEvent(/^tab 1$/), 'the second tab was selected');
    const again = await guarded(nav, win.centre('tab-beta'), { kind: 'tab' });
    assert.equal(again.d.verdict, 'show', 'a tab already open is left alone');

    const scroll = await guarded(nav, win.centre('scroll'), { kind: 'scroll', dir: 'down' });
    assert.equal(scroll.d.verdict, 'do');
    assert.equal(scroll.acted, true);
    assert.ok(await win.waitEvent(/^scroll \d+$/), 'the area scrolled');
    const up = await guarded(nav, win.centre('scroll'), { kind: 'scroll', dir: 'up' });
    assert.equal(up.d.verdict, 'do', 'and can go back up');

    const t0 = Date.now();
    const menu = await guarded(nav, win.centre('file'), { kind: 'open' });
    console.log(`nav: probe + act on a warm helper took ${Date.now() - t0} ms (probe ${menu.p.ms} ms)`);
    assert.equal(menu.d.verdict, 'do');
    assert.equal(menu.acted, true);
    assert.ok(await win.waitEvent(/^menu file$/), 'the File menu opened');
    const rects = await win.menuRects();
    assert.ok(rects.open && rects.recent, 'its items are on screen now');

    // A leaf menu item runs a command: pointed at, never opened.
    const leaf = await nav.probe(win.centre('open'), { kind: 'open' });
    assert.equal(decideNav(leaf.facts, { kind: 'open' }).verdict, 'show');
    // ... and the script refuses it too if it is asked to, with the very token it was just given.
    assert.equal((await nav.act(win.centre('open'), { kind: 'open' }, leaf.token)).acted, false);
    // A submenu is opened.
    const sub = await guarded(nav, win.centre('recent'), { kind: 'open' });
    assert.equal(sub.d.verdict, 'do');
    assert.equal(sub.acted, true);
    assert.ok(await win.waitEvent(/^menu recent$/));

    // Everything that must never be touched: the guard says no, and so does the script when it is asked anyway.
    const never = ['save', 'check', 'toggle', 'text', 'password', 'combo', 'expander'];
    const holdsValue = new Set(['text', 'password', 'combo']);
    await Promise.all(never.map(async (name) => {
      const p = await nav.probe(win.centre(name), { kind: 'tab' });
      for (const intent of [{ kind: 'tab' }, { kind: 'open' }] as NavIntent[]) {
        assert.notEqual(decideNav(p.facts, intent).verdict, 'do', `${name} for ${intent.kind}: the guard`);
        const forced = await nav.act(win.centre(name), intent, p.token);
        assert.equal(forced.acted, false, `${name} for ${intent.kind}: the script itself refuses`);
      }
      if (holdsValue.has(name)) {
        const s = await nav.probe(win.centre(name), { kind: 'scroll' });
        assert.notEqual(decideNav(s.facts, { kind: 'scroll' }).verdict, 'do', `${name} for scroll: the guard`);
        assert.equal((await nav.act(win.centre(name), { kind: 'scroll' }, s.token)).acted, false, `${name} for scroll: the script`);
      }
    }));
    // A link is not something it does either: the kind is refused at the door.
    assert.equal((await nav.act(win.centre('link'), { kind: 'link' as never }, 'x')).acted, false);
    await wait(500);
    const forbidden = win.events.filter((e) => /^(save|check|toggle|text|password|combo|expander|open-command|recent-file|link)/.test(e));
    assert.deepEqual(forbidden, [], 'the window was never told to save, check, toggle, type, pick, expand, run a command or follow a link');
    assert.deepEqual(win.events.filter((e) => /^tab /.test(e)), ['tab 1'], 'and only the one tab was changed');
  } finally {
    helper.stop();
    win.close();
  }
});

test('the script acts only on the very control it was shown, only in the window in front, and only when the point is a place it can see', { skip: !onWindows, timeout: 90000 }, async () => {
  const win = await openNavWindow();
  const helper = createHelper({ nav: true })!;
  try {
    const nav = createNavigator({ hwnd: win.hwnd, helper })!;
    const beta = await nav.probe(win.centre('tab-beta'), { kind: 'tab' });
    // Another control at the point (the token is of Beta): it changed.
    const wrong = await nav.act(win.centre('tab-gamma'), { kind: 'tab' }, beta.token);
    assert.equal(wrong.acted, false);
    assert.equal(wrong.why, 'it changed');
    // The same control but a different kind asked for.
    assert.equal((await nav.act(win.centre('tab-beta'), { kind: 'open' }, beta.token)).acted, false);
    // Not the window in front.
    const elsewhere = createNavigator({ hwnd: win.hwnd + 4, helper })!;
    const probe = await elsewhere.probe(win.centre('tab-beta'), { kind: 'tab' });
    assert.equal(probe.facts.ok, false);
    assert.equal((await elsewhere.act(win.centre('tab-beta'), { kind: 'tab' }, beta.token)).acted, false);
    // Nothing at all there.
    const off = await nav.probe({ x: -5000, y: -5000 }, { kind: 'tab' });
    assert.equal(off.facts.ok, false);
    await wait(400);
    assert.deepEqual(win.events, [], 'none of it changed anything');
  } finally {
    helper.stop();
    win.close();
  }
});

test('a browser window (here an Electron page of our own) is never looked into, nor acted on: not a tab, not a link, not a scroll', { skip: !onWindows || !haveElectron, timeout: 90000 }, async () => {
  const page = await startPage();
  const helper = createHelper({ nav: true })!;
  try {
    const nav = createNavigator({ hwnd: page.hwnd, helper })!;
    for (const [name, intent] of [['tab-b', { kind: 'tab' }], ['tall', { kind: 'scroll', dir: 'down' }], ['nav-docs', { kind: 'open' }], ['save', { kind: 'tab' }]] as Array<[string, NavIntent]>) {
      const p = await nav.probe(page.at(name), intent);
      assert.equal(p.facts.ok, false, `${name}: no facts from a browser`);
      assert.equal(p.facts.ok ? '' : p.facts.why, 'a browser window');
      assert.equal(decideNav(p.facts, intent).verdict, 'show');
      assert.equal((await nav.act(page.at(name), intent, 'a token it could not have')).acted, false);
    }
    await wait(500);
    assert.deepEqual(page.requests, ['/'], 'the page was only ever loaded: no tab selected, no link followed, no button pressed');
  } finally {
    helper.stop();
    page.stop();
  }
});

test('a helper started without navigation answers a navigation request with nothing done, whatever it is asked', { skip: !onWindows, timeout: 90000 }, async () => {
  const win = await openNavWindow();
  const helper = createHelper()!;
  try {
    const nav = createNavigator({ hwnd: win.hwnd, helper })!;
    const probe = await nav.probe(win.centre('tab-beta'), { kind: 'tab' });
    assert.equal(probe.facts.ok, false);
    assert.equal((await nav.act(win.centre('tab-beta'), { kind: 'tab' }, 'x')).acted, false);
    await wait(400);
    assert.deepEqual(win.events, [], 'nothing changed');
  } finally {
    helper.stop();
    win.close();
  }
});
