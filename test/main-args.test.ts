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
  assert.deepEqual(o.grab, { scenes: ['a.json'], steps: [{ step: 0, t: 0.5 }, { step: 2, t: 3 }], out: 'o', width: 800, height: 600, scaleFactor: 2 });
});

test('several scene files make one thread', () => {
  const o = parseArgs(['--grab', 'a.json,b.json', '--out', 'o']);
  assert.deepEqual(o.grab?.scenes, ['a.json', 'b.json']);
});

test('bad values are refused with a clear message', () => {
  assert.throws(() => parseSteps('x:1'), /bad --steps/);
  assert.throws(() => parseSteps('1:-2'), /bad --steps/);
  assert.throws(() => parseSize('big'), /bad --size/);
  assert.throws(() => parseArgs(['--max-seconds', '0']), /positive/);
  assert.throws(() => parseArgs(['--out']), /needs a value/);
});

test('a frame grab can ask for a turned, zoomed or opened view', () => {
  assert.deepEqual(parseSteps('7:20'), [{ step: 7, t: 20 }]);
  assert.deepEqual(parseSteps('7:20:55:22'), [{ step: 7, t: 20, view: { az: 55, el: 22 } }]);
  assert.deepEqual(parseSteps('7:20::::1'), [{ step: 7, t: 20, view: { explode: 1 } }]);
  assert.deepEqual(parseSteps('7:20:-30:10:1.5:0.5,0:1'), [{ step: 7, t: 20, view: { az: -30, el: 10, zoom: 1.5, explode: 0.5 } }, { step: 0, t: 1 }]);
  assert.throws(() => parseSteps('7:20:a'), /az is not a number/);
});

test('a check can ask for more detail a while after the first answer', () => {
  assert.equal(parseArgs([]).detailAfter, undefined);
  assert.equal(parseArgs(['--detail-after', '2']).detailAfter, 2);
  assert.throws(() => parseArgs(['--detail-after', '-1']), /zero or more/);
});
