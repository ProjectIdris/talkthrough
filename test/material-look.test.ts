import test from 'node:test';
import assert from 'node:assert/strict';
import { MeshPhysicalMaterial, ShaderLib } from 'three';
import { TIERS, makeSurface } from '../src/overlay/materials.ts';
import type { Tier } from '../src/overlay/materials.ts';
import { materialRow } from '../src/scene/material-library.ts';
import { readFileSync } from 'node:fs';

// What light does inside a material (surface-look.ts): the glow of flesh and wax, the depth of water, the shape of what shines, the finish that tells one
// bright metal from another. The stock shader is three's own, so these tests patch it for real and look for what each layer must have put in.

const compile = (m: MeshPhysicalMaterial): { vertexShader: string; fragmentShader: string; uniforms: Record<string, { value: number }> } => {
  const shader = { uniforms: {} as Record<string, { value: number }>, vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader };
  m.onBeforeCompile(shader as never, undefined as never);
  return shader;
};
const key = (name: string, tier: Tier): string => makeSurface(name, TIERS[tier]).customProgramCacheKey();

test('the look is a tier choice: low keeps the stock shader, mid and high add the layers a material asks for', () => {
  const stock = key('plastic', 'low');
  for (const name of ['organ', 'water', 'ember', 'led', 'mirror', 'butter']) assert.equal(key(name, 'low'), stock, `${name} on low is the stock shader`);
  for (const tier of ['mid', 'high'] as const) {
    assert.match(key('organ', tier), /LOOK_SSS/);
    assert.match(key('water', tier), /LOOK_LIQUID/);
    assert.match(key('led', tier), /LOOK_GLOW/);
    assert.match(key('neon', tier), /LOOK_GLOW/);
    assert.match(key('ember', tier), /LOOK_CRUST/);
    assert.match(key('mirror', tier), /LOOK_ENV/);
    assert.doesNotMatch(key('steel', tier), /LOOK_/, 'a plain metal asks for none of it');
    assert.doesNotMatch(key('oak', tier), /LOOK_/);
  }
});

test('each layer patches the stage it needs in three\'s own physical shader', () => {
  const sss = compile(makeSurface('organ', TIERS.mid)).fragmentShader;
  assert.match(sss, /outgoingLight \+= deep \* lookSss/);
  assert.match(sss, /#define LOOK_SSS/);
  const water = compile(makeSurface('water', TIERS.mid)).fragmentShader;
  for (const part of ['diffuseColor.a = clamp(diffuseColor.a * mix(0.6, 1.3, fr)', 'normal = normalize(abs(fDet) * normal - vGrad)', 'smoothstep(0.1, 0.85, -normal.y)']) assert.ok(water.includes(part), part);
  const ember = compile(makeSurface('ember', TIERS.high));
  assert.match(ember.fragmentShader, /lookCrack = mix\(smoothstep\(0\.8, 0\.95, ridge\)/);
  assert.match(ember.fragmentShader, /totalEmissiveRadiance = mix\(hot \* 0\.06/);
  assert.match(ember.vertexShader, /vLookP = position/);
  const lens = compile(makeSurface('led', TIERS.mid)).fragmentShader;
  assert.match(lens, /pow\(ndv, 6\.0\)/);
  assert.match(lens, /diffuseColor\.rgb \*= 0\.3/);
  const mirror = compile(makeSurface('mirror', TIERS.mid));
  assert.match(mirror.fragmentShader, /radiance \*= lookEnv/);
  assert.equal(mirror.uniforms.lookEnv!.value, 1.3);
  // The look sits on top of the fine surface, not instead of it: an organ has both its pattern and its glow.
  const organ = compile(makeSurface('organ', TIERS.mid)).fragmentShader;
  assert.ok(organ.includes('patMottle(q') && organ.includes('#define MICRO_PATTERN') && organ.includes('lookSss'));
});

test('the look is cheap: no more than one extra program shape per set of layers, and a program is shared by every material that asks for the same', () => {
  assert.equal(key('organ', 'mid'), key('vessel', 'mid'), 'organ and vessel have the same layers (only numbers differ)');
  assert.equal(key('led', 'mid'), key('neon', 'mid'), 'a lens and a tube differ only in a uniform');
  const lens = makeSurface('led', TIERS.mid), tube = makeSurface('neon', TIERS.mid);
  assert.notEqual(compile(lens).uniforms.lookGlow!.value, compile(tube).uniforms.lookGlow!.value);
});

test('the bright metals read as different finishes: a mirror, chrome, silver, aluminium and stainless differ in tint or in roughness, and the brushed ones carry the streaks', () => {
  const metals = ['mirror', 'chrome', 'silver', 'aluminium', 'stainless'];
  const info = metals.map((name) => ({ name, rough: makeSurface(name, TIERS.high).roughness, rgb: materialRow(name)!.color }));
  for (let i = 0; i < info.length; i++) for (let j = i + 1; j < info.length; j++) {
    const a = info[i]!, b = info[j]!;
    const tint = Math.hypot(a.rgb[0] - b.rgb[0], a.rgb[1] - b.rgb[1], a.rgb[2] - b.rgb[2]);
    assert.ok(tint >= 20 || Math.abs(a.rough - b.rough) >= 0.08, `${a.name} and ${b.name} are told apart (tint ${tint.toFixed(0)}, roughness ${a.rough} against ${b.rough})`);
  }
  assert.ok(info[0]!.rough < info[1]!.rough && info[1]!.rough < info[2]!.rough, 'mirror, then chrome, then silver, from the sharpest');
  assert.ok(info[3]!.rough > info[2]!.rough, 'aluminium is more satin than silver');
  for (const name of ['aluminium', 'stainless', 'titanium']) assert.match(key(name, 'mid'), /MICRO_PATTERN/, `${name} is brushed`);
  for (const name of ['mirror', 'chrome', 'silver']) assert.doesNotMatch(key(name, 'mid'), /MICRO_PATTERN/, `${name} is polished`);
});

test('water is a liquid with depth, and the soft and organic materials have the layers that give them character', () => {
  const water = makeSurface('water', TIERS.mid);
  assert.ok(water.userData.base <= 0.55 && water.transparent, 'clear in the middle');
  assert.equal(water.ior, 1.33);
  for (const name of ['oil', 'blood', 'honey']) assert.match(key(name, 'mid'), /LOOK_LIQUID/, `${name} has depth`);
  for (const name of ['organ', 'vessel', 'nerve', 'petal', 'fruit', 'butter', 'wax', 'fat', 'skin', 'muscle']) {
    assert.match(key(name, 'mid'), /LOOK_SSS/, `${name} scatters light`);
  }
  for (const name of ['organ', 'vessel', 'nerve', 'petal', 'fruit', 'butter', 'sugar', 'wax', 'fat']) assert.match(key(name, 'mid'), /MICRO_PATTERN/, `${name} has a surface pattern`);
  assert.doesNotMatch(key('organ', 'low'), /MICRO_PATTERN/, 'low has no patterns');
});

test('a recipe sets how strongly it shows the room only through `env`: three ignores a material\'s own envMapIntensity when the room is the scene\'s environment', () => {
  const source = readFileSync(new URL('../src/overlay/materials.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source.replace(/\/\*\*[\s\S]*?\*\//g, ''), /envMapIntensity/, 'no recipe carries the dead value');
  for (const name of ['steel', 'glass', 'water', 'gold', 'plastic']) assert.equal(makeSurface(name, TIERS.mid).envMapIntensity, 1, name);
});
