import assert from 'node:assert/strict';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { findTools, onPath } from '../src/main/tools-found.ts';

const present = (...paths: string[]) => (p: string) => paths.some((x) => x.toLowerCase() === p.toLowerCase());

test('a program is found along the PATH with the extensions Windows runs, and not where it is not', () => {
  const env = { PATH: 'C:\\Tools;C:\\Users\\me\\bin', PATHEXT: '.COM;.EXE;.CMD' };
  const isFile = present('C:\\Users\\me\\bin\\claude.cmd');
  assert.equal(onPath('claude', { env, platform: 'win32', isFile }), true);
  assert.equal(onPath('codex', { env, platform: 'win32', isFile }), false);
});

test('a path named in the settings is looked at as it is', () => {
  const isFile = present('D:\\apps\\claude.exe');
  assert.deepEqual(findTools({ claudeCommand: 'D:\\apps\\claude.exe' }, { env: { PATH: '' }, platform: 'win32', isFile }), { claude: true, codex: false });
  assert.deepEqual(findTools({ codexCommand: 'D:\\gone\\codex.exe' }, { env: { PATH: 'C:\\x' }, platform: 'win32', isFile }), { claude: false, codex: false });
});

test('on other systems the name is looked for as it is', () => {
  assert.equal(onPath('codex', { env: { PATH: ['usrbin', 'optbin'].join(delimiter) }, platform: 'linux', isFile: (p) => p === join('optbin', 'codex') }), true);
});
