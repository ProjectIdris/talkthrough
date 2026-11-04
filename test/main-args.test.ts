import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, parseSize, parseSteps } from '../src/main/args.ts';

test('a normal launch has no options set', () => {
  const o = parseArgs(['.']);
  assert.equal(o.grab, undefined);
  assert.equal(o.gpu, false);
  assert.equal(o.visibleToCapture, false);
  assert.equal(o.exitAfterChord, 0);
});

test('grab needs an output folder and reads steps and size', () => {
  assert.throws(() => parseArgs(['--grab', 'a.json']), /--out/);
  const o = parseArgs(['--grab', 'a.json', '--out', 'o', '--steps', '0:0.5,2:3', '--size', '800x600', '--scale', '2']);
  assert.deepEqual(o.grab, { scene: 'a.json', steps: [{ step: 0, t: 0.5 }, { step: 2, t: 3 }], out: 'o', width: 800, height: 600, scaleFactor: 2 });
});

test('bad values are refused with a clear message', () => {
  assert.throws(() => parseSteps('x:1'), /bad --steps/);
  assert.throws(() => parseSteps('1:-2'), /bad --steps/);
  assert.throws(() => parseSize('big'), /bad --size/);
  assert.throws(() => parseArgs(['--max-seconds', '0']), /positive/);
  assert.throws(() => parseArgs(['--out']), /needs a value/);
});
