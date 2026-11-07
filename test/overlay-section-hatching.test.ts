import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createSceneState, validateScene } from '../src/scene/index.ts';
import assert from 'node:assert/strict';
import { MeshStandardMaterial, ShaderLib } from 'three';
import type { WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three';
import { hatched, makeSurface, TIERS } from '../src/overlay/materials.ts';

function patched(material: MeshStandardMaterial) {
  const shader = { vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader, uniforms: {} };
  material.onBeforeCompile(shader as WebGLProgramParametersWithUniforms, {} as WebGLRenderer);
  return shader;
}

test('section hatching filters the unwrapped world phase before periodic sampling', () => {
  const material = new MeshStandardMaterial();
  hatched(material);
  const shader = patched(material);
  assert.match(shader.fragmentShader, /fwidth\(capPhase\)/);
  assert.match(shader.fragmentShader, /filteredSectionHatch\(capPhase,\s*fwidth\(capPhase\)\)/);
  assert.match(shader.fragmentShader, /dot\(vCapWorld, vec3\(0\.78, 0\.55, 0\.3\)\) \/ 0\.16/);
  assert.match(shader.vertexShader, /modelMatrix \* vec4\(transformed, 1\.0\)/);
  assert.ok(shader.fragmentShader.indexOf('fwidth(capPhase)') < shader.fragmentShader.indexOf('#include <clipping_planes_fragment>'), 'derivatives precede clipping discards');
  assert.equal(material.customProgramCacheKey(), 'section-hatch-filtered-v1');
  material.dispose();
});

test('section and cut-cap materials share the filter while ordinary surfaces do not', () => {
  const section = makeSurface('section', TIERS.high);
  const ordinary = makeSurface('plastic', TIERS.high);
  const cap = new MeshStandardMaterial();
  hatched(cap);
  assert.equal(patched(section).fragmentShader, patched(cap).fragmentShader);
  assert.match(patched(section).fragmentShader, /filteredSectionHatch/);
  assert.doesNotMatch(patched(ordinary).fragmentShader, /filteredSectionHatch/);
  assert.equal(section.roughness, 0.7);
  assert.equal(section.metalness, 0.1);
  assert.equal(cap.stencilWrite, false, 'hatching does not alter stencil state');
  for (const material of [section, ordinary, cap]) material.dispose();
});

// The sample covers both consumers of the shared shader with unchanged geometry.
test('section filtering sample validates close, dense, grazing and return views without repair', () => {
  const input = JSON.parse(readFileSync(new URL('../samples/scenes/section-filtering.json', import.meta.url), 'utf8'));
  const result = validateScene(input, createSceneState());
  assert.deepEqual(result.issues, []);
  assert.equal(result.scene?.steps.length, 4);
  assert.deepEqual(result.scene, input);
});
