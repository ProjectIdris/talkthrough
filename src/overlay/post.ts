// The high tier's finishing: the scene is drawn into a target that keeps its depth, ambient occlusion (GTAO) is worked
// out from that depth and laid over it (the dark of a crease, under a flange, where a part meets another), then the
// picture is toned and brought to screen colours, and SMAA smooths what multisampling leaves (shader and line shimmer).
// The canvas stays transparent: the target is cleared to nothing, and the colour is taken out of its premultiplied form
// before it is toned and put back after, so a see-through part looks the same here as on the lower tiers.
// The lower tiers draw straight to the canvas and never load any of this.
//
// The targets are sized to the rectangle the model is drawn in (rounded up, so they are not reallocated every frame),
// not to the window: the camera is given just that window of the display (a view offset) for the draw. A model whose
// rectangle is very large is drawn plainly (MAX_PIXELS).

import { DepthStencilFormat, DepthTexture, HalfFloatType, UnsignedByteType, UnsignedInt248Type, Vector4, WebGLRenderTarget } from 'three';
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

/** How much the finishing does: the high tier does all of it, the mid tier a lighter occlusion (half resolution, fewer samples, two-sample target) with no smoothing pass. */
export type FinishingLevel = 'light' | 'full';

/** A rectangle in CSS pixels, from the top left of the display. */
export type PixelRect = { x: number; y: number; w: number; h: number };

/** Past this many device pixels the finishing is skipped (about 100 bytes a pixel of targets are held). */
export const MAX_PIXELS = 4_200_000;
const STEP = 96;

export class Finishing {
  private beauty: WebGLRenderTarget;
  private occluded: WebGLRenderTarget;
  private toned: WebGLRenderTarget;
  private gtao: GTAOPass;
  private output = new OutputPass();
  private smaa = new SMAAPass();
  private width = 0;
  private height = 0;
  private renderer: WebGLRenderer;
  private depth: DepthTexture;
  private level: FinishingLevel;

  /** Whether this graphics stack can render to half-float targets (without that the first draw would fail). */
  static supported(renderer: WebGLRenderer): boolean {
    const ext = renderer.extensions;
    return ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
  }

  constructor(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, level: FinishingLevel = 'full') {
    if (!Finishing.supported(renderer)) throw new Error('no half-float render targets');
    this.renderer = renderer;
    this.level = level;
    this.depth = new DepthTexture(1, 1);
    this.depth.format = DepthStencilFormat;
    this.depth.type = UnsignedInt248Type;
    // The stencil is kept: a cut model's caps (cutaway.ts) are drawn with it.
    this.beauty = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: level === 'full' ? 4 : 2, depthBuffer: true, stencilBuffer: true, depthTexture: this.depth });
    this.occluded = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
    this.toned = new WebGLRenderTarget(1, 1, { type: UnsignedByteType, depthBuffer: false });
    this.gtao = new GTAOPass(scene, camera, 1, 1, { depthTexture: this.depth });
    this.gtao.updateGtaoMaterial({ radius: level === 'full' ? 1.2 : 1.1, distanceExponent: 1.2, thickness: 2, scale: 1.4, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
    this.gtao.blendIntensity = 0.7;
    // The colour in the target is premultiplied by its alpha: take that out before toning and put it back after.
    const material = this.output.material;
    const start = 'gl_FragColor = texture2D( tDiffuse, vUv );';
    // A shader that changed under a three.js upgrade would otherwise fail to compile without a word: refuse to build instead.
    if (!material.fragmentShader.includes(start) || !/}\s*$/.test(material.fragmentShader)) throw new Error('the output shader is not the one this expects');
    material.fragmentShader = material.fragmentShader
      .replace('gl_FragColor = texture2D( tDiffuse, vUv );', 'gl_FragColor = texture2D( tDiffuse, vUv );\n\t\t\tfloat coverage = gl_FragColor.a;\n\t\t\tgl_FragColor.rgb /= max(coverage, 0.0001);')
      .replace(/}\s*$/, '\tgl_FragColor.rgb *= coverage;\n\t\t}');
    this.smaa.renderToScreen = level === 'full';
    this.output.renderToScreen = level !== 'full';
  }

  /** Whether a model drawn in this rectangle is finished here (it is not when the targets would be very large). */
  fits(rect: PixelRect): boolean {
    const pr = this.renderer.getPixelRatio();
    return Math.ceil(rect.w / STEP) * STEP * pr * Math.ceil(rect.h / STEP) * STEP * pr <= MAX_PIXELS;
  }

  private size(w: number, h: number): void {
    const pr = this.renderer.getPixelRatio();
    const dw = Math.max(1, Math.round(w * pr)), dh = Math.max(1, Math.round(h * pr));
    if (dw === this.width && dh === this.height) return;
    this.width = dw;
    this.height = dh;
    this.beauty.setSize(dw, dh);
    this.occluded.setSize(dw, dh);
    this.toned.setSize(dw, dh);
    // The light level works the occlusion out at half the resolution: it is soft by nature, and the depth it reads stays full size.
    if (this.level === 'full') this.gtao.setSize(dw, dh);
    else this.gtao.setSize(Math.max(1, dw >> 1), Math.max(1, dh >> 1));
    this.smaa.setSize(dw, dh);
  }

  /**
   * Draws the scene to the canvas inside `rect` (CSS pixels from the top left; `display` is the display size, which the
   * canvas covers). The renderer's scissor is left as the caller set it.
   */
  render(scene: Scene, camera: PerspectiveCamera, rect: PixelRect, display: { width: number; height: number }): void {
    const r = this.renderer;
    const w = Math.ceil(rect.w / STEP) * STEP, h = Math.ceil(rect.h / STEP) * STEP;
    this.size(w, h);
    // The camera sees just this window of what it was given.
    const view = camera.view && camera.view.enabled ? { ...camera.view } : undefined;
    const full = view ?? { fullWidth: display.width, fullHeight: display.height, offsetX: 0, offsetY: 0 };
    camera.setViewOffset(full.fullWidth, full.fullHeight, full.offsetX + rect.x, full.offsetY + rect.y, w, h);
    const scissor = r.getScissorTest();
    const viewport = r.getViewport(new Vector4());
    r.setScissorTest(false);
    r.setRenderTarget(this.beauty);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(scene, camera);
    this.gtao.render(r, this.occluded, this.beauty, 0, false);
    if (this.level !== 'full') {
      // Back to the canvas first: the output pass draws straight to it, with no smoothing pass after.
      if (view) camera.setViewOffset(view.fullWidth, view.fullHeight, view.offsetX, view.offsetY, view.width, view.height);
      else camera.clearViewOffset();
      r.setRenderTarget(null);
      r.setViewport(rect.x, display.height - rect.y - h, w, h);
      r.setScissorTest(scissor);
      this.output.render(r, null as unknown as WebGLRenderTarget, this.occluded, 0, false);
      r.setViewport(viewport);
      return;
    }
    this.output.render(r, this.toned, this.occluded, 0, false);
    // Back to the canvas, where the window of the display this stands for is.
    if (view) camera.setViewOffset(view.fullWidth, view.fullHeight, view.offsetX, view.offsetY, view.width, view.height);
    else camera.clearViewOffset();
    r.setRenderTarget(null);
    r.setViewport(rect.x, display.height - rect.y - h, w, h);
    r.setScissorTest(scissor);
    this.smaa.render(r, null as unknown as WebGLRenderTarget, this.toned, 0, false);
    r.setViewport(viewport);
  }

  dispose(): void {
    for (const t of [this.beauty, this.occluded, this.toned]) t.dispose();
    this.depth.dispose();
    this.gtao.dispose();
    this.output.dispose();
    this.smaa.dispose();
  }
}
