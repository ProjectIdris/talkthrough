import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVisualProbe, countMarkerPixels, MARKER } from '../scripts/prototypes/first-visual-probe.ts';
import type { SceneMessage } from '../src/shared/ipc.ts';

test('narration and rejected actions do not count as validated drawing output', () => {
  const messages: SceneMessage[] = [];
  let clock = 10;
  const probe = createVisualProbe(m => messages.push(m), () => clock);
  probe.push('{"steps":[{"say":"Words only","actions":[');
  assert.equal(probe.snapshot().firstPieceMs, 10);
  assert.equal(probe.snapshot().firstActionMs, null);
  clock = 20;
  probe.push('{"op":"not-a-scene-action"}');
  assert.equal(probe.snapshot().firstActionMs, 20);
  assert.equal(probe.snapshot().firstValidatedActionMs, null);
  assert.equal(messages.filter(m => m.kind === 'action').length, 0);
  probe.push(']}]}');
  const result = probe.end();
  assert.equal(result.completeSteps, 1);
  assert.equal(result.acceptedActions, 0);
  assert.ok(result.validationIssues > 0);
});

test('a valid action is delivered before the step closes, through the real validator', () => {
  const messages: SceneMessage[] = [];
  let clock = 100;
  const probe = createVisualProbe(m => messages.push(m), () => clock);
  const prefix = '{"steps":[{"say":"","actions":[' + JSON.stringify(MARKER);
  for (const c of prefix) probe.push(c);
  assert.equal(probe.snapshot().completeSteps, 0);
  assert.equal(probe.snapshot().firstValidatedActionMs, 100);
  assert.equal(probe.snapshot().firstSentActionMs, 100);
  const action = messages.find(m => m.kind === 'action');
  assert.ok(action && action.action.op === 'box');
  assert.equal(action.action.id, MARKER.id);
  assert.equal(messages[0]?.kind, 'begin');
  assert.ok(messages.some(m => m.kind === 'step-open'));
  clock = 150;
  probe.push(']}]}');
  const result = probe.end();
  assert.equal(result.firstStepMs, 150);
  assert.equal(result.acceptedActions, 1);
  assert.equal(messages.filter(m => m.kind === 'action').length, 1);
  assert.equal(result.validationIssues, 0);
  const snapshot = probe.snapshot();
  snapshot.acceptedActions = 999;
  assert.equal(probe.snapshot().acceptedActions, 1);
});

test('truncated fixture fails rather than reporting a completed answer', () => {
  const probe = createVisualProbe(() => {}, () => 0);
  probe.push('{"steps":[{"say":"unfinished');
  assert.throws(() => probe.end());
  assert.equal(probe.snapshot().firstValidatedActionMs, null);
});

test('pixel oracle excludes transparent, dim, ordinary chrome and out-of-region pixels', () => {
  const bitmap = new Uint8Array(640 * 480 * 4);
  const put = (x: number, y: number, bgra: number[]) => bitmap.set(bgra, (y * 640 + x) * 4);
  put(200, 200, [255, 0, 255, 255]);
  put(201, 200, [128, 0, 128, 128]); // premultiplied translucent magenta
  put(202, 200, [255, 0, 255, 0]);
  put(203, 200, [20, 0, 20, 255]);
  put(204, 200, [255, 200, 124, 255]); // UI blue
  put(205, 200, [255, 255, 255, 255]);
  put(10, 10, [255, 0, 255, 255]);
  assert.equal(countMarkerPixels(bitmap, 640, 480), 2);
});

test('pixel oracle refuses wrong dimensions and incomplete buffers', () => {
  assert.throws(() => countMarkerPixels(new Uint8Array(10), 640, 480));
  assert.throws(() => countMarkerPixels(new Uint8Array(4), 1, 1));
  assert.throws(() => countMarkerPixels(new Uint8Array(), NaN, 480));
});
