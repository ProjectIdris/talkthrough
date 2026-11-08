import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, MeshPhysicalMaterial, PerspectiveCamera, Scene, SphereGeometry } from 'three';
import type { WebGLRenderer } from 'three';
import { SURFACE_NAMES, TIERS, makeSurface } from '../src/overlay/materials.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { StudioEnvironment, STUDIO_LIGHTS } from '../src/overlay/studio.ts';
import { fitBoardPattern } from '../src/overlay/surface-micro.ts';
import { applyEdgeSoften, softenEdges, EDGE_ATTRIBUTES } from '../src/overlay/edge-soften.ts';
import { Finishing } from '../src/overlay/post.ts';
import { MATERIAL_NAMES } from '../src/scene/material-library.ts';

(globalThis as { Image?: unknown }).Image ??= class { set src(_v: string) {} addEventListener(): void {} };

const METALS = ['metal', 'steel', 'iron', 'brass', 'copper', 'cast'];
const fakeShader = () => ({
  uniforms: {},
  vertexShader: 'void main() {\n#include <begin_vertex>\n}',
  fragmentShader: 'void main() {\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <normal_fragment_maps>\n}',
} as never);
const compiled = (m: MeshPhysicalMaterial): { vertexShader: string; fragmentShader: string; uniforms: Record<string, { value: number }> } => {
  const shader = fakeShader() as { vertexShader: string; fragmentShader: string; uniforms: Record<string, { value: number }> };
  m.onBeforeCompile(shader as never, undefined as never);
  return shader;
};

test('every material the library names has a real finish: metals are metal, everything else is not, roughness is never a mirror or chalk by accident', () => {
  for (const name of MATERIAL_NAMES) {
    const m = makeSurface(name, TIERS.high);
    if (METALS.includes(name)) assert.ok(m.metalness >= 0.9, `${name} reads as metal`);
    else assert.equal(m.metalness, 0, `${name} is not metal`);
    assert.ok(m.roughness > 0 && m.roughness <= 1, `${name} roughness`);
  }
  assert.ok(makeSurface('steel', TIERS.high).roughness < makeSurface('iron', TIERS.high).roughness, 'polished steel is smoother than iron');
  assert.ok(makeSurface('rubber', TIERS.high).roughness > 0.8);
});

test('the fine surface is a tier choice: low keeps its shaders plain (but for the board), mid adds the grain, high adds the bump', () => {
  assert.equal(makeSurface('steel', TIERS.low).customProgramCacheKey(), makeSurface('plastic', TIERS.low).customProgramCacheKey(), 'low compiles the stock shader');
  const mid = makeSurface('steel', TIERS.mid).customProgramCacheKey();
  const high = makeSurface('steel', TIERS.high).customProgramCacheKey();
  assert.match(mid, /MICRO_ROUGH/);
  assert.doesNotMatch(mid, /MICRO_BUMP/);
  assert.match(high, /MICRO_BUMP/);
  const board = (t: typeof TIERS.low) => makeSurface('pcb', t).customProgramCacheKey();
  assert.match(board(TIERS.low), /MICRO_BOARD/);
  assert.doesNotMatch(board(TIERS.low), /MICRO_SILK/);
  assert.match(board(TIERS.mid), /MICRO_SILK/);
  assert.doesNotMatch(makeSurface('glass', TIERS.high).customProgramCacheKey(), /MICRO/, 'see-through surfaces get no grain');
});

test('the micro surface patches every stage it needs, and the board layers only the pcb gets', () => {
  const s = compiled(makeSurface('pcb', TIERS.high));
  assert.match(s.vertexShader, /vMicroP = position/);
  for (const part of ['boardLayers(q', 'metalnessFactor = max', 'roughnessFactor = clamp', 'normal = normalize(abs(fDet)']) assert.ok(s.fragmentShader.includes(part), part);
  const plain = compiled(makeSurface('steel', TIERS.high));
  assert.ok(plain.fragmentShader.includes('void main()'));
  assert.doesNotMatch(plain.fragmentShader.replace(/#ifdef MICRO_BOARD[\s\S]*?#endif/g, ''), /boardLayers\(q/);
});

test('the studio is built in code: lights brighter than the screen, a dome, nothing to fetch, and it can be freed', () => {
  const room = new StudioEnvironment();
  assert.ok(room.children.length >= STUDIO_LIGHTS.length + 1);
  assert.ok(STUDIO_LIGHTS.some((l) => Math.max(...l.color) > 4), 'a key light well above white');
  assert.ok(STUDIO_LIGHTS.every((l) => l.size[0] > 0 && l.size[1] > 0));
  room.dispose();
});

test('softening edges: a crease gets its neighbour, a smooth ball gets nothing, and a side with no crease stays a zero vector (a zero would turn NaN if normalised)', () => {
  const cube = softenEdges(new BoxGeometry(1, 1, 1));
  assert.ok(cube, 'a cube has creases');
  for (const name of EDGE_ATTRIBUTES) assert.ok(cube.getAttribute(name), name);
  assert.equal(softenEdges(new SphereGeometry(1, 24, 16)), undefined, 'gentle bends are left to the normals');
  // A triangle fan whose only crease is one edge: the other two sides carry zeros.
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1], 3));
  const hinged = softenEdges(g);
  assert.ok(hinged);
  const nb = ['edgeNb0', 'edgeNb1', 'edgeNb2'].map((n) => hinged.getAttribute(n));
  const zeros = nb.filter((a) => a.getX(0) === 0 && a.getY(0) === 0 && a.getZ(0) === 0).length;
  assert.equal(zeros, 2);
  const m = new MeshPhysicalMaterial();
  applyEdgeSoften(m);
  const s = compiled(m);
  assert.doesNotMatch(s.vertexShader, /normalize\(normalMatrix \* edgeNb/, 'a zero neighbour must not be normalised');
  assert.match(s.fragmentShader, /roughnessFactor = max\(0\.05/);
});

const stub = (): WebGLRenderer => ({ extensions: { has: (n: string) => n === 'EXT_color_buffer_half_float' }, getPixelRatio: () => 1 }) as unknown as WebGLRenderer;

test('the mid tier finishes at half resolution and with fewer samples than the high tier', () => {
  const light = new Finishing(stub(), new Scene(), new PerspectiveCamera(), 'light');
  const full = new Finishing(stub(), new Scene(), new PerspectiveCamera(), 'full');
  const size = (f: Finishing) => (f as unknown as { gtao: { width: number; height: number; samples?: number } }).gtao;
  (light as unknown as { size(w: number, h: number): void }).size(800, 400);
  (full as unknown as { size(w: number, h: number): void }).size(800, 400);
  assert.equal(size(light).width, 400);
  assert.equal(size(full).width, 800);
  light.dispose();
  full.dispose();
});

test('the fine surface of every metal shares one program and differs only in its uniforms, so a tier compiles it once', () => {
  const keys = new Set(['steel', 'metal', 'iron', 'brass', 'copper', 'cast'].map((n) => makeSurface(n, TIERS.high).customProgramCacheKey()));
  assert.equal(keys.size, 1, [...keys].join(' / '));
  const steel = compiled(makeSurface('steel', TIERS.high)).uniforms, iron = compiled(makeSurface('iron', TIERS.high)).uniforms;
  assert.notEqual(steel.microGrain!.value, iron.microGrain!.value);
  assert.notEqual(steel.microBumpAmt!.value, iron.microBumpAmt!.value);
});

test('a board pattern is drawn for the size of the board: the same detail on a board written ten times larger or smaller', () => {
  const unitOf = (w: number, d: number) => {
    const m = makeSurface('pcb', TIERS.high);
    fitBoardPattern(m, new BoxGeometry(w, 0.2, d));
    return compiled(m).uniforms.boardUnit!.value;
  };
  assert.ok(Math.abs(unitOf(6, 4) - 1) < 0.01, 'the reference board is unchanged');
  assert.ok(Math.abs(unitOf(60, 40) / unitOf(6, 4) - 10) < 0.01);
  assert.ok(Math.abs(unitOf(0.6, 0.4) / unitOf(6, 4) - 0.1) < 0.001);
});

test('the prewarm group has a solid in every surface, the same surfaces every time (their programs stay alive), and is built as a model is', () => {
  for (const tier of ['low', 'mid', 'high'] as const) {
    const panel = new PanelScene({ tier });
    const first = panel.prewarmGroup();
    assert.equal(first.children.length, SURFACE_NAMES.length);
    const second = panel.prewarmGroup();
    const surfaces = (g: typeof first) => g.children.map((m) => (m as unknown as { material: unknown }).material);
    assert.deepEqual(surfaces(second), surfaces(first), 'one set of surfaces for good');
    for (const m of first.children) {
      assert.equal(m.castShadow, TIERS[tier].shadows);
      assert.equal(m.frustumCulled, false);
    }
    assert.ok(!panel.scene.children.includes(first), 'it is not part of the scene until the caller adds it');
  }
});
