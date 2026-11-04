import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSkipList, createSkipCheck, DEFAULT_SKIP_LIST, skipMatch, SKIP_MAX_ENTRIES } from '../src/main/skip-list.ts';

const BS = String.fromCharCode(92);
const winPath = (...parts: string[]): string => parts.join(BS);

test('a list is cleaned: trimmed, no blanks, no repeats (whatever the case), nothing too short or too long, and what was dropped is said', () => {
  const said: string[] = [];
  const out = cleanSkipList(['  Bank  ', '', 'bank', 'x', 'a'.repeat(81), 'Vault'], (m) => said.push(m));
  assert.deepEqual(out, ['Bank', 'Vault']);
  assert.equal(said.length, 2);
  assert.match(said[0]!, /"x" is too short/);
  assert.match(said[1]!, /81 characters is too long/);
  assert.deepEqual(cleanSkipList(['one', 'two', '', ' three ']), ['one', 'two', 'three']);
  assert.deepEqual(cleanSkipList(['one', 'two', '', ' three '].join(String.fromCharCode(10))), ['one', 'two', 'three']);
  assert.deepEqual(cleanSkipList(42), []);
  const many = cleanSkipList(Array.from({ length: SKIP_MAX_ENTRIES + 5 }, (_, i) => `entry ${i}`), (m) => said.push(m));
  assert.equal(many.length, SKIP_MAX_ENTRIES);
});

test('a window matches by its app name, its program file or its title, in any case; a window that matches nothing does not', () => {
  const list = ['1Password', 'my bank'];
  assert.equal(skipMatch(list, { appName: '1Password', title: 'Vault' }), '1Password');
  assert.equal(skipMatch(list, { path: winPath('C:', 'Program Files', '1Password', '1password.exe'), title: 'x' }), '1Password');
  assert.equal(skipMatch(list, { appName: 'Chrome', title: 'Accounts - MY BANK - Chrome' }), 'my bank');
  assert.equal(skipMatch(list, { appName: 'Notepad', path: winPath('C:', 'Windows', 'notepad.exe'), title: 'notes.txt' }), null);
  assert.equal(skipMatch(list, null), null);
  assert.equal(skipMatch([], { title: 'anything' }), null);
  assert.ok(DEFAULT_SKIP_LIST.includes('KeePass'));
});

test('the check reads the window each time it is asked; a read that fails or gives nothing skips nothing; no list reads nothing at all', () => {
  let reads = 0;
  let now: { title: string } | null | 'throws' = { title: 'Bitwarden vault' };
  const check = createSkipCheck(['bitwarden'], () => {
    reads++;
    if (now === 'throws') throw new Error('no window');
    return now;
  });
  assert.equal(check(), 'bitwarden');
  now = { title: 'Notepad' };
  assert.equal(check(), null, 'it looks again every time');
  now = null;
  assert.equal(check(), null);
  now = 'throws';
  assert.equal(check(), null);
  assert.equal(reads, 4);
  const none = createSkipCheck([], () => {
    reads++;
    return { title: 'x' };
  });
  assert.equal(none(), null);
  assert.equal(reads, 4);
});
