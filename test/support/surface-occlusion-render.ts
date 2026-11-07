import { AmbientLight, DirectionalLight, Mesh, OrthographicCamera, PlaneGeometry, Scene, WebGLRenderer } from 'three';
import { applySurface, makeSurface, TIERS } from '../../src/overlay/materials.ts';
import { PanelScene } from '../../src/overlay/scene3d.ts';
import { emptyFrame, planStep, settle } from '../../src/overlay/timeline.ts';
import type { Step } from '../../src/scene/types.ts';

const width = 256, height = 128;
const renderer = new WebGLRenderer({ antialias: false, alpha: false });
renderer.setSize(width, height);
renderer.setClearColor(0xeeeeee, 1);
const gl = renderer.getContext();
const debug = gl.getExtension('WEBGL_debug_renderer_info');
const device = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
const camera = new OrthographicCamera(-4, 4, 2, -2, 0.1, 100);
camera.position.z = 10;
camera.updateMatrixWorld();
const failures: unknown[] = [];
let cases = 0, maxOrderError = 0, minGlassEffect = Infinity, frontGlassEffect = 0;
let transitionChecks = 0, maxTransitionError = 0;
const delta = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
for (const tier of ['low', 'mid', 'high'] as const) for (const name of ['plastic', 'rubber', 'glow']) {
  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 1));
  const light = new DirectionalLight(0xffffff, 2);
  light.position.set(-3, 4, 6);
  scene.add(light);
  const surface = makeSurface(name, TIERS[tier]);
  const glassSurface = makeSurface('glass', TIERS[tier]);
  applySurface(surface, [220, 90, 35], 1, 0, undefined);
  applySurface(glassSurface, [35, 110, 220], 1, 0, undefined);
  const glass = new Mesh(new PlaneGeometry(7, 3), glassSurface);
  const solid = new Mesh(new PlaneGeometry(6, 1).rotateY(-Math.PI / 6).translate(0, 0, 0.5), surface);
  scene.add(glass, solid);
  const read = (x: number) => {
    const pixel = new Uint8Array(4);
    gl.readPixels(x, 64, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return [...pixel];
  };
  const render = () => {
    renderer.render(scene, camera);
    return { rear: read(80), front: read(176) };
  };
  try {
    // World geometry stays identical. Object-level draw priority must not decide
    // whether glass covers a solid's rear portion.
    solid.renderOrder = -1;
    const earlierSolid = render();
    solid.renderOrder = 1;
    const laterSolid = render();
    glass.visible = false;
    const bare = render();
    const error = Math.max(delta(earlierSolid.rear, laterSolid.rear), delta(earlierSolid.front, laterSolid.front));
    const effect = delta(laterSolid.rear, bare.rear);
    const front = delta(laterSolid.front, bare.front);
    maxOrderError = Math.max(maxOrderError, error);
    minGlassEffect = Math.min(minGlassEffect, effect);
    frontGlassEffect = Math.max(frontGlassEffect, front);
    if (error > 1 || effect < 10 || front !== 0) failures.push({ tier, name, error, effect, front, earlierSolid, laterSolid, bare });
    // Reuse the already rendered material through fade and return. Compare it to
    // a fresh material at each target opacity so a stale opaque shader is caught.
    for (const alpha of [0.4, 1, 0.7, 1]) {
      applySurface(surface, [220, 90, 35], alpha, 0, undefined);
      solid.material = surface;
      const warmed = render();
      const fresh = makeSurface(name, TIERS[tier]);
      try {
        applySurface(fresh, [220, 90, 35], alpha, 0, undefined);
        solid.material = fresh;
        const reference = render();
        const transitionError = Math.max(delta(warmed.rear, reference.rear), delta(warmed.front, reference.front));
        maxTransitionError = Math.max(maxTransitionError, transitionError);
        if (transitionError > 1) failures.push({ tier, name, alpha, warmed, reference, transitionError });
        transitionChecks++;
      } finally { solid.material = surface; fresh.dispose(); }
    }
    cases++;
  } finally {
    solid.geometry.dispose(); glass.geometry.dispose(); surface.dispose(); glassSurface.dispose();
  }
}
// Production scenes also assign sphere order from authored size. Equivalent
// size/scale decompositions must not change glass coverage over a solid sphere.
let panelCases = 0, maxPanelScaleError = 0, minPanelGlassEffect = Infinity;
for (const tier of ['low', 'mid', 'high'] as const) {
  const pixels: number[][] = [];
  for (const [size, scale] of [[1.4, 1], [0.28, 5]]) {
    const frame = settle(planStep(emptyFrame(), { say: '', actions: [
      { op: 'add', shape: 'sphere', id: 'solid', size: [size, size, size], color: '#dc5a23', edges: false },
      { op: 'scale', id: 'solid', to: [scale, scale, scale], dur: 0 },
      { op: 'add', shape: 'plane', id: 'cover', size: [2.4, 2.4, 0.1], pos: [0, 0, 1.2], material: 'glass', color: '#236edc', edges: false },
    ] } as Step));
    const panel = new PanelScene({ tier });
    try {
      panel.sync(frame, 1);
      const read = () => {
        renderer.render(panel.scene, camera);
        const pixel = new Uint8Array(4);
        gl.readPixels(128, 64, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return [...pixel];
      };
      const covered = read();
      pixels.push(covered);
      panel.nodeOf(frame.objects.find(o => o.id === 'cover')!.key)!.visible = false;
      const effect = delta(covered, read());
      minPanelGlassEffect = Math.min(minPanelGlassEffect, effect);
      if (effect < 10) failures.push({ tier, size, scale, panelGlassEffect: effect });
    } finally { panel.destroy(); }
  }
  const error = delta(pixels[0]!, pixels[1]!);
  maxPanelScaleError = Math.max(maxPanelScaleError, error);
  if (error > 1) failures.push({ tier, panelScaleError: error, pixels });
  panelCases++;
}
renderer.dispose();
(window as unknown as { surfaceOcclusionResult: unknown }).surfaceOcclusionResult = { cases, panelCases, transitionChecks, maxOrderError, minGlassEffect, frontGlassEffect, maxTransitionError, maxPanelScaleError, minPanelGlassEffect, failures, renderer: device };
