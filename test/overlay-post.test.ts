import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Scene } from 'three';
import type { WebGLRenderer } from 'three';
import { Finishing } from '../src/overlay/post.ts';

// SMAA loads its lookup images through Image, which a plain node process does not have.
(globalThis as { Image?: unknown }).Image ??= class { set src(_v: string) {} addEventListener(): void {} };

const renderer = (ext: string[]): WebGLRenderer => ({ extensions: { has: (n: string) => ext.includes(n) }, getPixelRatio: () => 1 }) as unknown as WebGLRenderer;

test('the finishing pass is built only where half-float render targets exist, so a missing one falls back to the plain render', () => {
  assert.throws(() => new Finishing(renderer([]), new Scene(), new PerspectiveCamera()), /half-float/);
  const ok = new Finishing(renderer(['EXT_color_buffer_half_float']), new Scene(), new PerspectiveCamera());
  assert.ok(Finishing.supported(renderer(['EXT_color_buffer_float'])));
  ok.dispose();
});

test('a model rectangle that would need very large targets is not finished', () => {
  const f = new Finishing(renderer(['EXT_color_buffer_float']), new Scene(), new PerspectiveCamera());
  assert.ok(f.fits({ x: 0, y: 0, w: 900, h: 900 }));
  assert.ok(!f.fits({ x: 0, y: 0, w: 3440, h: 1440 }));
  f.dispose();
});
