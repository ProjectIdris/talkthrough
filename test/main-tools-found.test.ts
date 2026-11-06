import assert from 'node:assert/strict';
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
  assert.equal(onPath('codex', { env: { PATH: '/usr/bin:/opt/bin' }, platform: 'linux', isFile: (p) => p === '/opt/bin/codex' }), true);
});


test('Windows paths with spaces and an explicit executable extension use Windows separators on every host', () => {
  const env = { Path: String.raw`C:\Program Files\Tools;D:\Other Tools`, PATHEXT: '.EXE;.CMD' };
  const isFile = present(String.raw`C:\Program Files\Tools\codex.exe`);
  assert.equal(onPath('codex.exe', { env, platform: 'win32', isFile }), true);
  assert.equal(onPath('codex', { env, platform: 'win32', isFile }), true);
});

test('an explicit POSIX command path is checked without Windows executable suffixes', () => {
  assert.equal(onPath('/opt/bin/codex', { env: { PATH: '/other', PATHEXT: '.EXE;.CMD' }, platform: 'linux', isFile: (p) => p === '/opt/bin/codex' }), true);
  assert.equal(onPath('codex', { env: { PATH: '/opt/bin', PATHEXT: '.EXE;.CMD' }, platform: 'linux', isFile: (p) => p === '/opt/bin/codex.exe' }), false);
});
