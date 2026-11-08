import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isCheckRun, parseArgs, parseSize, parseSteps, realScreenRefusal, wantsSoftware } from '../src/main/args.ts';

test('a normal launch has no options set', () => {
  const o = parseArgs(['.']);
  assert.equal(o.grab, undefined);
  assert.equal(o.gpu, false);
  assert.equal(o.software, false);
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

test('grab layout attempts are bounded and optional', () => {
  const base = ['--grab', 'a.json', '--out', 'o'];
  assert.equal(parseArgs(base).grab?.layoutSeeks, undefined);
  assert.equal(parseArgs([...base, '--layout-seeks', '0']).grab?.layoutSeeks, undefined);
  assert.equal(parseArgs([...base, '--layout-seeks', '30', '--grab-metadata']).grab?.layoutSeeks, 30);
  assert.equal(parseArgs([...base, '--layout-seeks', '30', '--grab-metadata']).grab?.metadata, true);
  for (const n of ['-1', '121', '1.5', 'NaN']) assert.throws(() => parseArgs([...base, '--layout-seeks', n]), /layout-seeks/);
  assert.throws(() => parseArgs(['--layout-seeks', '2']), /--grab/);
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

test('a run with any development or check option is a check run (it takes no system-wide key); a person\'s own run is not', () => {
  assert.equal(isCheckRun(parseArgs(['.'])), false);
  assert.equal(isCheckRun(parseArgs(['.', '--gpu', '--log-steps', '--settings', 'prefs.json'])), false, 'options a person may use');
  const flags: string[][] = [['--self-chord'], ['--capture-image', 'page.png'], ['--exit-after-chord', '1'], ['--hidden'], ['--silent-voice'], ['--fake-mic'], ['--play-sample'], ['--no-hotkey'],
    ['--frames-dir', 'f'], ['--question', 'q'], ['--backdrop', 'b.png'], ['--max-seconds', '5'], ['--save-pen', 'p'], ['--fake-stroke', '1,1 2,2'], ['--chord-hold', '3000'], ['--detail-after', '2']];
  for (const flag of flags) assert.equal(isCheckRun(parseArgs(['.', ...flag])), true, flag.join(' '));
  // An option added later (a recording, a replay) counts without anyone remembering to list it.
  for (const extra of [{ replayAnswer: 'tape.json' }, { record: 'take.mp4' }, { drive: 'steps.json' }]) assert.equal(isCheckRun({ ...parseArgs(['.']), ...extra } as never), true, Object.keys(extra)[0]);
});

test('the graphics card is the default; software drawing only on --software or TALKTHROUGH_SOFTWARE=1', () => {
  assert.equal(wantsSoftware(parseArgs(['.']), {}), false);
  assert.equal(wantsSoftware(parseArgs(['.', '--gpu']), {}), false, '--gpu is the default now');
  assert.equal(wantsSoftware(parseArgs(['.', '--software']), {}), true);
  assert.equal(wantsSoftware(parseArgs(['.']), { TALKTHROUGH_SOFTWARE: '1' }), true);
  assert.equal(wantsSoftware(parseArgs(['.']), { TALKTHROUGH_GPU: '1' }), false, 'the old explicit switch still works (and means nothing new)');
  assert.equal(isCheckRun(parseArgs(['.', '--software'])), false, 'a person may use it');
});

test('a check run never looks at the real screen: without a stand-in picture or a tape it is refused, a person\'s own run and a run with either is not', () => {
  assert.equal(realScreenRefusal(parseArgs(['.'])), undefined, 'a person\'s own run');
  for (const flags of [['--hidden'], ['--self-chord'], ['--self-chord', '--question', 'q'], ['--silent-voice', '--exit-after-chord', '1'], ['--visible-to-capture', '--question', 'q']]) {
    assert.match(realScreenRefusal(parseArgs(['.', ...flags])) ?? '', /--capture-image/, flags.join(' '));
  }
  assert.equal(realScreenRefusal(parseArgs(['.', '--self-chord', '--question', 'q', '--capture-image', 'page.png'])), undefined, 'a stand-in picture');
  assert.equal(realScreenRefusal(parseArgs(['.', '--self-chord', '--replay-answer', 'tape.json'])), undefined, 'a tape asks no model and sends nothing');
});

test('both places the app grabs the real screen ask for the refusal first', () => {
  const main = readFileSync(new URL('../src/main/main.ts', import.meta.url), 'utf8');
  const grabs = main.match(/media\.capture\(display/g) ?? [];
  const guarded = main.match(/realScreenRefusal\(options\)/g) ?? [];
  assert.equal(grabs.length, 2);
  assert.ok(guarded.length >= grabs.length, 'each real grab is behind the refusal');
});
