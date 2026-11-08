import test from 'node:test';
import assert from 'node:assert/strict';
import { MATERIAL_FAMILIES, MATERIAL_LIBRARY, MATERIAL_NAMES, luminance, materialRow, resolveMaterial } from '../src/scene/material-library.ts';
import { norm } from '../src/scene/names.ts';
import { createSceneState, sceneGuide, sceneSchemaLean, validateStep } from '../src/scene/index.ts';
import { SURFACE_NAMES, TIERS, makeSurface } from '../src/overlay/materials.ts';
import type { Tier } from '../src/overlay/materials.ts';

// The wide material library: every name has a recipe the renderer can make on every tier, a name written another way is taken to the material meant (with a note), and a
// name nothing is close to is refused with the nearest. The guide holds the families, not every name.

test('the library is broad, and every material has a recipe, a colour, a family and no clash with another name', () => {
  assert.ok(MATERIAL_LIBRARY.length >= 100, `${MATERIAL_LIBRARY.length} materials`);
  for (const must of ['stainless', 'aluminium', 'cast-iron', 'bronze', 'gold', 'silver', 'chrome', 'rust', 'light-wood', 'dark-wood', 'oak', 'pine', 'walnut', 'plywood', 'bamboo', 'glossy-plastic', 'matte-plastic', 'clear-plastic', 'abs', 'nylon', 'foam', 'rubber', 'frosted-glass', 'tinted-glass', 'ceramic', 'porcelain', 'stone', 'concrete', 'brick', 'marble', 'sand', 'soil', 'cotton', 'denim', 'leather', 'wool', 'canvas', 'paper', 'cardboard', 'wax', 'water', 'oil', 'blood', 'bone', 'cartilage', 'muscle', 'tendon', 'fat', 'skin', 'organ', 'nerve', 'vessel', 'tooth', 'leaf', 'bark', 'petal', 'fruit', 'ice', 'snow', 'carbon-fibre', 'pcb', 'led', 'glow']) assert.ok(MATERIAL_NAMES.includes(must as never), must);
  assert.equal(new Set(MATERIAL_NAMES).size, MATERIAL_NAMES.length, 'no name twice');
  for (const m of MATERIAL_LIBRARY) {
    assert.ok(SURFACE_NAMES.includes(m.name as never), `${m.name} has a recipe`);
    assert.ok(MATERIAL_FAMILIES.includes(m.family), `${m.name} has a family`);
    if ('band' in m) { const y = luminance(m.color); assert.ok(y >= m.band[0] && y <= m.band[1], `${m.name} sits in its band`); }
  }
  // The kit's own surfaces keep their names: a material is never called the painted metal or the cut face.
  for (const kit of ['bead', 'enamel', 'cast', 'section']) assert.ok(!MATERIAL_NAMES.includes(kit as never), `${kit} is the kit's`);
});

test('a name is read as its own, an alias, the longest name it holds, or a slip; the rest are refused with the nearest', () => {
  // Own names and aliases all go to their owner, and no alias is two materials'.
  const owner = new Map<string, string>();
  for (const m of MATERIAL_LIBRARY) for (const label of [m.name, ...(('aliases' in m ? m.aliases : []) as readonly string[])]) {
    const n = norm(label);
    assert.ok(!owner.has(n) || owner.get(n) === m.name, `"${label}" is ${owner.get(n)}'s and ${m.name}'s`);
    owner.set(n, m.name);
    const got = resolveMaterial(label);
    assert.equal(got.name, m.name, `"${label}" is ${m.name}`);
    assert.equal(got.exact, label === m.name, `"${label}" exact`);
  }
  const is = (written: string, name: string): void => assert.equal(resolveMaterial(written).name, name, written);
  is('Stainless Steel', 'stainless');
  is('stainless steel pot', 'stainless');
  is('aluminum', 'aluminium');
  is('alumnium', 'aluminium');
  is('dark oak wood', 'oak');
  is('Cast_Iron', 'cast-iron');
  is('cast iron', 'cast-iron');
  is('blue denim jeans', 'denim');
  is('light blue plastic', 'plastic');
  is('red brick wall', 'brick');
  is('tooth enamel', 'tooth');
  assert.equal(resolveMaterial('enamel').name, 'tooth', 'enamel is the tooth, not the kit\'s painted metal');
  // Two particular materials in one name cannot be told apart: listed, not guessed.
  const tie = resolveMaterial('gold leaf');
  assert.equal(tie.name, undefined);
  assert.ok(tie.near.includes('gold') && tie.near.includes('leaf'));
  const none = resolveMaterial('unobtainium');
  assert.equal(none.name, undefined);
  assert.equal(resolveMaterial('').name, undefined);
  assert.equal(resolveMaterial(42).name, undefined);
  // A name that is no material's own never takes a prototype property for one.
  assert.equal(resolveMaterial('constructor').name, undefined);
  assert.equal(resolveMaterial('__proto__').name, undefined);
});

test('the validator keeps the material a name stands for, with a note, and refuses what nothing is close to, naming the families', () => {
  const run = (material: unknown) => validateStep({ say: 'x', actions: [{ op: 'add', shape: 'box', id: 'a', size: [1, 1, 1], material }] }, createSceneState());
  const own = run('oak');
  assert.deepEqual(own.issues, []);
  assert.equal((own.step!.actions[0] as { material?: string }).material, 'oak');
  const alias = run('stainless steel');
  assert.equal((alias.step!.actions[0] as { material?: string }).material, 'stainless');
  assert.ok(alias.issues.some((i) => /material "stainless steel" read as stainless/.test(i.message)), JSON.stringify(alias.issues));
  const bad = run('unobtainium');
  assert.ok(!bad.step || !bad.step.actions.length);
  assert.ok(bad.issues.some((i) => /unknown material "unobtainium"/.test(i.message) && /families are/.test(i.message)), JSON.stringify(bad.issues));
  const near = run('gold leaf');
  assert.ok(near.issues.some((i) => /the nearest are/.test(i.message) && /gold/.test(i.message)), JSON.stringify(near.issues));
  // The same on a path-shaped object (a tube) and a kit part, which take the field the same way.
  const tube = validateStep({ say: 'x', actions: [{ op: 'add', shape: 'tube', id: 't', pts: [[0, 0, 0], [1, 0, 0], [2, 1, 0]], radius: 0.1, material: 'sinew' }] }, createSceneState());
  assert.equal((tube.step!.actions[0] as { material?: string }).material, 'tendon');
});

test('the schema holds a material as plain text (the validator resolves it), and the guide stays inside its size', () => {
  const lean = JSON.stringify(sceneSchemaLean);
  assert.ok(!lean.includes('"tinted-glass"') && !lean.includes('"carbon-fibre"'), 'no enum of every name in the schema the model is held to');
  assert.ok(sceneGuide.length <= 44800, `the guide is ${sceneGuide.length}`);
  assert.ok(sceneGuide.includes('any other name goes to the nearest'));
});

test('every material makes a surface on every tier, and the see-through ones are marked, the glowing ones glow', () => {
  for (const tier of Object.keys(TIERS) as Tier[]) {
    for (const m of MATERIAL_LIBRARY) {
      const s = makeSurface(m.name, TIERS[tier]);
      assert.equal(s.userData.name, m.name);
      assert.ok(s.roughness >= 0 && s.roughness <= 1 && s.metalness >= 0 && s.metalness <= 1, `${m.name} ${tier}`);
    }
  }
  for (const name of ['water', 'glass', 'clear-plastic', 'acrylic', 'frosted-glass', 'tinted-glass', 'crystal', 'gem', 'ice', 'oil', 'blood', 'honey']) assert.ok(makeSurface(name, TIERS.low).userData.base < 1, `${name} is see-through`);
  for (const name of ['glow', 'led', 'neon', 'screen', 'ember']) assert.ok(makeSurface(name, TIERS.low).userData.glow > 0, `${name} glows`);
  for (const name of ['steel', 'chrome', 'gold', 'mirror', 'cast-iron', 'rust']) assert.ok(makeSurface(name, TIERS.low).metalness > 0.3, `${name} is metal`);
  for (const name of ['wool', 'velvet', 'silk', 'cotton']) assert.ok(makeSurface(name, TIERS.mid).sheen > 0, `${name} has the soft edge light of cloth`);
  assert.ok(makeSurface('ice', TIERS.mid).ior < 1.5 && makeSurface('gem', TIERS.mid).ior > 2);
  // On the lowest tier there is no finest surface (no program of its own); the higher tiers draw the pattern a material has.
  assert.equal(makeSurface('oak', TIERS.low).onBeforeCompile.toString().includes('micro'), false);
  assert.ok(makeSurface('oak', TIERS.mid).customProgramCacheKey().includes('MICRO_PATTERN'));
  assert.ok(!makeSurface('steel', TIERS.mid).customProgramCacheKey().includes('MICRO_PATTERN'));
  assert.ok(makeSurface('marble', TIERS.high).customProgramCacheKey().includes('MICRO_PATTERN'));
  assert.ok(materialRow('marble')!.family === 'stone');
});
