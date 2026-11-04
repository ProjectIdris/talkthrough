// The high tier's finishing: the scene is drawn into a target that keeps its depth, ambient occlusion (GTAO) is worked
// out from that depth and laid over it (the dark of a crease, under a flange, where a part meets another), then the
// picture is toned and brought to screen colours, and SMAA smooths what multisampling leaves (shader and line shimmer).
// The canvas stays transparent: the target is cleared to nothing and every step keeps the alpha it was given.
// The lower tiers draw straight to the canvas and never load any of this.

import { DepthStencilFormat, DepthTexture, HalfFloatType, UnsignedInt248Type, WebGLRenderTarget } from 'three';
import type { Camera, Scene, WebGLRenderer } from 'three';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

export class Finishing {
  private beauty: WebGLRenderTarget;
  private occluded: WebGLRenderTarget;
  private toned: WebGLRenderTarget;
  private gtao: GTAOPass;
  private output = new OutputPass();
  private smaa = new SMAAPass();
  private width = 1;
  private height = 1;

  private renderer: WebGLRenderer;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    this.renderer = renderer;
    const depth = new DepthTexture(1, 1);
    depth.format = DepthStencilFormat;
    depth.type = UnsignedInt248Type;
    // The stencil is kept: a cut model's caps (cutaway.ts) are drawn with it.
    this.beauty = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4, depthBuffer: true, stencilBuffer: true, depthTexture: depth });
    this.occluded = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
    this.toned = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
    this.gtao = new GTAOPass(scene, camera, 1, 1, { depthTexture: depth });
    this.gtao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.2, thickness: 2, scale: 1.4, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
    this.gtao.blendIntensity = 0.9;
    this.smaa.renderToScreen = true;
  }

  /** Size in device pixels. */
  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.beauty.setSize(w, h);
    this.occluded.setSize(w, h);
    this.toned.setSize(w, h);
    this.gtao.setSize(w, h);
    this.smaa.setSize(w, h);
  }

  /** Draws the scene to the canvas (inside whatever scissor the renderer has). */
  render(scene: Scene, camera: Camera): void {
    const r = this.renderer;
    const scissor = r.getScissorTest();
    r.setScissorTest(false);
    r.setRenderTarget(this.beauty);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(scene, camera);
    this.gtao.render(r, this.occluded, this.beauty, 0, false);
    this.output.render(r, this.toned, this.occluded, 0, false);
    r.setRenderTarget(null);
    r.setScissorTest(scissor);
    this.smaa.render(r, null as unknown as WebGLRenderTarget, this.toned, 0, false);
  }

  dispose(): void {
    for (const t of [this.beauty, this.occluded, this.toned]) t.dispose();
    this.beauty.depthTexture?.dispose();
    this.gtao.dispose();
    this.output.dispose();
    this.smaa.dispose();
  }
}
