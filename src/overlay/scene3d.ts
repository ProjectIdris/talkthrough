// The 3D scene: builds objects from a Frame, moves them as the frame changes, lights them, puts a soft
// shadow under them on the page, and places the camera. It never touches the DOM itself (text sprites
// and the shadow's gradient ask for a canvas through `makeCanvas`), so it can run and be tested
// without a renderer.
//
// The model floats over the page: the stage rectangle only says where the model is fitted. The
// camera is given the whole display as its window (`setViewOffset`), so nothing is clipped to the
// rectangle and a model may reach past it.

import {
  AmbientLight, Box3, BufferGeometry, CanvasTexture, Color, ConeGeometry, CylinderGeometry, DirectionalLight, EdgesGeometry, Euler,
  Group, HemisphereLight, InstancedMesh, LineBasicMaterial, LineSegments, Material, Mesh, MeshBasicMaterial, Object3D,
  PerspectiveCamera, PlaneGeometry, Scene, ShadowMaterial, Sphere, SphereGeometry, SRGBColorSpace, Sprite, SpriteMaterial, TorusGeometry, Vector3,
} from 'three';
import type { Texture } from 'three';
import type { AddAction, Vec3 } from '../scene/types.ts';
import { DETAIL, boxGeometry, defaultBevel, drawFraction, extrudeGeometry, latheGeometry, pointAlong, samplePath, tubeGeometry } from './geometry.ts';
import type { Detail } from './geometry.ts';
import { TIERS, applySurface, makeSurface } from './materials.ts';
import type { Surface, Tier } from './materials.ts';
import { buildPart } from './parts.ts';
import { convexHull } from './labels.ts';
import type { Pt } from './labels.ts';
import type { Piece } from './parts.ts';
import type { FocusFrame, Frame, ObjectFrame, Rgb } from './timeline.ts';
import { spreadPosition, userOffsets } from './explode.ts';
import type { Part } from './explode.ts';
import { Cutaway } from './cutaway.ts';

/** The longer side of the stage sees this many degrees; the shorter side follows from its shape, so a wide stage does not skew what sits at its edges. */
export const FOV_DEGREES = 35;
const MIN_VERTICAL_FOV = 3;

/** The camera's vertical field of view for a stage of this width over height. */
export function verticalFov(aspect: number): number {
  if (!(aspect > 0)) return FOV_DEGREES;
  if (aspect <= 1) return FOV_DEGREES;
  const v = (2 * Math.atan(Math.tan((FOV_DEGREES * Math.PI) / 360) / aspect) * 180) / Math.PI;
  return Math.max(MIN_VERTICAL_FOV, v);
}

/** Units visible across the shorter side of the stage at zoom 1. */
export const FRAMING_UNITS = 12;
/** The sphere round the model gets this much room on the stage, and the camera never comes nearer than this to it (world units). */
const FIT_MARGIN = 1.1;
const MIN_FIT_DISTANCE = 0.8;
const PATH_RADIUS = 0.06;
const DEG = Math.PI / 180;

type CanvasLike = HTMLCanvasElement | OffscreenCanvas;
export type PanelDeps = { makeCanvas?: (width: number, height: number) => CanvasLike; tier?: Tier };

/** The stage in window pixels, and the size of the window it sits in. */
export type StageView = { rect: { x: number; y: number; w: number; h: number }; width: number; height: number };
export type ScreenRect = { x: number; y: number; w: number; h: number };

type NodePiece = {
  object: Object3D;
  surface: Surface | undefined;
  tint: boolean;
  color: Rgb | undefined;
  lines: LineSegments | undefined;
  /** A closed surface: a cut through it can be capped. */
  closed: boolean;
};

type Node = {
  obj: Object3D;
  pieces: NodePiece[];
  geometries: BufferGeometry[];
  materials: Material[];
  texture?: CanvasTexture;
  /** The size the object is built at (text sprites are sized, everything else is 1). */
  baseScale: Vector3;
  /** How it looks just now (for what a cut needs to know). */
  alpha: number;
  color: Rgb;
  /** Named points of a ready-made part, in its own space. */
  anchors?: Record<string, Vec3>;
  /** For tubes, lines and arrows: what is needed to draw them part way. */
  path?: { geo: BufferGeometry; sampled: Vec3[]; head: Mesh | undefined };
};

type AddMesh = (geo: BufferGeometry, surface: string | undefined, edges: boolean) => Mesh;

/** True when `a` is `b` or sits above it: adding `a` under `b` would make a loop, which hangs every walk of the scene. */
function isAncestor(a: Object3D, b: Object3D): boolean {
  for (let o: Object3D | null = b; o; o = o.parent) if (o === a) return true;
  return false;
}

export class PanelScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FOV_DEGREES, 1, 0.3, 1500);
  private nodes = new Map<number, Node>();
  private deps: PanelDeps;
  private tier: Tier;
  private detail: Detail;
  /** Everything the model is made of; the floor, the light and the shadows sit outside it. */
  private content = new Group();
  private light = new DirectionalLight(0xffffff, 2.4);
  private floor: Mesh;
  private blob: Mesh | undefined;
  private blobMaterial: MeshBasicMaterial | undefined;
  private box = new Box3();
  private hasBox = false;
  /** The middle of the model, as of the last camera placement: where the camera looks when nothing is named. */
  private fitCenter: Vector3 | undefined;
  private cutaway = new Cutaway();

  constructor(deps: PanelDeps = {}) {
    this.deps = deps;
    this.tier = deps.tier ?? 'mid';
    this.detail = DETAIL[this.tier];
    const settings = TIERS[this.tier];
    this.scene.add(this.content);
    this.scene.add(new HemisphereLight(0xffffff, 0x8a93a6, 0.3));
    this.scene.add(new AmbientLight(0xffffff, 0.12));
    this.light.position.set(-3, 8, 6);
    this.light.castShadow = settings.shadows;
    this.light.shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
    this.light.shadow.bias = -0.0004;
    this.light.shadow.normalBias = 0.03;
    this.light.shadow.radius = settings.shadowMapSize >= 2048 ? 10 : 5; // the shadow map is sampled over a disc: wider on the big map so the edge is soft, not hard
    this.scene.add(this.light, this.light.target);

    const floorMat = new ShadowMaterial({ color: 0x0a0e18, opacity: 0.34, transparent: true });
    floorMat.depthWrite = false;
    this.floor = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), floorMat);
    this.floor.receiveShadow = true;
    this.floor.renderOrder = -2;
    this.floor.visible = false;
    this.scene.add(this.floor);

    const make = deps.makeCanvas;
    if (make) {
      const c = make(128, 128);
      const ctx = c.getContext('2d') as CanvasRenderingContext2D | null;
      if (ctx) {
        const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 128, 128);
        const tex = new CanvasTexture(c as HTMLCanvasElement);
        this.blobMaterial = new MeshBasicMaterial({ color: 0x0a0e18, map: tex, transparent: true, opacity: 0.4, depthWrite: false });
        this.blob = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.blobMaterial);
        this.blob.renderOrder = -3;
        this.blob.visible = false;
        this.scene.add(this.blob);
      }
    }
    this.scene.add(this.camera);
  }

  /** The environment the surfaces reflect and are lit by (from the renderer's pre-filtering). */
  setEnvironment(texture: Texture | null, intensity = 1): void {
    this.scene.environment = texture;
    this.scene.environmentIntensity = intensity;
  }

  /** Looks up the live three.js object of a frame object, for tests and for focusing. */
  nodeOf(key: number): Object3D | undefined {
    return this.nodes.get(key)?.obj;
  }

  private build(o: ObjectFrame): Node {
    const def = o.def;
    const settings = TIERS[this.tier];
    const node: Node = { obj: new Group(), pieces: [], geometries: [], materials: [], baseScale: new Vector3(1, 1, 1), alpha: 1, color: [255, 255, 255] };
    const material = 'material' in def ? def.material : undefined;
    const addMesh: AddMesh = (geo, surfaceName, edges) => {
      const surface = makeSurface(surfaceName, settings);
      const mesh = new Mesh(geo, surface);
      mesh.castShadow = settings.shadows;
      mesh.receiveShadow = settings.shadows;
      node.geometries.push(geo);
      node.materials.push(surface);
      const closed = def.shape === 'box' || def.shape === 'sphere' || def.shape === 'cylinder' || def.shape === 'cone' || def.shape === 'extrude' || def.shape === 'torus';
      const piece: NodePiece = { object: mesh, surface, tint: true, color: undefined, lines: undefined, closed };
      if (edges && settings.edges && surfaceName !== 'glass' && surfaceName !== 'glow') piece.lines = this.edgeLines(mesh, geo, node);
      node.pieces.push(piece);
      return mesh;
    };
    switch (def.shape) {
      case 'group': case 'array': break;
      case 'part': {
        const built = buildPart(def, this.detail);
        node.obj = built.root;
        node.anchors = built.anchors;
        for (const p of built.pieces) this.adoptPiece(node, p);
        break;
      }
      case 'text': this.buildText(node, o); break;
      case 'tube': case 'line': case 'arrow': this.buildPath(node, o, addMesh); break;
      default: node.obj = addMesh(this.solidGeometry(def), material, 'edges' in def ? def.edges !== false : true);
    }
    if (node.obj instanceof Sprite) node.baseScale = node.obj.scale.clone();
    return node;
  }

  private edgeLines(mesh: Mesh, geo: BufferGeometry, node: Node): LineSegments {
    const mat = new LineBasicMaterial({ color: 0x10131a, transparent: true, opacity: 0.5 });
    const lines = new LineSegments(new EdgesGeometry(geo, 28), mat);
    mesh.add(lines);
    node.geometries.push(lines.geometry);
    node.materials.push(mat);
    return lines;
  }

  private adoptPiece(node: Node, p: Piece): void {
    const settings = TIERS[this.tier];
    const surface = makeSurface(p.surface, settings);
    p.object.material = surface;
    p.object.castShadow = settings.shadows;
    p.object.receiveShadow = settings.shadows;
    node.materials.push(surface);
    node.geometries.push(p.object.geometry);
    const piece: NodePiece = { object: p.object, surface, tint: p.tint, color: p.color, lines: undefined, closed: p.closed !== false && !(p.object instanceof InstancedMesh) };
    if (p.edges && settings.edges && !(p.object instanceof InstancedMesh)) piece.lines = this.edgeLines(p.object, p.object.geometry, node);
    node.pieces.push(piece);
  }

  private solidGeometry(def: AddAction): BufferGeometry {
    const d = this.detail;
    switch (def.shape) {
      case 'sphere': return new SphereGeometry(0.5, d.curve, Math.round(d.curve * 0.6)).scale(...(def as { size: Vec3 }).size);
      case 'cylinder': {
        const [sx, sy, sz] = (def as { size: Vec3 }).size;
        return new CylinderGeometry(sx / 2, sx / 2, sy, d.curve).scale(1, 1, sz / Math.max(sx, 1e-6));
      }
      case 'cone': {
        const [sx, sy, sz] = (def as { size: Vec3 }).size;
        return new ConeGeometry(sx / 2, sy, d.curve).scale(1, 1, sz / Math.max(sx, 1e-6));
      }
      case 'torus': {
        const [sx, sy, sz] = (def as { size: Vec3 }).size;
        const r = Math.max(0.005, sy / 2);
        const big = Math.max(0.005, sx / 2 - r);
        return new TorusGeometry(big, r, 20, d.curve * 2).rotateX(Math.PI / 2).scale(1, 1, sz / Math.max(sx, 1e-6));
      }
      case 'plane': {
        const [sx, sy] = (def as { size: Vec3 }).size;
        return new PlaneGeometry(sx, sy);
      }
      case 'extrude': {
        const e = def as { outline: Array<[number, number]>; depth: number; bevel?: number };
        return extrudeGeometry(e.outline, e.depth, e.bevel ?? Math.min(0.1, e.depth * 0.2), d);
      }
      case 'lathe': {
        const l = def as { profile: Array<[number, number]>; sides?: number };
        return latheGeometry(l.profile, l.sides ?? d.curve);
      }
      default: {
        const b = def as { size: Vec3; bevel?: number };
        return boxGeometry(b.size, b.bevel ?? defaultBevel(b.size), d);
      }
    }
  }

  private buildPath(node: Node, o: ObjectFrame, addMesh: AddMesh): void {
    const def = o.def as { shape: string; pts: Vec3[]; radius?: number; flat?: number; material?: string };
    const tube = def.shape === 'tube';
    const sampled = samplePath(def.pts, tube, this.detail.tube);
    const radius = tube ? def.radius ?? PATH_RADIUS : PATH_RADIUS;
    const geo = tubeGeometry(sampled, radius, tube ? def.flat ?? 1 : 1, this.detail.radial);
    const mesh = addMesh(geo, tube ? def.material : 'plastic', false);
    const group = new Group();
    group.add(mesh);
    let head: Mesh | undefined;
    if (def.shape === 'arrow') {
      head = addMesh(new ConeGeometry(PATH_RADIUS * 3.4, 0.55, 20), 'plastic', false);
      group.add(head);
    }
    node.obj = group;
    node.path = { geo, sampled, head };
  }

  private buildText(node: Node, o: ObjectFrame): void {
    const def = o.def as { text: string; height: number };
    const make = this.deps.makeCanvas;
    const text = def.text;
    if (!make || !text) return;
    const fontPx = 96;
    const probe = make(8, 8).getContext('2d') as CanvasRenderingContext2D | null;
    if (!probe) return;
    const font = `700 ${fontPx}px system-ui, "Segoe UI", Roboto, sans-serif`;
    probe.font = font;
    const pad = 16;
    const width = Math.max(16, Math.ceil(probe.measureText(text).width) + pad * 2);
    const height = fontPx + pad * 2;
    const canvas = make(width, height);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
    if (!ctx) return;
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
    sprite.scale.set((def.height * width) / height, def.height, 1);
    sprite.renderOrder = 999;
    node.obj = sprite;
    node.texture = texture;
    node.materials.push(mat);
    node.pieces.push({ object: sprite, surface: undefined, tint: true, color: undefined, lines: undefined, closed: false });
  }

  private dispose(node: Node): void {
    this.cutaway.release(node);
    node.obj.removeFromParent();
    for (const g of node.geometries) g.dispose();
    for (const m of node.materials) m.dispose();
    node.texture?.dispose();
  }

  /**
   * Brings the three.js scene in line with a frame and aims the camera. `aspect` is the stage's width
   * over height; `view`, when given, places the stage in the window so the model can reach past it.
   */
  sync(frame: Frame, aspect: number, view?: StageView): void {
    const live = new Set<number>();
    const spreads = new Map<number, number>();
    for (const o of frame.objects) spreads.set(o.key, o.spread);
    // The person's Explode control: how far each part moves from where it sits (explode.ts).
    const offsets = (frame.userExplode ?? 0) > 0
      ? userOffsets(frame.objects.map((o): Part => {
        const explode = (o.def as { explode?: Vec3 }).explode;
        return { key: o.key, parentKey: o.parentKey, pos: o.pos, ...(explode ? { explode } : {}), ...(o.shape === 'text' ? { fixed: true } : {}) };
      }), frame.userExplode ?? 0)
      : undefined;
    const layout = (with_: Map<number, Vec3> | undefined): void => {
      for (const o of frame.objects) {
        live.add(o.key);
        let node = this.nodes.get(o.key);
        if (!node) {
          node = this.build(o);
          this.nodes.set(o.key, node);
          const parent = o.parentKey !== null ? this.nodes.get(o.parentKey)?.obj : undefined;
          (parent ?? this.content).add(node.obj);
          // Larger translucent shells draw first so the inner ones show through them.
          const def = o.def as { size?: Vec3; material?: string };
          const order = o.shape === 'sphere' && def.size
            ? Math.round(100 - Math.min(99, (def.size[0] + def.size[1] + def.size[2]) * 3))
            : def.material === 'glass' ? 90 : 0;
          node.obj.traverse((c: Object3D) => { c.renderOrder = c instanceof Sprite ? 999 : order; });
        }
        // A part whose parent was swapped for a richer one (an object added again under its id) moves to the new parent.
        const holder = o.parentKey !== null ? this.nodes.get(o.parentKey)?.obj : undefined;
        if (holder && node.obj.parent !== holder && !isAncestor(node.obj, holder)) holder.add(node.obj);
        this.apply(node, o, o.parentKey !== null ? spreads.get(o.parentKey) ?? 0 : 0, with_?.get(o.key));
      }
    };
    // The camera has to stand further back for an opened model than for a closed one: measure how far the parts reach both ways.
    let standBack = 1;
    if (offsets) {
      layout(undefined);
      this.scene.updateMatrixWorld(true);
      const closed = this.reach(this.focusPoint(frame.camera.focus, new Vector3()));
      layout(offsets);
      this.scene.updateMatrixWorld(true);
      const open = this.reach(this.focusPoint(frame.camera.focus, new Vector3()));
      standBack = closed > 1e-6 ? Math.max(1, Math.min(4, open / closed)) : 1;
    } else layout(undefined);
    for (const [key, node] of this.nodes) {
      if (!live.has(key)) {
        this.dispose(node);
        this.nodes.delete(key);
      }
    }
    this.scene.updateMatrixWorld(true);
    this.aim(frame, aspect, view, standBack);
    // The person's Cut goes through the middle of the model from the side the camera looks from.
    this.cutaway.update(frame, this.nodes, this.scene, this.camera.getWorldDirection(new Vector3()).negate());
    this.placeShadow(frame);
  }

  private apply(node: Node, o: ObjectFrame, parentSpread: number, offset?: Vec3): void {
    const pulse = o.pulse;
    const grow = 1 + 0.07 * pulse;
    // Spread by the model's own explode, then by the person's control; a machine's pose stands in for the rest values.
    const at = spreadPosition(o.pose?.pos ?? o.pos, (o.def as { explode?: Vec3 }).explode, parentSpread);
    const rot = o.pose?.rot ?? o.rot;
    node.obj.position.set(at[0] + (offset?.[0] ?? 0), at[1] + (offset?.[1] ?? 0), at[2] + (offset?.[2] ?? 0));
    node.obj.rotation.copy(new Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'XYZ'));
    node.obj.scale.set(node.baseScale.x * o.scale[0] * grow, node.baseScale.y * o.scale[1] * grow, node.baseScale.z * o.scale[2] * grow);
    const alpha = Math.max(0, Math.min(1, (o.pose?.opacity ?? o.opacity) * o.appear * o.fade));
    node.obj.visible = alpha > 0.003;
    node.alpha = alpha;
    node.color = o.color;
    const dark: Rgb = [o.color[0] * 0.22, o.color[1] * 0.22, o.color[2] * 0.22];
    for (const p of node.pieces) {
      const rgb = p.tint ? o.color : p.color ?? o.color;
      if (p.surface) applySurface(p.surface, rgb, alpha, pulse, o.pulseColor);
      else if (p.object instanceof Sprite) (p.object.material as SpriteMaterial).opacity = alpha;
      if (p.lines) {
        const m = p.lines.material as LineBasicMaterial;
        m.opacity = 0.55 * alpha;
        m.color.setRGB(dark[0] / 255, dark[1] / 255, dark[2] / 255, 'srgb');
      }
    }
    if (node.path) {
      drawFraction(node.path.geo, o.draw);
      const head = node.path.head;
      if (head) {
        const { p, dir } = pointAlong(node.path.sampled, o.draw);
        const d = new Vector3(dir[0], dir[1], dir[2]);
        head.position.set(p[0], p[1], p[2]).addScaledVector(d, -0.2);
        head.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), d);
        head.visible = o.draw > 0.02;
      }
    }
  }

  private focusPoint(f: FocusFrame, out: Vector3): Vector3 {
    // With nothing named, the camera looks at the middle of the model (not at the origin, where it may not be).
    const to = this.fitCenter ? this.fitCenter.clone() : new Vector3(0, 0, 0);
    if (f.key !== null) this.nodes.get(f.key)?.obj.getWorldPosition(to);
    if (!f.from || f.k >= 1) return out.copy(to);
    const from = this.focusPoint(f.from, new Vector3());
    return out.copy(from).lerp(to, f.k);
  }

  private aim(frame: Frame, aspect: number, view?: StageView, standBack = 1): void {
    const cam = frame.camera;
    const fov = verticalFov(aspect);
    const tan = Math.tan((fov * DEG) / 2);
    // Zoom 1 is the whole model filling the stage, whatever size it was written at (a model of 3 units and one of 30 both fit).
    // The distance comes from a sphere round the visible parts; it also takes in an opened (exploded) model, which is
    // laid out by now, so the camera stands back for it without being told.
    const fit = this.modelSphere();
    let base = (FRAMING_UNITS / 2 / (aspect >= 1 ? 1 : aspect)) / tan;
    if (fit) {
      const tanShort = tan * Math.min(1, aspect);
      base = Math.max(MIN_FIT_DISTANCE, (fit.radius * FIT_MARGIN * Math.sqrt(1 + tanShort * tanShort)) / tanShort);
    }
    void standBack;
    this.fitCenter = fit ? fit.center : undefined;
    const dist = base / Math.max(0.05, cam.zoom);
    const az = cam.az * DEG, el = Math.max(-89, Math.min(89, cam.el)) * DEG;
    const target = this.focusPoint(cam.focus, new Vector3());
    this.camera.aspect = aspect;
    this.camera.fov = fov;
    if (view) this.camera.setViewOffset(view.rect.w, view.rect.h, -view.rect.x, -view.rect.y, view.width, view.height);
    else this.camera.clearViewOffset();
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

  /**
   * A sphere round every visible part, from the parts' own bounding spheres (so a part turning on its axis does not make
   * the camera breathe the way a box round it would). Undefined when nothing is there.
   */
  private modelSphere(): { center: Vector3; radius: number } | undefined {
    const spheres: Sphere[] = [];
    for (const node of this.nodes.values()) {
      if (!node.obj.visible || node.obj instanceof Sprite || node.pieces.length === 0 || node.path) continue;
      for (const p of node.pieces) {
        const mesh = p.object as Mesh;
        const geo = mesh.geometry;
        if (!geo) continue;
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        if (!geo.boundingSphere) continue;
        spheres.push(geo.boundingSphere.clone().applyMatrix4(mesh.matrixWorld));
      }
    }
    if (spheres.length === 0) return undefined;
    const lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const s of spheres) {
      lo.min(new Vector3(s.center.x - s.radius, s.center.y - s.radius, s.center.z - s.radius));
      hi.max(new Vector3(s.center.x + s.radius, s.center.y + s.radius, s.center.z + s.radius));
    }
    const center = lo.add(hi).multiplyScalar(0.5);
    let radius = 0;
    for (const s of spheres) radius = Math.max(radius, s.center.distanceTo(center) + s.radius);
    return { center, radius };
  }

  /** How far the visible parts reach from a point: the largest distance to a corner of a part's box. */
  private reach(from: Vector3): number {
    let far = 0;
    const box = new Box3();
    const corner = new Vector3();
    for (const node of this.nodes.values()) {
      if (!node.obj.visible || node.obj instanceof Sprite || node.pieces.length === 0 || node.path) continue;
      box.setFromObject(node.obj);
      if (box.isEmpty()) continue;
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) far = Math.max(far, corner.set(x, y, z).distanceTo(from));
    }
    return far;
  }

  /** Puts the floor, its soft blob and the light under what is there now. */
  private placeShadow(frame: Frame): void {
    this.box.makeEmpty();
    this.hasBox = false;
    for (const node of this.nodes.values()) {
      if (!node.obj.visible || node.obj instanceof Sprite || node.pieces.length === 0 || node.path) continue;
      const b = new Box3().setFromObject(node.obj);
      if (!b.isEmpty()) {
        this.box.union(b);
        this.hasBox = true;
      }
    }
    const presence = frame.panel ? Math.max(0, Math.min(1, frame.panel.appear * frame.panel.fade)) : 0;
    const show = this.hasBox && presence > 0.003;
    if (this.blob) this.blob.visible = show;
    this.floor.visible = show && TIERS[this.tier].shadows;
    if (!show) return;
    const size = this.box.getSize(new Vector3());
    const centre = this.box.getCenter(new Vector3());
    const span = Math.max(size.x, size.z, 1);
    const radius = Math.max(size.length() / 2, 1);
    const floorY = this.box.min.y - 0.03 * Math.max(size.x, size.y, size.z);
    this.floor.position.set(centre.x, floorY, centre.z);
    this.floor.scale.set(span * 4, 1, span * 4);
    (this.floor.material as ShadowMaterial).opacity = 0.26 * presence;
    if (this.blob && this.blobMaterial) {
      this.blob.position.set(centre.x, floorY + 0.002, centre.z);
      this.blob.scale.set(size.x * 1.35 + 1, 1, size.z * 1.35 + 1);
      this.blobMaterial.opacity = 0.42 * presence;
    }
    const dir = new Vector3(-0.16, 1, 0.3).normalize();
    this.light.target.position.copy(centre);
    this.light.position.copy(centre).addScaledVector(dir, radius * 4);
    const cam = this.light.shadow.camera;
    const h = radius * 1.7;
    cam.left = -h; cam.right = h; cam.top = h; cam.bottom = -h;
    cam.near = radius * 0.5;
    cam.far = radius * 9;
    cam.updateProjectionMatrix();
    this.light.target.updateMatrixWorld();
  }

  /** Where a point on an object falls in the window, in CSS pixels; `visible` is false behind the camera. */
  project(key: number, point: Vec3 | undefined, width: number, height: number, anchor?: string): { x: number; y: number; visible: boolean } | undefined {
    const node = this.nodes.get(key);
    if (!node) return undefined;
    const world = new Vector3();
    const named = anchor !== undefined && node.anchors && Object.hasOwn(node.anchors, anchor) ? node.anchors[anchor] : undefined;
    if (named) world.set(named[0], named[1], named[2]).applyMatrix4(node.obj.matrixWorld);
    else if (point) world.set(point[0], point[1], point[2]).applyMatrix4(node.obj.matrixWorld);
    else new Box3().setFromObject(node.obj).getCenter(world);
    const ndc = world.clone().project(this.camera);
    return { x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height, visible: ndc.z > -1 && ndc.z < 1 };
  }

  /** The window rectangle the model fills, and the part of the page its shadow touches too; undefined when there is no model. */
  screenBounds(width: number, height: number): { model: ScreenRect; drawn: ScreenRect } | undefined {
    if (!this.hasBox || this.box.isEmpty()) return undefined;
    const { min, max } = this.box;
    const corners: Vector3[] = [];
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) corners.push(new Vector3(x, y, z));
    const rect = (pts: Vector3[]): ScreenRect => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const c of pts) {
        const p = c.clone().project(this.camera);
        const sx = ((p.x + 1) / 2) * width, sy = ((1 - p.y) / 2) * height;
        x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
      }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    };
    const model = rect(corners);
    const size = this.box.getSize(new Vector3());
    const floorY = min.y - 0.03 * Math.max(size.x, size.y, size.z);
    const span = Math.max(size.x, size.z, 1) * 1.6;
    const centre = this.box.getCenter(new Vector3());
    const shadow = rect([-1, 1].flatMap((sx) => [-1, 1].map((sz) => new Vector3(centre.x + sx * span, floorY, centre.z + sz * span))));
    const x0 = Math.min(model.x, shadow.x), y0 = Math.min(model.y, shadow.y);
    const x1 = Math.max(model.x + model.w, shadow.x + shadow.w), y1 = Math.max(model.y + model.h, shadow.y + shadow.h);
    return { model, drawn: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
  }

  /**
   * The outline of every visible part of the model on screen, in CSS pixels: the convex hull of each
   * part's box. Tags are kept off these. Not cheap; ask when laying tags out, not every frame.
   */
  silhouette(width: number, height: number): Pt[][] {
    const hulls: Pt[][] = [];
    const corner = new Vector3();
    for (const node of this.nodes.values()) {
      if (!node.obj.visible || node.obj instanceof Sprite || node.path) continue;
      for (const piece of node.pieces) {
        const o = piece.object;
        if (!(o instanceof Mesh) || !o.visible) continue;
        const box = new Box3();
        if (o instanceof InstancedMesh) box.setFromObject(o);
        else {
          const geo = o.geometry as BufferGeometry;
          if (!geo.boundingBox) geo.computeBoundingBox();
          if (!geo.boundingBox) continue;
          o.updateWorldMatrix(true, false);
          box.copy(geo.boundingBox).applyMatrix4(o.matrixWorld);
        }
        if (box.isEmpty()) continue;
        const pts: Pt[] = [];
        // A box rotated with its part is covered by the box of its corners, which is a little roomy and always safe.
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
          corner.set(x, y, z).project(this.camera);
          pts.push({ x: ((corner.x + 1) / 2) * width, y: ((1 - corner.y) / 2) * height });
        }
        hulls.push(convexHull(pts));
      }
    }
    return hulls;
  }

  count(): number {
    return this.nodes.size;
  }

  destroy(): void {
    for (const node of this.nodes.values()) this.dispose(node);
    this.nodes.clear();
  }
}
