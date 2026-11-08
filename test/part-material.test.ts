import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh } from 'three';
import type { Material } from 'three';
import { validateScene } from '../src/scene/index.ts';
import type { Scene } from '../src/scene/types.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';

// A kit part may name a material: the pieces its colour tints are made of it, so a steel pulley is steel all through and not steel with a black rubber tyre.

const wheel = (extra: Record<string, unknown> = {}) => ({ op: 'add', shape: 'part', part: 'wheel', id: 'w', size: [2, 2, 0.5], n: 6, ...extra });
const sceneOf = (part: Record<string, unknown>): Scene => ({ steps: [{ say: 'a wheel', actions: [{ op: 'panel', x: 100, y: 100, w: 800, h: 800 }, part] }] }) as unknown as Scene;
const surfaces = (part: Record<string, unknown>): string[] => {
  const scene = sceneOf(part);
  const result = validateScene(scene);
  assert.deepEqual(result.issues.filter((i) => /unknown|ignored/.test(i.message)), [], 'the field is part of the language');
  const frame = frameAt(result.scene!.steps, 0, 99);
  const panel = new PanelScene({ tier: 'high' });
  try {
    panel.sync(frame, 1);
    const root = panel.nodeOf(frame.objects.find((o) => o.id === 'w')!.key)!;
    const names = new Set<string>();
    root.traverse((o) => { if (o instanceof Mesh) names.add(((o.material as Material).userData as { name?: string }).name ?? '?'); });
    return [...names].sort();
  } finally { panel.destroy(); }
};

test('a wheel with a material is that material all through; without one it keeps its black rubber tyre', () => {
  assert.ok(surfaces(wheel()).includes('rubber'), 'no material: the tyre is rubber');
  const steel = surfaces(wheel({ material: 'steel' }));
  assert.ok(!steel.includes('rubber'), `with steel there is no rubber tyre (${steel.join(',')})`);
  assert.ok(steel.includes('steel'));
});

test('the fixed-colour details of a part keep their own surface when it is given a material', () => {
  // the wheel's two bright cap discs are fixed-colour metal and stay `metal`
  assert.ok(surfaces(wheel({ material: 'brass' })).includes('metal'));
});
