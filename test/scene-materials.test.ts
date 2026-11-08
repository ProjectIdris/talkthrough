import test from 'node:test';
import assert from 'node:assert/strict';
import { MATERIAL_LIBRARY, MATERIAL_NAMES, fitTint, luminance, materialRow } from '../src/scene/material-library.ts';
import { MATERIALS, sceneGuide, sceneSchemaLean, createSceneState, validateStep } from '../src/scene/index.ts';
import { makeSurface, applySurface, RECIPES, SURFACE_LAYERS, TIERS } from '../src/overlay/materials.ts';
import { MATERIAL_COLOR, defaultColor } from '../src/overlay/timeline.ts';
import type { AddAction } from '../src/scene/index.ts';

const banded = MATERIAL_LIBRARY.filter((m) => 'band' in m);

test('the library is one list: the schema enum, the default colours and the guide all carry every name', () => {
  assert.deepEqual([...MATERIALS], [...MATERIAL_NAMES]);
  for (const name of ['bone', 'muscle', 'tendon', 'skin', 'steel', 'iron', 'brass', 'copper', 'wood', 'rope', 'water', 'plastic', 'rubber', 'glass']) assert.ok(MATERIAL_NAMES.includes(name as never), name);
  const schema = JSON.stringify(sceneSchemaLean);
  for (const m of MATERIAL_LIBRARY) {
    assert.ok(schema.includes(`"${m.name}"`), `${m.name} is in the schema`);
    assert.ok(sceneGuide.includes(m.name), `${m.name} is in the guide`);
    assert.deepEqual(MATERIAL_COLOR[m.name], [...m.color], `${m.name} has its default colour`);
  }
  assert.deepEqual(defaultColor({ op: 'add', shape: 'sphere', id: 'a', size: [1, 1, 1], material: 'bone' } as AddAction), [...(materialRow('bone')!.color)]);
});

test('every material has a recipe the renderer can make, and a banded one holds its own default', () => {
  for (const m of MATERIAL_LIBRARY) {
    const surface = makeSurface(m.name, TIERS.mid);
    assert.equal(surface.userData.name, m.name);
    if ('band' in m) {
      const y = luminance(m.color);
      assert.ok(y >= m.band[0] && y <= m.band[1], `${m.name}: its own colour (${y.toFixed(3)}) is inside its band ${m.band}`);
    }
  }
});

test('a tint gives a banded material a hue but never takes it out of its band: bone tinted white or black is still bone-toned', () => {
  for (const m of banded) {
    const [lo, hi] = m.band;
    for (const tint of [[255, 255, 255], [0, 0, 0], [255, 0, 0], [0, 0, 255], [255, 255, 0]] as const) {
      const y = luminance(fitTint(m.name, tint));
      assert.ok(y >= lo - 1e-6 && y <= hi + 1e-6, `${m.name} tinted ${tint}: ${y.toFixed(3)} is inside ${lo} to ${hi}`);
    }
    // A tint already inside the band is taken as written, and the colour a scene wrote for an unbanded material is never touched.
    assert.deepEqual(fitTint(m.name, m.color), m.color);
  }
  assert.deepEqual(fitTint('plastic', [255, 255, 255]), [255, 255, 255]);
  assert.deepEqual(fitTint('metal', [0, 0, 0]), [0, 0, 0]);
  assert.deepEqual(fitTint(undefined, [255, 255, 255]), [255, 255, 255]);
  // The hue survives: a red tint on bone is redder than bone, not grey.
  const [r, g, b] = fitTint('bone', [200, 60, 60]);
  assert.ok(r > g && r > b, 'a red tint stays red');
});

test('the renderer draws a white bone at its palest bone, and an unbanded plastic exactly white', () => {
  const bone = makeSurface('bone', TIERS.mid);
  applySurface(bone, [255, 255, 255], 1, 0, undefined);
  // The colour is held in linear light, where relative luminance is the weighted sum of the channels.
  const y = 0.2126 * bone.color.r + 0.7152 * bone.color.g + 0.0722 * bone.color.b;
  assert.ok(y <= materialRow('bone')!.band![1] + 1e-6, `white bone is held down to ${y.toFixed(3)}`);
  const plastic = makeSurface('plastic', TIERS.mid);
  applySurface(plastic, [255, 255, 255], 1, 0, undefined);
  assert.equal(plastic.color.r, 1);
});

test('a surface layer registered by name runs once when a material that names it is made, and a name nothing is registered for is skipped', () => {
  let calls = 0;
  SURFACE_LAYERS.test_layer = (m) => { calls++; m.roughness = 0.123; };
  try {
    // Naming the layer in a recipe is the whole of wiring one (the fibre layer plugs in this way).
    assert.equal(calls, 0);
    RECIPES.muscle.layers = ['test_layer', 'not_registered'];
    const material = makeSurface('muscle', TIERS.mid);
    assert.equal(calls, 1);
    assert.equal(material.roughness, 0.123);
    assert.notEqual(makeSurface('bone', TIERS.mid).roughness, 0.123, 'a material that names no layer is untouched');
  } finally {
    delete SURFACE_LAYERS.test_layer;
    delete RECIPES.muscle.layers;
  }
});

test('a scene that names a new material is kept, and one that names a material that does not exist is refused', () => {
  const step = (material: string) => ({ say: 'x', actions: [{ op: 'add', shape: 'cylinder', id: 'humerus', size: [0.3, 2, 0.3], material, color: 'white' }] });
  const kept = validateStep(step('bone'), createSceneState());
  assert.deepEqual(kept.issues, []);
  assert.ok(kept.step!.actions.some((a) => 'id' in a && a.id === 'humerus'));
  const refused = validateStep(step('unobtainium'), createSceneState());
  assert.ok(!refused.step || !refused.step.actions.some((a) => 'id' in a && a.id === 'humerus'));
});
