import test from 'node:test';
import assert from 'node:assert/strict';
import { announcement, decideNav, vetoed } from '../src/shared/nav-guard.ts';
import type { NavFacts, NavIntent } from '../src/shared/nav-guard.ts';

const base: NavFacts = {
  ok: true, ct: 'tabitem', enabled: true, offscreen: false, password: false, name: 'Appearance', autoId: '', help: '',
  win: 'Settings', proc: 'app', dlg: '', invoke: false, expand: '', selected: false,
  elevated: false, toggle: false, valuePattern: false, valueReadOnly: true, range: false, scroll: null,
};
const f = (over: Partial<NavFacts>): NavFacts => ({ ...base, ...over });
const TAB: NavIntent = { kind: 'tab' };
const OPEN: NavIntent = { kind: 'open' };
const SCROLL: NavIntent = { kind: 'scroll', dir: 'down' };
const scrolls = { v: true, h: false, canUp: false, canDown: true, canLeft: false, canRight: false };
const nothing = (d: ReturnType<typeof decideNav>): boolean => d.verdict !== 'do';

test('the three things the app may do: select a tab, open a menu that has a submenu, scroll a page', () => {
  assert.deepEqual(decideNav(f({}), TAB), { verdict: 'do', verb: 'select', what: 'tab' });
  assert.deepEqual(decideNav(f({ ct: 'menuitem', name: 'Recent', expand: 'collapsed', selected: null }), OPEN), { verdict: 'do', verb: 'expand', what: 'menu' });
  assert.deepEqual(decideNav(f({ ct: 'text', name: 'a paragraph', selected: null, scroll: scrolls }), SCROLL), { verdict: 'do', verb: 'scroll', what: 'page' });
});

test('a button, a check box, a toggle, a radio button, a link, a field, a combo box and a password are never acted on, whatever the model asks and whatever they are called', () => {
  const dangerous: Array<[string, Partial<NavFacts>]> = [
    ['an ordinary button named Appearance', { ct: 'button', invoke: true, name: 'Appearance', selected: null }],
    ['a Save button', { ct: 'button', invoke: true, name: 'Save', selected: null }],
    ['a Send button', { ct: 'button', invoke: true, name: 'Send', selected: null }],
    ['a Delete button', { ct: 'button', invoke: true, name: 'Delete account', selected: null }],
    ['a Buy button', { ct: 'button', invoke: true, name: 'Buy now', selected: null }],
    ['a split button', { ct: 'splitbutton', invoke: true, expand: 'collapsed', selected: null }],
    ['a link', { ct: 'hyperlink', invoke: true, name: 'Docs', selected: null }],
    ['a check box', { ct: 'checkbox', toggle: true, selected: null }],
    ['a toggle button', { ct: 'button', toggle: true, selected: null }],
    ['a radio button', { ct: 'radiobutton', selected: false }],
    ['a text field', { ct: 'edit', valuePattern: true, valueReadOnly: false, selected: null }],
    ['a read-only looking field', { ct: 'edit', valuePattern: true, valueReadOnly: true, selected: null }],
    ['a password field', { ct: 'edit', password: true, selected: null }],
    ['a combo box', { ct: 'combobox', expand: 'collapsed', selected: null }],
    ['a slider', { ct: 'slider', range: true, selected: null }],
    ['a spinner', { ct: 'spinner', range: true, selected: null }],
    ['a tab that is also a toggle', { toggle: true }],
    ['a "tab" that holds an editable value', { valuePattern: true, valueReadOnly: false }],
  ];
  // Scrolling a page by its scroll bar presses nothing, so a button or a link under the pointer does not stop it; everything that holds a value does.
  const pressesOnly = (what: string): boolean => /button named|Save button|Send button|Delete button|Buy button|split button|a link/.test(what);
  for (const [what, over] of dangerous) {
    for (const intent of pressesOnly(what) ? [TAB, OPEN] : [TAB, OPEN, SCROLL]) {
      assert.ok(nothing(decideNav(f({ ...over, scroll: scrolls }), intent)), `${what} for ${intent.kind}`);
    }
  }
});

test('a leaf menu item runs a command: it is pointed at, never opened; and a menu that is already open or a tab already selected is left', () => {
  assert.equal(decideNav(f({ ct: 'menuitem', name: 'Open', expand: 'leaf', selected: null }), OPEN).verdict, 'show');
  assert.equal(decideNav(f({ ct: 'menuitem', name: 'Open', expand: '', selected: null }), OPEN).verdict, 'show');
  assert.equal(decideNav(f({ ct: 'menuitem', name: 'Recent', expand: 'expanded', selected: null }), OPEN).verdict, 'show');
  assert.equal(decideNav(f({ selected: true }), TAB).verdict, 'show');
  assert.equal(decideNav(f({ selected: null }), TAB).verdict, 'show', 'a tab that gives no way to select it is not acted on');
});

test('what the model asked for must be what is there: a tab asked of a menu, a menu asked of a tab, a menu asked of a button', () => {
  assert.ok(nothing(decideNav(f({ ct: 'menuitem', expand: 'collapsed', selected: null }), TAB)));
  assert.ok(nothing(decideNav(f({}), OPEN)));
  assert.ok(nothing(decideNav(f({ ct: 'button', invoke: true, expand: 'collapsed', selected: null }), OPEN)));
});

test('words only take permission away; they never grant it', () => {
  assert.equal(decideNav(f({ name: 'Save settings' }), TAB).verdict, 'show', 'a tab named like an act is pointed at');
  assert.equal(decideNav(f({ autoId: 'btnSubmit' }), TAB).verdict, 'do', 'an id is only read as whole words: btnSubmit is not "submit"');
  assert.equal(decideNav(f({ help: 'Delete everything' }), TAB).verdict, 'show');
  assert.equal(decideNav(f({ ct: 'button', name: 'Settings', invoke: true, selected: null }), TAB).verdict, 'show', 'a friendly name does not make a button a tab');
  for (const w of ['Save', 'Apply changes', 'DELETE', 'Buy now', 'Pay', 'Send message', 'Sign out', 'log-out', 'Logout', 'Guardar', 'Löschen', 'Supprimer', 'OK']) assert.equal(vetoed(w), true, w);
  for (const w of ['Appearance', 'Settings', 'Recent', 'Posture', 'Overview', 'Okay then', 'Pricing', 'Sort by', '']) assert.equal(vetoed(w), false, w);
});

test('a dialog that asks for a decision, a password manager, a bank and a window the app cannot see into are left alone', () => {
  assert.equal(decideNav(f({ win: 'Confirm delete' }), TAB).verdict, 'refuse');
  assert.equal(decideNav(f({ dlg: 'Do you want to save changes?' }), TAB).verdict, 'refuse');
  assert.equal(decideNav(f({ win: 'User Account Control' }), TAB).verdict, 'refuse');
  assert.equal(decideNav(f({ win: 'Vault - Bitwarden' }), TAB).verdict, 'refuse');
  assert.equal(decideNav(f({ proc: '1Password' }), TAB).verdict, 'refuse');
  assert.equal(decideNav(f({ win: 'Online banking - Sign in' }), TAB).verdict, 'refuse');
  assert.equal(decideNav(f({ win: 'Checkout - Shop' }), TAB).verdict, 'refuse');
  assert.equal(decideNav({ ok: false, why: 'nothing there' }, TAB).verdict, 'show');
  assert.equal(decideNav({ ok: false, why: 'a browser window' }, TAB).verdict, 'show');
  assert.equal(decideNav(f({ enabled: false }), TAB).verdict, 'show');
  assert.equal(decideNav(f({ offscreen: true }), TAB).verdict, 'show');
});

test('scrolling: only a page-sized step the way it can go, and never over a field that a wheel would change', () => {
  const over = (o: Partial<NavFacts>): NavFacts => f({ ct: 'text', selected: null, scroll: scrolls, ...o });
  assert.equal(decideNav(over({}), { kind: 'scroll', dir: 'down' }).verdict, 'do');
  assert.equal(decideNav(over({}), { kind: 'scroll' }).verdict, 'do', 'down is the default');
  assert.equal(decideNav(over({}), { kind: 'scroll', dir: 'up' }).verdict, 'show', 'already at the top');
  assert.equal(decideNav(over({}), { kind: 'scroll', dir: 'right' }).verdict, 'show');
  assert.equal(decideNav(over({ scroll: null }), SCROLL).verdict, 'show', 'nothing scrolls under the point');
  assert.equal(decideNav(over({ ct: 'combobox' }), SCROLL).verdict, 'refuse');
  assert.equal(decideNav(over({ ct: 'slider', range: true }), SCROLL).verdict, 'refuse');
  assert.equal(decideNav(over({ ct: 'edit', valuePattern: true, valueReadOnly: false }), SCROLL).verdict, 'refuse');
  assert.equal(decideNav(over({ win: 'Confirm delete' }), SCROLL).verdict, 'refuse');
});

test('the words said before acting name what is about to happen', () => {
  assert.equal(announcement('tab'), "I'll open that tab for you.");
  assert.equal(announcement('open'), "I'll open that menu for you.");
  assert.equal(announcement('scroll'), "I'll scroll down for you.");
  assert.equal(announcement('scroll', 'up'), "I'll scroll up for you.");
});

test('a window that runs elevated, or whose level was not read, is refused for every kind of move, even one that would otherwise be done', () => {
  for (const intent of [TAB, OPEN, SCROLL]) {
    assert.deepEqual(decideNav(f({ elevated: true }), intent), { verdict: 'refuse', why: 'an elevated window' }, intent.kind);
  }
  assert.equal(decideNav(f({}), TAB).verdict, 'do', 'the same tab at a normal level is done');
});
