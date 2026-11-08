import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { claudeInitializeLine } from '../src/adapters/claude-model.ts';
import { sceneSchemaLean, sceneSchemaChain } from '../src/scene/schema.ts';

const receiver = fileURLToPath(new URL('./support/schema-stdin-receiver.mjs', import.meta.url));
test('a local process receives the generated schema, whole, in the first line of its input', { skip: process.platform !== 'win32' }, () => {
  for (const schema of [sceneSchemaLean, sceneSchemaChain]) {
    const line = claudeInitializeLine(schema);
    assert.ok(line.endsWith('\n') && !line.slice(0, -1).includes('\n'), 'one line');
    const child = spawnSync(process.execPath, [receiver], {
      windowsHide: true, shell: false, input: line, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.status, 0, child.stderr);
    const body = line.slice(0, -1);
    assert.deepEqual(JSON.parse(child.stdout), { length: body.length, hash: createHash('sha256').update(body).digest('hex') });
  }
});
