import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVisualProbe } from '../scripts/prototypes/first-visual-probe.ts';
import { USEFUL_3D_ACTIONS, inspectUseful3dPixels } from '../scripts/prototypes/first-useful-3d.ts';
import type { SceneMessage } from '../src/shared/ipc.ts';

test('the two-gear candidate streams through the real validator before its step closes', () => {
  const sent: SceneMessage[] = [];
  const probe = createVisualProbe(message => sent.push(message), () => 20);
  const prefix = '{"steps":[{"say":"","actions":[' + USEFUL_3D_ACTIONS.map(a => JSON.stringify(a)).join(',');
  for (const char of prefix) probe.push(char);
  assert.equal(probe.snapshot().completeSteps, 0);
  assert.equal(probe.snapshot().acceptedActions, 4);
  assert.equal(sent.filter(message => message.kind === 'action' && message.action.op === 'add').length, 2);
  probe.push(']}]}');
  assert.equal(probe.end().validationIssues, 0);
});

function bitmap() {
  const data = new Uint8Array(640 * 480 * 4);
  return { data, rect(x: number, y: number, w: number, h: number, bgra: number[]) {
    for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) data.set(bgra, (row * 640 + col) * 4);
  } };
}

test('substantial 3D candidate requires both colours with area and two-dimensional extent', () => {
  const image = bitmap();
  image.rect(200, 160, 40, 40, [160, 0, 160, 255]);
  assert.equal(inspectUseful3dPixels(image.data, 640, 480).qualifies, false);
  image.rect(360, 160, 40, 40, [0, 160, 0, 255]);
  const result = inspectUseful3dPixels(image.data, 640, 480);
  assert.equal(result.qualifies, true);
  assert.equal(result.magenta.pixels, 1600);
  assert.equal(result.green.pixels, 1600);
  assert.equal(result.magenta.width, 40);
  assert.equal(result.green.height, 40);
});

test('tiny marks, a long thin stroke, chrome, transparency and outside pixels cannot qualify', () => {
  const image = bitmap();
  image.rect(200, 160, 2, 2, [255, 0, 255, 255]);
  image.rect(360, 160, 2, 2, [0, 255, 0, 255]);
  assert.equal(inspectUseful3dPixels(image.data, 640, 480).qualifies, false);
  image.rect(100, 200, 400, 3, [255, 0, 255, 255]);
  image.rect(100, 210, 400, 3, [0, 255, 0, 255]);
  assert.equal(inspectUseful3dPixels(image.data, 640, 480).qualifies, false);
  const noise = bitmap();
  noise.rect(0, 0, 60, 50, [255, 0, 255, 255]);
  noise.rect(200, 160, 40, 40, [255, 0, 255, 0]);
  noise.rect(360, 160, 40, 40, [255, 200, 124, 255]);
  assert.equal(inspectUseful3dPixels(noise.data, 640, 480).magenta.pixels, 0);
  assert.equal(inspectUseful3dPixels(noise.data, 640, 480).green.pixels, 0);
});

test('the 3D oracle refuses malformed bitmaps rather than granting visual evidence', () => {
  assert.throws(() => inspectUseful3dPixels(new Uint8Array(4), 640, 480));
  assert.throws(() => inspectUseful3dPixels(new Uint8Array(4), 1, 1));
});
