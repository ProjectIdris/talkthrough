import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeArgs, claudeInitializeLine } from '../src/adapters/claude-model.ts';
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

test('the schema is not in the command line, which stays small whatever the schema grows to', () => {
  const executable = 'C:\\Program Files\\Talkthrough\\provider\\claude.exe';
  const instructions = 'C:\\Users\\Sample User\\AppData\\Local\\Temp\\talkthrough-model-123456\\instructions.txt';
  const args = claudeArgs('claude-haiku-5-5', 'low', instructions);
  assert.ok(!args.includes('--json-schema'), 'the flag takes the schema inline, in the command line: it is sent on the input instead');
  const length = windowsCommandLineLength(executable, args);
  assert.ok(length < 2_000, `${length} UTF-16 units after default spawn quoting`);
});

test('the schema goes in the opening control request, and a size cap keeps it from swelling the prompt unnoticed', () => {
  for (const schema of [sceneSchemaLean, sceneSchemaChain]) {
    const line = claudeInitializeLine(schema);
    const sent = JSON.parse(line) as { type: string; request: { subtype: string; jsonSchema: unknown } };
    assert.equal(sent.type, 'control_request');
    assert.equal(sent.request.subtype, 'initialize');
    assert.deepEqual(sent.request.jsonSchema, JSON.parse(JSON.stringify(schema)));
    // No longer a command-line limit, but every byte of it is read by the model on each call: about 26 KB today, so room to grow, not to double.
    assert.ok(line.length < 48_000, `the schema line is ${line.length} characters`);
  }
});
