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

const never = (): Promise<never> => new Promise(() => undefined);

test('the check reads the window each time it is asked, with the list as it is now, and reads nothing at all when there is no list', async () => {
  let reads = 0;
  let now: { title: string } = { title: 'Bitwarden vault' };
  let list: string[] = ['bitwarden'];
  const check = createSkipCheck(() => list, { read: async () => (reads++, now) });
  assert.deepEqual(await check(), { kind: 'listed', entry: 'bitwarden' });
  now = { title: 'Notepad' };
  assert.equal(await check(), null, 'it looks again every time');
  now = { title: 'My Bank - Chrome' };
  assert.equal(await check(), null);
  list = ['bitwarden', 'my bank']; // a list saved a moment ago protects at once
  assert.deepEqual(await check(), { kind: 'listed', entry: 'my bank' });
  const before = reads;
  list = [];
  assert.equal(await check(), null);
  assert.equal(reads, before, 'no list, no read');
});

test('a check that cannot tell what the window is says so and forbids the press: a throw, a rejection, nothing, nothing named, or no answer in time', async () => {
  const cases: Array<[string, () => Promise<{ title?: string } | null | undefined>]> = [
    ['rejects', async () => { throw new Error('boom'); }],
    ['throws at once', () => { throw new Error('boom'); }],
    ['null', async () => null],
    ['undefined', async () => undefined],
    ['empty', async () => ({})],
    ['blank names', async () => ({ title: '' })],
    ['never answers', never],
  ];
  for (const [name, read] of cases) {
    const lines: string[] = [];
    const check = createSkipCheck(() => ['bank'], { read, deadlineMs: 40, log: (l) => lines.push(l) });
    const verdict = await check();
    assert.equal(verdict?.kind, 'blind', name);
    await check();
    assert.equal(lines.length, 1, `${name}: said once`);
  }
});

test('a read that hangs is given up on at the deadline, not waited for', async () => {
  const check = createSkipCheck(() => ['bank'], { read: never, deadlineMs: 60 });
  const t0 = Date.now();
  const verdict = await check();
  const took = Date.now() - t0;
  assert.equal(verdict?.kind, 'blind');
  assert.ok(took >= 50 && took < 400, `about the deadline: ${took} ms`);
});

test('a read that answers late, after the deadline, changes nothing', async () => {
  let resolveLate: (w: { title: string }) => void = () => undefined;
  const check = createSkipCheck(() => ['bank'], { read: () => new Promise((r) => (resolveLate = r)), deadlineMs: 30 });
  assert.equal((await check())?.kind, 'blind');
  resolveLate({ title: 'Notepad' });
  await new Promise((r) => setTimeout(r, 10));
});
