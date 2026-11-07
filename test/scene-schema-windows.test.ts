import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { claudeArgs } from '../src/adapters/claude-model.ts';
import { sceneSchemaLean, sceneSchemaChain } from '../src/scene/schema.ts';

const receiver = fileURLToPath(new URL('./support/schema-argv-receiver.mjs', import.meta.url));
test('Windows starts a harmless local process with intact generated schema argv', { skip: process.platform !== 'win32' }, () => {
  for (const schema of [sceneSchemaLean, sceneSchemaChain]) {
    const args = claudeArgs('claude-haiku-5-5', 'low', schema, 'C:\\Users\\Sample User\\AppData\\Local\\Temp\\talkthrough-model-123456\\instructions.txt');
    // Match the provider adapter's default quoting and hidden, shell-free spawn.
    const child = spawnSync(process.execPath, [receiver, ...args], {
      windowsHide: true, shell: false, windowsVerbatimArguments: false,
      stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), {
      count: args.length, hash: createHash('sha256').update(JSON.stringify(args)).digest('hex'),
    });
  }
});
