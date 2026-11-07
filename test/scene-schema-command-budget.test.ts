import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeArgs } from '../src/adapters/claude-model.ts';
import { sceneSchemaLean, sceneSchemaChain } from '../src/scene/schema.ts';
import { quoteWindowsArgument, windowsCommandLineLength } from './support/windows-command-line.ts';

test('Windows command quoting handles spaces, quotes and trailing backslashes', () => {
  assert.equal(quoteWindowsArgument('plain'), 'plain');
  assert.equal(quoteWindowsArgument(''), '""');
  assert.equal(quoteWindowsArgument('two words'), '"two words"');
  assert.equal(quoteWindowsArgument('say "hello"'), '"say \\"hello\\""');
  assert.equal(quoteWindowsArgument('C:\\two words\\'), '"C:\\two words\\\\"');
  assert.equal(quoteWindowsArgument('slash\\"quote'), '"slash\\\\\\"quote"');
});

test('generated lean and chain schema arguments leave Windows startup room after quoting', () => {
  const executable = 'C:\\Program Files\\Talkthrough\\provider\\claude.exe';
  const instructions = 'C:\\Users\\Sample User\\AppData\\Local\\Temp\\talkthrough-model-123456\\instructions.txt';
  for (const schema of [sceneSchemaLean, sceneSchemaChain]) {
    const args = claudeArgs('claude-haiku-5-5', 'low', schema, instructions);
    const length = windowsCommandLineLength(executable, args);
    assert.ok(length < 32_767 - 512, `${length} UTF-16 units after default spawn quoting; reserve 512 units for installation paths/options`);
  }
});
