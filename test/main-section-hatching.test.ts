import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MeshStandardMaterial } from 'three';
import type { WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three';
import { hatched } from '../src/overlay/materials.ts';
import { electronRuntime } from './support/electron-runtime.ts';

// Executes the actual emitted material patch, not a separate TS implementation of
// the filter. The small raw WebGL probe isolates coverage from lighting/tonemapping.
test('native section shader averages dense stripes and preserves close-up shape', { timeout: 60_000 }, (t) => {
  const runtime = electronRuntime();
  if (runtime.reason) return t.skip(runtime.reason);
  const out = mkdtempSync(join(tmpdir(), 'tt-section-filter-'));
  const material = new MeshStandardMaterial();
  try {
    hatched(material);
    const shader = {
      vertexShader: 'void main() {\n#include <begin_vertex>\n}',
      fragmentShader: '#version 300 es\nprecision highp float;\nout vec4 outColor;\nvoid main() {\nvec4 diffuseColor = vec4(1.0);\n#include <color_fragment>\noutColor = diffuseColor;\n}',
      uniforms: {},
    };
    material.onBeforeCompile(shader as WebGLProgramParametersWithUniforms, {} as WebGLRenderer);
    writeFileSync(join(out, 'fragment.glsl'), shader.fragmentShader.replace('varying vec3', 'in vec3').replace('#include <color_fragment>', ''));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const run = spawnSync(runtime.executable!, [resolve('test/support/section-hatching.cjs'), out], { env, encoding: 'utf8', timeout: 50_000 });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    const result = JSON.parse(readFileSync(join(out, 'result.json'), 'utf8'));
    assert.equal(result.cases, 144);
    assert.ok(result.samples >= 9000);
    assert.deepEqual(result.failures, [], JSON.stringify(result));
    assert.ok(result.maxError <= 2.5 / 255, JSON.stringify(result));
    t.diagnostic(JSON.stringify(result));
  } finally {
    material.dispose();
    rmSync(out, { recursive: true, force: true });
  }
});
