import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MeshPhysicalMaterial } from 'three';
import type { WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three';
import { applyPathTreatment } from '../src/overlay/surface-treatment.ts';
import { electronRuntime } from './support/electron-runtime.ts';

// Compile and exercise the actual material patch, separately from lighting.
// The full physical material and sample still require native scene inspection.
test('native fibre shader keeps close detail and removes unresolved frequencies and cap pinching', { timeout: 60_000 }, t => {
  const runtime = electronRuntime();
  if (runtime.reason) return t.skip(runtime.reason);
  const out = mkdtempSync(join(tmpdir(), 'tt-path-treatment-'));
  const material = new MeshPhysicalMaterial();
  try {
    applyPathTreatment(material, 'fibres');
    const shader = {
      vertexShader: 'void main() { }',
      fragmentShader: '#version 300 es\nprecision highp float;\nout vec4 outColor;\nvoid main() {\nvec4 diffuseColor = vec4(0.5);\nfloat roughnessFactor = 0.5;\n#include <color_fragment>\n#include <roughnessmap_fragment>\noutColor = vec4(diffuseColor.r, roughnessFactor, 0.0, 1.0);\n}',
      uniforms: {},
    };
    material.onBeforeCompile(shader as WebGLProgramParametersWithUniforms, {} as WebGLRenderer);
    writeFileSync(join(out, 'fragment.glsl'), shader.fragmentShader.replace('varying vec3', 'in vec3').replace('#include <color_fragment>', '').replace('#include <roughnessmap_fragment>', ''));
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const run = spawnSync(runtime.executable!, [resolve('test/support/path-surface-treatment.cjs'), out], { env, encoding: 'utf8', timeout: 50_000 });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    const result = JSON.parse(readFileSync(join(out, 'result.json'), 'utf8'));
    assert.deepEqual(result.failures, [], JSON.stringify(result));
    assert.ok(result.denseCases >= 30);
    assert.ok(result.resolvedContrast > 0.07 && result.resolvedContrast < 0.13);
    assert.ok(result.maxNeutralError <= 1/255);
    t.diagnostic(JSON.stringify(result));
  } finally { material.dispose(); rmSync(out, { recursive: true, force: true }); }
});
