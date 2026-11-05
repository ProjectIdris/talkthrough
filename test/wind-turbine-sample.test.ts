import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateScene } from '../src/scene/index.ts';
import { frameAt } from '../src/overlay/timeline.ts';

test('turbine illustrates a connected rotor and faster output during the gearbox explanation', () => {
  const raw = JSON.parse(readFileSync('samples/scenes/wind-turbine.json', 'utf8'));
  const result = validateScene(raw);
  assert.ok(result.scene);
  assert.ok(result.issues.every((i) => i.message.startsWith('repaired:') && i.path.includes('.pts[')), JSON.stringify(result.issues));
  const a = frameAt(result.scene.steps, 4, 1);
  const b = frameAt(result.scene.steps, 4, 2);
  const z = (frame: typeof a, id: string) => {
    const part = frame.objects.find((o) => o.id === id);
    assert.ok(part, `missing ${id}`);
    return (part.pose?.rot ?? part.rot ?? [0, 0, 0])[2];
  };
  const rotor = z(b, 'hub') - z(a, 'hub');
  const slow = z(b, 'slow-gear') - z(a, 'slow-gear');
  const fast = z(b, 'fast-gear') - z(a, 'fast-gear');
  assert.equal(b.objects.find((o) => o.id === 'output-driver')?.parentKey, b.objects.find((o) => o.id === 'fast-gear')?.key, 'output remains attached to fast gear');
  assert.ok(Math.abs(rotor) > 1, 'rotor must keep moving');
  assert.ok(Math.abs(slow - rotor) < 0.01, 'slow gear follows rotor');
  assert.ok(Math.abs(fast + 2 * slow) < 0.01, 'meshed output turns twice as fast in reverse');

});
