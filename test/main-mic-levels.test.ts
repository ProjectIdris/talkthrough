import assert from 'node:assert/strict';
import { test } from 'node:test';
import { micLevels } from '../src/main/mic-levels.ts';
import { createPrefs } from '../src/main/prefs.ts';
import { parseArgs } from '../src/main/args.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('levels: silence is flat, a loud part is high, and each bar is a fifth of a second', () => {
  const rate = 16000;
  const clip = new Float32Array(rate); // one second
  for (let i = rate / 2; i < rate; i++) clip[i] = Math.sin(i / 8) * 0.3;
  const levels = micLevels(clip, rate);
  assert.equal(levels.length, 5);
  assert.ok(levels[0]! < 0.001 && levels[1]! < 0.001, 'the quiet half');
  assert.ok(levels[3]! > 0.6 && levels[4]! > 0.6, 'the loud half');
  assert.ok(levels.every((l) => l >= 0 && l <= 1));
  assert.deepEqual(micLevels(new Float32Array(0), rate), []);
});

test('the first run is remembered in the app\'s own preferences, and --first-run asks for it again', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tt-prefs-'));
  try {
    const file = join(dir, 'prefs.json');
    assert.equal(createPrefs(file).get().firstRunDone, false);
    createPrefs(file).set({ firstRunDone: true });
    assert.equal(createPrefs(file).get().firstRunDone, true);
    assert.equal(createPrefs(file).get().pinScreenshot, false, 'the other preference is not disturbed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(parseArgs([]).firstRun, false);
  assert.equal(parseArgs(['--first-run']).firstRun, true);
});
