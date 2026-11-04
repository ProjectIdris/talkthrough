// The 3D panel's three.js scene: builds objects from a Frame, moves them as the frame changes, and
// places the panel's perspective camera. It never touches the DOM itself (text sprites ask for a
// canvas through `makeCanvas`), so it can run and be tested without a renderer.

import {
  BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, DoubleSide, Euler, Group,
  HemisphereLight, Mesh, MeshStandardMaterial, Object3D, PerspectiveCamera, PlaneGeometry, Quaternion, Scene,
  SphereGeometry, SRGBColorSpace, Sprite, SpriteMaterial, TorusGeometry, CanvasTexture, Vector3,
} from 'three';
import type { FocusFrame, Frame, ObjectFrame, Rgb } from './timeline.ts';

/** The longer side of the panel sees this many degrees; the shorter side follows from the panel's shape, so a wide panel does not skew what sits at its edges. */
export const FOV_DEGREES = 35;
const MIN_VERTICAL_FOV = 3;

/** The camera's vertical field of view for a panel of this width over height. */
export function verticalFov(aspect: number): number {
  if (!(aspect > 0)) return FOV_DEGREES;
  if (aspect <= 1) return FOV_DEGREES;
  const v = (2 * Math.atan(Math.tan((FOV_DEGREES * Math.PI) / 360) / aspect) * 180) / Math.PI;
  return Math.max(MIN_VERTICAL_FOV, v);
}
/** Panel units visible across the shorter side of the panel at zoom 1. */
export const FRAMING_UNITS = 12;
const PATH_RADIUS = 0.06;
const DEG = Math.PI / 180;

type CanvasLike = HTMLCanvasElement | OffscreenCanvas;
export type PanelDeps = { makeCanvas?: (width: number, height: number) => CanvasLike };

type Node = {
  obj: Object3D;
  /** Materials to colour and fade together. */
  materials: Array<MeshStandardMaterial | SpriteMaterial>;
  geometries: BufferGeometry[];
  texture?: CanvasTexture;
  /** The size the object is built at (text sprites are sized, everything else is 1). */
  baseScale: Vector3;
};

const toColor = (c: Rgb): Color => new Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, SRGBColorSpace);

function solidMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.08, transparent: true, side: DoubleSide });
}

function buildSolid(o: ObjectFrame): { obj: Object3D; geometries: BufferGeometry[]; materials: MeshStandardMaterial[] } {
  const [sx, sy, sz] = o.size;
  let geo: BufferGeometry;
  switch (o.shape) {
    case 'sphere': geo = new SphereGeometry(0.5, 40, 24).scale(sx, sy, sz); break;
    case 'cylinder': geo = new CylinderGeometry(sx / 2, sx / 2, sy, 40).scale(1, 1, sz / Math.max(sx, 1e-6)); break;
    case 'cone': geo = new ConeGeometry(sx / 2, sy, 40).scale(1, 1, sz / Math.max(sx, 1e-6)); break;
    case 'torus': {
      const r = Math.max(0.005, sy / 2);
      const big = Math.max(0.005, sx / 2 - r);
      geo = new TorusGeometry(big, r, 20, 56).rotateX(Math.PI / 2).scale(1, 1, sz / Math.max(sx, 1e-6));
      break;
    }
    case 'plane': geo = new PlaneGeometry(sx, sy); break;
    default: geo = new BoxGeometry(sx, sy, sz); break;
  }
  const mat = solidMaterial();
  return { obj: new Mesh(geo, mat), geometries: [geo], materials: [mat] };
}

function buildPath(o: ObjectFrame): { obj: Object3D; geometries: BufferGeometry[]; materials: MeshStandardMaterial[] } {
  const mat = solidMaterial();
  const group = new Group();
  const geometries: BufferGeometry[] = [];
  const pts = (o.pts ?? []).map((p) => new Vector3(p[0], p[1], p[2]));
  const arrow = o.shape === 'arrow';
  const headLen = 0.5;
  const up = new Vector3(0, 1, 0);
  const last = pts.length - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i] as Vector3;
    let b = pts[i + 1] as Vector3;
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len < 1e-6) continue;
    dir.normalize();
    if (arrow && i === last - 1) b = b.clone().sub(dir.clone().multiplyScalar(Math.min(headLen * 0.8, len)));
    const segLen = a.distanceTo(b);
    if (segLen > 1e-6) {
      const g = new CylinderGeometry(PATH_RADIUS, PATH_RADIUS, segLen, 12);
      const m = new Mesh(g, mat);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.copy(new Quaternion().setFromUnitVectors(up, dir));
      group.add(m);
      geometries.push(g);
    }
    if (i > 0) {
      const g = new SphereGeometry(PATH_RADIUS, 12, 8);
      const m = new Mesh(g, mat);
      m.position.copy(a);
      group.add(m);
      geometries.push(g);
    }
    if (arrow && i === last - 1) {
      const tip = pts[last] as Vector3;
      const g = new ConeGeometry(PATH_RADIUS * 3.2, headLen, 20);
      const m = new Mesh(g, mat);
      m.position.copy(tip).sub(dir.clone().multiplyScalar(headLen / 2));
      m.quaternion.copy(new Quaternion().setFromUnitVectors(up, dir));
      group.add(m);
      geometries.push(g);
    }
  }
  return { obj: group, geometries, materials: [mat] };
}

export class PanelScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FOV_DEGREES, 1, 0.3, 1500);
  private nodes = new Map<number, Node>();
  private deps: PanelDeps;

  constructor(deps: PanelDeps = {}) {
    this.deps = deps;
    this.scene.add(new HemisphereLight(0xffffff, 0x3b4660, 1.5));
    const key = new DirectionalLight(0xffffff, 2.6);
    key.position.set(2.5, 5, 4);
    this.camera.add(key);
    this.scene.add(this.camera);
  }

  /** Looks up the live three.js object of a frame object, for tests and for focusing. */
  nodeOf(key: number): Object3D | undefined {
    return this.nodes.get(key)?.obj;
  }

  private build(o: ObjectFrame): Node {
    let made: { obj: Object3D; geometries: BufferGeometry[]; materials: Array<MeshStandardMaterial | SpriteMaterial>; texture?: CanvasTexture };
    switch (o.shape) {
      case 'group': made = { obj: new Group(), geometries: [], materials: [] }; break;
      case 'line': case 'arrow': made = buildPath(o); break;
      case 'text': made = this.buildText(o); break;
      default: made = buildSolid(o);
    }
    const baseScale = made.obj instanceof Sprite ? made.obj.scale.clone() : new Vector3(1, 1, 1);
    return { ...made, baseScale };
  }

  private buildText(o: ObjectFrame): { obj: Object3D; geometries: BufferGeometry[]; materials: SpriteMaterial[]; texture?: CanvasTexture } {
    const make = this.deps.makeCanvas;
    const text = o.text ?? '';
    if (!make || !text) return { obj: new Group(), geometries: [], materials: [] };
    const fontPx = 96;
    const probe = make(8, 8).getContext('2d') as CanvasRenderingContext2D | null;
    if (!probe) return { obj: new Group(), geometries: [], materials: [] };
    const font = `700 ${fontPx}px system-ui, "Segoe UI", Roboto, sans-serif`;
    probe.font = font;
    const pad = 16;
    const width = Math.max(16, Math.ceil(probe.measureText(text).width) + pad * 2);
    const height = fontPx + pad * 2;
    const canvas = make(width, height);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
    if (!ctx) return { obj: new Group(), geometries: [], materials: [] };
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 14;
    ctx.strokeStyle = 'rgba(8,12,20,0.9)';
    ctx.strokeText(text, pad, height / 2 + 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, pad, height / 2 + 4);
    const texture = new CanvasTexture(canvas as HTMLCanvasElement);
    texture.colorSpace = SRGBColorSpace;
    const mat = new SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
    const sprite = new Sprite(mat);
    const h = o.height ?? 0.6;
    sprite.scale.set((h * width) / height, h, 1);
    sprite.renderOrder = 999;
    return { obj: sprite, geometries: [], materials: [mat], texture };
  }

  private dispose(node: Node): void {
    node.obj.removeFromParent();
    for (const g of node.geometries) g.dispose();
    for (const m of node.materials) m.dispose();
    node.texture?.dispose();
  }

  /** Brings the three.js scene in line with a frame and aims the camera. `aspect` is panel width over height. */
  sync(frame: Frame, aspect: number): void {
    const live = new Set<number>();
    for (const o of frame.objects) {
      live.add(o.key);
      let node = this.nodes.get(o.key);
      if (!node) {
        node = this.build(o);
        this.nodes.set(o.key, node);
        const parent = o.parentKey !== null ? this.nodes.get(o.parentKey)?.obj : undefined;
        (parent ?? this.scene).add(node.obj);
        // Larger translucent shells draw first so the inner ones show through them.
        const order = o.shape === 'sphere' ? Math.round(100 - Math.min(99, (o.size[0] + o.size[1] + o.size[2]) * 3)) : 0;
        node.obj.traverse((c: Object3D) => { c.renderOrder = c instanceof Sprite ? 999 : order; });
      }
      this.apply(node, o);
    }
    for (const [key, node] of this.nodes) {
      if (!live.has(key)) {
        this.dispose(node);
        this.nodes.delete(key);
      }
    }
    this.scene.updateMatrixWorld(true);
    this.aim(frame, aspect);
  }

  private apply(node: Node, o: ObjectFrame): void {
    const pulse = o.pulse;
    const grow = 1 + 0.07 * pulse;
    node.obj.position.set(o.pos[0], o.pos[1], o.pos[2]);
    node.obj.rotation.copy(new Euler(o.rot[0] * DEG, o.rot[1] * DEG, o.rot[2] * DEG, 'XYZ'));
    node.obj.scale.set(node.baseScale.x * o.scale[0] * grow, node.baseScale.y * o.scale[1] * grow, node.baseScale.z * o.scale[2] * grow);
    const alpha = Math.max(0, Math.min(1, o.opacity * o.appear * o.fade));
    node.obj.visible = alpha > 0.003;
    const color = toColor(o.color);
    const glow = o.pulseColor ? toColor(o.pulseColor) : color;
    for (const m of node.materials) {
      m.color.copy(color);
      m.opacity = alpha;
      if (m instanceof MeshStandardMaterial) {
        m.emissive.copy(glow);
        m.emissiveIntensity = 0.9 * pulse;
        m.depthWrite = alpha >= 0.999;
      }
    }
  }

  private focusPoint(f: FocusFrame, out: Vector3): Vector3 {
    const to = new Vector3(0, 0, 0);
    if (f.key !== null) this.nodes.get(f.key)?.obj.getWorldPosition(to);
    if (!f.from || f.k >= 1) return out.copy(to);
    const from = this.focusPoint(f.from, new Vector3());
    return out.copy(from).lerp(to, f.k);
  }

  private aim(frame: Frame, aspect: number): void {
    const cam = frame.camera;
    const fov = verticalFov(aspect);
    const tan = Math.tan((fov * DEG) / 2);
    const base = (FRAMING_UNITS / 2 / (aspect >= 1 ? 1 : aspect)) / tan;
    const dist = base / Math.max(0.05, cam.zoom);
    const az = cam.az * DEG, el = Math.max(-89, Math.min(89, cam.el)) * DEG;
    const target = this.focusPoint(cam.focus, new Vector3());
    this.camera.aspect = aspect;
    this.camera.fov = fov;
    this.camera.position.set(
      target.x + dist * Math.sin(az) * Math.cos(el),
      target.y + dist * Math.sin(el),
      target.z + dist * Math.cos(az) * Math.cos(el),
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
  }

  count(): number {
    return this.nodes.size;
  }

  destroy(): void {
    for (const node of this.nodes.values()) this.dispose(node);
    this.nodes.clear();
  }
}

