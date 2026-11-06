import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
// @ts-expect-error a plain script with no type declarations
import { launchElectron } from '../scripts/launch.mjs';

function fixture(env: Record<string, string> = { ELECTRON_RUN_AS_NODE: '1', PATH: 'tools' }) {
  const child = new EventEmitter();
  const exits: number[] = [], errors: string[] = [];
  let sent: { exe: string; args: string[]; options: { env: Record<string, string> } } | undefined;
  launchElectron('electron-program', ['.', '--no-hotkey'], {
    env,
    spawn: (exe: string, args: string[], options: { env: Record<string, string> }) => { sent = { exe, args, options }; return child; },
    exit: (code: number) => exits.push(code),
    error: (line: string) => errors.push(line),
  });
  return { child, exits, errors, env, get sent() { return sent; } };
}

test('launch removes Node mode only from the child environment and forwards arguments', () => {
  const f = fixture();
  assert.equal(f.sent?.exe, 'electron-program');
  assert.deepEqual(f.sent?.args, ['.', '--no-hotkey']);
  assert.deepEqual(f.sent?.options.env, { PATH: 'tools' });
  assert.equal(f.env.ELECTRON_RUN_AS_NODE, '1');
});

test('launch removes Node mode from the child environment regardless of key casing', () => {
  for (const key of ['ELECTRON_RUN_AS_NODE', 'electron_run_as_node', 'Electron_Run_As_Node']) {
    const env = { [key]: '1', PATH: 'tools' };
    const f = fixture(env);

    assert.deepEqual(f.sent?.options.env, { PATH: 'tools' }, `child env retained ${key}`);
    assert.equal(env[key], '1', `parent env changed for ${key}`);
  }
});

test('launch preserves normal application exit codes', () => {
  for (const code of [0, 1, 23]) {
    const f = fixture();
    f.child.emit('exit', code, null);
    assert.deepEqual(f.exits, [code]);
  }
});

test('a signal-terminated app cannot be reported as a successful start', () => {
  const f = fixture();
  f.child.emit('exit', null, 'SIGABRT');
  assert.deepEqual(f.exits, [1]);
  assert.match(f.errors.join('\n'), /SIGABRT/);
});

test('a launch error is reported once without an unhandled error event', () => {
  const f = fixture();
  f.child.emit('error', new Error('spawn ENOENT'));
  f.child.emit('exit', null, null);
  assert.deepEqual(f.exits, [1]);
  assert.match(f.errors.join('\n'), /could not start.*ENOENT/i);
});
