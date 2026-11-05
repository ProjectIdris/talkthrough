// The 3D scene: builds objects from a Frame, moves them as the frame changes, lights them, puts a soft
// shadow under them on the page, and places the camera. It never touches the DOM itself (text sprites
// and the shadow's gradient ask for a canvas through `makeCanvas`), so it can run and be tested
// without a renderer.
//
// The model floats over the page: the stage rectangle only says where the model is fitted. The
// camera is given the whole display as its window (`setViewOffset`), so nothing is clipped to the
// rectangle and a model may reach past it.

import {
  AmbientLight, Box3, BufferAttribute, BufferGeometry, CanvasTexture, Color, ConeGeometry, CylinderGeometry, DirectionalLight, EdgesGeometry, Euler,
  FrontSide, Group, HemisphereLight, InstancedMesh, LineBasicMaterial, LineSegments, Material, Matrix4, Mesh, MeshBasicMaterial, Object3D,
  PerspectiveCamera, PlaneGeometry, Quaternion, Raycaster, Scene, ShadowMaterial, SkinnedMesh, Sphere, SphereGeometry, SRGBColorSpace, Sprite, SpriteMaterial, TorusGeometry, Vector2, Vector3,
} from 'three';
import type { Texture } from 'three';
import type { AddAction, Vec3 } from '../scene/types.ts';
import { surfacePoint } from './flex-attachment.ts';
import { flexPickObject, flexPoseKey, registerFlexPick, unregisterFlexPick } from './flex-pick-proxy.ts';
import { FlexPickBudget, rayCandidates, safeRayIntersections } from './flex-pick-budget.ts';
import { sampleFrames } from './flex-frames.ts';
import { buildFlexGeometry } from './flex-geometry.ts';
import { projectRoot, rigidUniform } from './flex-root.ts';
import { makeFlexSkin } from './flex-skin.ts';
import { BLOB_MIN_TRIANGLES, blobGeometry } from './blob.ts';
import { DETAIL, boxGeometry, defaultBevel, drawFraction, extrudeGeometry, latheGeometry, pointAlong, roundedCylinderGeometry, samplePath, shadeByHeight, tubeGeometry } from './geometry.ts';
import type { Detail } from './geometry.ts';
import { TIERS, applySurface, makeSurface } from './materials.ts';
import type { Surface, Tier } from './materials.ts';
import { buildPart } from './parts.ts';
import { TAG_HEIGHT_FACTOR, tagTextPx } from './theme.ts';
import { convexHull } from './labels.ts';
import type { Pt } from './labels.ts';
import type { Piece } from './parts.ts';
import type { FocusFrame, Frame, ObjectFrame, Rgb } from './timeline.ts';
import { spreadPosition, userOffsets } from './explode.ts';
import type { Part } from './explode.ts';
import { Cutaway } from './cutaway.ts';
import { buildConnector, buildStream, updateAttached, updateConnectors, updateStreams } from './scene3d-flow.ts';
import type { FlowNode } from './scene3d-flow.ts';

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
/** Text in the scene is drawn as tall as a tag on screen, and at most this many times that, so it reads like the tags beside it and a big stage does not make it outweigh them. */
const MAX_TEXT_OVER_TAG = 1.3;
const PATH_RADIUS = 0.06;
function boxCorners(box: Box3, matrix: Matrix4 | undefined): Vector3[] {
  const out: Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const v = new Vector3(x, y, z);
    out.push(matrix ? v.applyMatrix4(matrix) : v);
  }
  return out;
}
/** A part as the camera's fit sees it: its bounding sphere and the eight corners of its own box. */
type PartHull = { sphere: Sphere; corners: Vector3[] };
const DEG = Math.PI / 180;

type CanvasLike = HTMLCanvasElement | OffscreenCanvas;
export type PanelDeps = { makeCanvas?: (width: number, height: number) => CanvasLike; tier?: Tier };

/** The stage in window pixels, and the size of the window it sits in. */
/** `now` (milliseconds on any steady clock) lets the camera glide to a new framing when parts are added; without it the framing jumps. */
export type StageView = { rect: { x: number; y: number; w: number; h: number }; width: number; height: number; now?: number };
/** Seconds the framing takes to settle (about two thirds of the way in this time) when the model grows or opens. */
const FIT_SETTLE_SECONDS = 0.45;
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
  flexRig?: ReturnType<typeof makeFlexSkin>;
  flexPosed?: Float32Array;
  flexPoseKey?: string;
  flexPick?: Mesh;
  texture?: CanvasTexture;
  /** The size the object is built at (text sprites are sized, everything else is 1). */
  baseScale: Vector3;
  /** How it looks just now (for what a cut needs to know). */
  alpha: number;
  color: Rgb;
  /** Named points of a ready-made part, in its own space. */
  anchors?: Record<string, Vec3>;
  /** For tubes, lines and arrows: what is needed to draw them part way. */
  path?: { geo: BufferGeometry; sampled: Vec3[]; head: Mesh | undefined; /** A tube thick for its length (a stem, a vessel, a limb, a pipe): part of the body, not a trailing cable. */ body: boolean };
  /** A connector's tube and what it was last built from; a stream's markers (see scene3d-flow.ts). */
  connector?: FlowNode['connector'];
  stream?: FlowNode['stream'];
  /** A tube or line with an end on a part: its points as drawn at rest (see scene3d-flow.ts). */
  attached?: FlowNode['attached'];
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
  /** The framing sphere the camera is using, which eases to the model's own as parts come and go. */
  private shownFit: { center: Vector3; radius: number } | undefined;
  private fitClock: number | undefined;
  /** The visible parts' bounding spheres and box corners at rest (no machine pose, no pulse), worked out in `sync` for the camera's fit. */
  private restSpheres: PartHull[] = [];
  /** Where the text sprites were put on screen by the last `tidyTexts` (window pixels): what is drawn includes them. */
  private textRects: ScreenRect[] = [];
  private settling = false;
  private cutaway = new Cutaway();
  private pinWarnings = new Set<number>();
  private flexWarnings = new Set<number>();
  private flexBudgetWarnings = new Set<number>();
  private flexBudget: FlexPickBudget | undefined;
  private flexModelBudget: FlexPickBudget | undefined;
  private flexPending: number[] = [];
  private flexPriority: number | undefined;
  private flexRetryFrames = 2;
  flexPickBudget(): FlexPickBudget | undefined { return this.flexModelBudget; }
  flexPickPending(): boolean { return this.flexPending.length > 0; }
  takeFlexPickRetry(): boolean { if(!this.flexPickPending() || this.flexRetryFrames<=0)return false;this.flexRetryFrames--;return true; }

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
        g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
        g.addColorStop(0.75, 'rgba(255,255,255,0.12)');
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
      if (geo.getAttribute('color')) surface.vertexColors = true;
      const mesh = new Mesh(geo, surface);
      mesh.castShadow = settings.shadows;
      mesh.receiveShadow = settings.shadows;
      node.geometries.push(geo);
      node.materials.push(surface);
      const closed = def.shape === 'box' || def.shape === 'sphere' || def.shape === 'cylinder' || def.shape === 'cone' || def.shape === 'extrude' || def.shape === 'torus';
      const piece: NodePiece = { object: mesh, surface, tint: true, color: undefined, lines: undefined, closed };
      if (edges && settings.edges && surfaceName !== 'glass' && surfaceName !== 'glow' && surfaceName !== 'bead') piece.lines = this.edgeLines(mesh, geo, node);
      node.pieces.push(piece);
      return mesh;
    };
    switch (def.shape) {
      case 'group': case 'array': break;
      case 'flexSurface': this.buildFlex(node, o); break;
      case 'part': {
        const built = buildPart(def, this.detail);
        node.obj = built.root;
        node.anchors = built.anchors;
        for (const p of built.pieces) this.adoptPiece(node, p);
        break;
      }
      case 'text': this.buildText(node, o); break;
      case 'tube': case 'line': case 'arrow': this.buildPath(node, o, addMesh); break;
      case 'connector': buildConnector(node, o, addMesh, this.detail.radial); break;
      case 'stream': buildStream(node, o, addMesh); break;
      default: {
        const geo = this.solidGeometry(def);
        if (def.shape === 'blob') shadeByHeight(geo);
        node.obj = addMesh(geo, material, def.shape !== 'blob' && ('edges' in def ? def.edges !== false : true));
      }
    }
    if (node.obj instanceof Sprite) node.baseScale = node.obj.scale.clone();
    return node;
  }

  private buildFlex(node: Node, o: ObjectFrame): void {
    if (o.def.shape !== 'flexSurface') return;
    const def=o.def, parent=o.parentKey===null?undefined:this.nodes.get(o.parentKey)?.obj;
    try {
      if (!(parent instanceof Mesh)) throw Error('unsupported rigid parent');
      this.scene.updateMatrixWorld(true);
      const frames=sampleFrames(def.sections), mirror=def.mirror==='localX';
      const seam=Array.from({length:7},(_,i)=>frames[0]!.center.clone().addScaledVector(frames[0]!.chord,(2*i/6-1)*frames[0]!.halfWidth));
      const root=new Vector3(...def.root.parentPoint), direction=new Vector3(...def.root.normal);
      if(mirror){for(const point of seam)point.x=-point.x;root.x=-root.x;direction.x=-direction.x;}
      const pos=def.pos??[0,0,0],rot=def.rot??[0,0,0];
      const rotation=new Euler(rot[0]*DEG,rot[1]*DEG,rot[2]*DEG,'XYZ');
      const flexToParent=new Matrix4().makeRotationFromEuler(rotation);flexToParent.setPosition(...pos);
      const projected=projectRoot(parent,seam,flexToParent,root,direction,def.root.maxGap);
      if(mirror)for(const point of projected)point.x=-point.x;
      const geo=buildFlexGeometry(frames,def.joints.map(j=>j.u),projected,mirror);geo.userData.flexMirror=mirror;
      const surface=makeSurface(def.material,TIERS[this.tier]);
      const rig=makeFlexSkin(parent,geo,surface,def.sections,def.joints,mirror,{pos,rot});
      const pickGeometry=new BufferGeometry();pickGeometry.setIndex(geo.getIndex());
      pickGeometry.setAttribute('position',new BufferAttribute(new Float32Array(geo.getAttribute('position').count*3),3));
      const pickMesh=new Mesh(pickGeometry,surface);pickMesh.matrixAutoUpdate=false;pickMesh.parent=parent;
      registerFlexPick(rig.mesh,pickMesh);node.flexPick=pickMesh;node.geometries.push(pickGeometry);
      node.obj=rig.mesh;node.flexRig=rig;node.geometries.push(geo);node.materials.push(surface);
      node.pieces.push({object:rig.mesh,surface,tint:true,color:undefined,lines:undefined,closed:true});
    } catch {
      if(!this.flexWarnings.has(o.key)&&this.flexWarnings.size<128){this.flexWarnings.add(o.key);console.warn(`talkthrough: articulated surface ${o.key} has invalid or unsupported root`);}
    }
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
        return roundedCylinderGeometry(sx, sy, sz, d.curve);
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
      case 'blob': {
        const b = def as { pts: Vec3[]; sizes: Vec3[]; soft?: number };
        // Past the scene's budget of blob triangles a later blob is cut coarser (never dropped, never below a floor).
        let used = 0;
        for (const n of this.nodes.values()) for (const g of n.geometries) used += (g.userData.triangles as number | undefined) ?? 0;
        return blobGeometry(b.pts, b.sizes, b.soft ?? 0.5, d.blob, Math.max(BLOB_MIN_TRIANGLES, d.blobTriangles - used));
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
    const def = o.def as { shape: string; pts: Vec3[]; radius?: number; flat?: number; swell?: Array<[number, number]>; material?: string };
    const tube = def.shape === 'tube';
    const sampled = samplePath(def.pts, tube, this.detail.tube);
    const radius = tube ? def.radius ?? PATH_RADIUS : PATH_RADIUS;
    const geo = tubeGeometry(sampled, radius, tube ? def.flat ?? 1 : 1, this.detail.radial, tube ? def.swell : undefined);
    const mesh = addMesh(geo, tube ? def.material : 'plastic', false);
    const group = new Group();
    group.add(mesh);
    let head: Mesh | undefined;
    if (def.shape === 'arrow') {
      head = addMesh(new ConeGeometry(PATH_RADIUS * 3.4, 0.55, 20), 'plastic', false);
      group.add(head);
    }
    node.obj = group;
    let length = 0;
    for (let i = 1; i < sampled.length; i++) length += Math.hypot(sampled[i]![0] - sampled[i - 1]![0], sampled[i]![1] - sampled[i - 1]![1], sampled[i]![2] - sampled[i - 1]![2]);
    node.path = { geo, sampled, head, body: tube && radius >= 0.04 * length };
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
    // The same look as a tag (a dark pill, a dot in the object's colour, white text), not an outlined word: it reads over bars, shadows and the page.
    const dot = fontPx * 0.4, padX = fontPx * 0.8, padY = fontPx * 0.55, gap = fontPx * 0.35; // a tag's proportions
    const textW = Math.ceil(probe.measureText(text).width);
    const width = Math.ceil(padX + dot + gap + textW + padX);
    const height = Math.ceil(fontPx + padY * 2);
    const canvas = make(width, height);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
    if (!ctx) return;
    const r = height / 2;
    ctx.fillStyle = 'rgba(20,24,36,1)';
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(width - r, 0);
    ctx.arc(width - r, r, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(r, height);
    ctx.arc(r, r, r, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = `rgb(${Math.round(o.color[0])},${Math.round(o.color[1])},${Math.round(o.color[2])})`;
    ctx.beginPath();
    ctx.arc(padX + dot / 2, height / 2, dot / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, padX + dot + gap, height / 2 + 3);
    const texture = new CanvasTexture(canvas as HTMLCanvasElement);
    texture.colorSpace = SRGBColorSpace;
    const mat = new SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
    const sprite = new Sprite(mat);
    const shown = (def.height * height) / fontPx; // def.height is the size of the letters; the pill is a little taller
    sprite.scale.set((shown * width) / height, shown, 1);
    sprite.renderOrder = 999;
    node.obj = sprite;
    node.texture = texture;
    node.materials.push(mat);
    node.pieces.push({ object: sprite, surface: undefined, tint: true, color: undefined, lines: undefined, closed: false });
  }

  private dispose(node: Node): void {
    this.cutaway.release(node);
    if(node.flexRig){unregisterFlexPick(node.flexRig.mesh);node.flexRig.skeleton.dispose();}
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
    // Pins and input use separately bounded allowances so repeated annotation work cannot starve a model hit.
    // 49,152 covers the measured 16-phase oblique sweep (38,950 candidate triangles worst case) with bounded headroom.
    this.flexBudget = frame.objects.some(o => o.def.shape === 'flexSurface') ? new FlexPickBudget(24, 49152) : undefined;
    this.flexModelBudget = this.flexBudget ? new FlexPickBudget() : undefined;
    const pinTargets=new Set(frame.marks.filter(m=>m.mark.op==='pin' && m.onKey!==undefined).map(m=>m.onKey!));
    this.flexPending=this.flexBudget ? this.flexPending.filter(key=>pinTargets.has(key)) : [];
    if(this.flexPending.length===0)this.flexRetryFrames=2;
    this.flexPriority=this.flexPending[0];
    const live = new Set<number>();
    const spreads = new Map<number, number>();
    for (const o of frame.objects) spreads.set(o.key, o.spread);
    // The person's Explode control: how far each part moves from where it sits (explode.ts).
    const offsets = (frame.userExplode ?? 0) > 0
      ? userOffsets(frame.objects.map((o): Part => {
        const explode = (o.def as { explode?: Vec3 }).explode;
        return { key: o.key, parentKey: o.parentKey, pos: o.pos, ...(explode ? { explode } : {}), ...((o.shape === 'text' || o.shape === 'flexSurface') ? { fixed: true } : {}) };
      }), frame.userExplode ?? 0)
      : undefined;
    const layout = (with_: Map<number, Vec3> | undefined, rest = false): void => {
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
        this.apply(node, o, o.parentKey !== null ? spreads.get(o.parentKey) ?? 0 : 0, with_?.get(o.key), rest);
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
        this.nodes.delete(key);this.flexBudgetWarnings.delete(key);this.flexWarnings.delete(key);
      }
    }
    // The camera fits the model at rest: a machine's pose and a part's pulse move parts about, and a camera that followed them would breathe.
    // So the parts' spheres are taken once with poses and pulses left out, then the frame is laid out as it really stands.
    if (frame.objects.some((o) => o.pose || o.pulse !== 0)) {
      layout(offsets, true);
      this.scene.updateMatrixWorld(true);
      this.restSpheres = this.partSpheres();
      layout(offsets);
    }
    this.scene.updateMatrixWorld(true);
    for (const o of frame.objects) if (o.def.shape === 'flexSurface') {
      const node=this.nodes.get(o.key), parent=frame.objects.find(p=>p.key===o.parentKey);
      if (!node?.flexRig) continue;
      const parentObject=parent?this.nodes.get(parent.key)?.obj:undefined, scale=parentObject?new Vector3().setFromMatrixScale(parentObject.matrixWorld):new Vector3();
      const uniform=parentObject ? rigidUniform(parentObject.matrixWorld) : false;
      let positive=true;for(let n:Object3D|null=parentObject??null;n;n=n.parent)if(n.scale.x<=0||n.scale.y<=0||n.scale.z<=0){positive=false;break;}
      let cut=false;for(let current=parent,depth=0;current && depth<6;depth++){if(current.cut){cut=true;break;}current=current.parentKey===null?undefined:frame.objects.find(x=>x.key===current!.parentKey);}
      if (!parent || !parentObject || cut || (frame.userCut??0)>0 || parent.opacity<1 || !uniform || !positive || Math.min(scale.x,scale.y,scale.z)<=0 || parentObject.matrixWorld.determinant()<=0) {
        node.obj.visible=false;
        if(!this.flexWarnings.has(o.key)&&this.flexWarnings.size<128){this.flexWarnings.add(o.key);console.warn(`talkthrough: articulated surface ${o.key} suppressed by unsupported parent state`);}
      } else this.flexWarnings.delete(o.key);
    }
    // Evaluate each bounded skin vertex once for this pose; use the same positions for bounds and later consumers.
    for (const node of this.nodes.values()) if (node.flexRig) {
      const mesh=node.flexRig.mesh, count=mesh.geometry.getAttribute('position').count;
      const posed=node.flexPosed?.length===count*3?node.flexPosed:new Float32Array(count*3);
      const poseKey=flexPoseKey(mesh);
      if(node.flexPoseKey!==poseKey || !mesh.boundingBox || !mesh.boundingSphere || !node.flexPosed){
        const box=new Box3(), p=new Vector3();
        for(let i=0;i<count;i++){mesh.getVertexPosition(i,p);posed[i*3]=p.x;posed[i*3+1]=p.y;posed[i*3+2]=p.z;box.expandByPoint(p);}
        node.flexPosed=posed;node.flexPoseKey=poseKey;mesh.boundingBox=box;mesh.boundingSphere=box.getBoundingSphere(new Sphere());
      }
      if(node.flexPick){const pick=node.flexPick;pick.parent=mesh.parent;pick.visible=mesh.visible;pick.matrixWorld.copy(mesh.matrixWorld);pick.userData.flexPoseKey=poseKey;const attr=pick.geometry.getAttribute('position') as BufferAttribute;if(attr.array!==posed)pick.geometry.setAttribute('position',new BufferAttribute(posed,3));else attr.needsUpdate=true;pick.geometry.boundingBox=mesh.boundingBox!.clone();pick.geometry.boundingSphere=mesh.boundingSphere!.clone();}
    }
    if (!frame.objects.some((o) => o.pose || o.pulse !== 0)) this.restSpheres = this.partSpheres();
    for(const o of frame.objects) if(o.flexAttachment){
      const a=o.flexAttachment, feature=this.nodes.get(o.key), host=this.nodes.get(a.onKey);
      if(!feature || !host?.flexRig || !host.obj.visible || !host.flexPosed){if(feature)feature.obj.visible=false;continue;}
      const sample=surfacePoint(host.flexRig.mesh,a.u,a.v,a.side,host.flexRig.mesh.geometry.userData.flexMirror===true,host.flexPosed);
      if(!sample){feature.obj.visible=false;continue;}
      const tangent=sample.tangent.clone().applyAxisAngle(sample.normal,a.tangentAngle*DEG*(host.flexRig.mesh.geometry.userData.flexMirror===true?-1:1)).normalize(), normal=sample.normal.clone(), binormal=new Vector3().crossVectors(normal,tangent).normalize();
      const worldRotation=new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(tangent,binormal,normal));
      const parent=feature.obj.parent;feature.obj.position.copy(parent?parent.worldToLocal(sample.position.clone()):sample.position);
      const parentRotation=parent?parent.getWorldQuaternion(new Quaternion()):new Quaternion();feature.obj.quaternion.copy(parentRotation.invert().multiply(worldRotation));
      feature.obj.updateMatrixWorld(true);
    }
    // A feature can extend beyond the flexible skin. Enlarge the host's stable
    // motion envelope by its maximum distance from the attachment origin.
    const featureReach=new Map<number,number>();
    for(const o of frame.objects) if(o.flexAttachment){
      const feature=this.nodes.get(o.key);if(!feature?.obj.visible)continue;
      const origin=feature.obj.getWorldPosition(new Vector3());let reach=0;
      feature.obj.traverse(child=>{
        if(!(child instanceof Mesh))return;const geometry=child.geometry;if(!geometry)return;
        if(!geometry.boundingSphere)geometry.computeBoundingSphere();if(!geometry.boundingSphere)return;
        const count=child instanceof InstancedMesh?child.count:1,instance=new Matrix4();
        for(let i=0;i<count;i++){
          const transform=child.matrixWorld.clone();if(child instanceof InstancedMesh){child.getMatrixAt(i,instance);transform.multiply(instance);}
          const sphere=geometry.boundingSphere.clone().applyMatrix4(transform);
          reach=Math.max(reach,sphere.radius+sphere.center.distanceTo(origin));
        }
      });
      featureReach.set(o.flexAttachment.onKey,Math.max(featureReach.get(o.flexAttachment.onKey)??0,reach));
    }
    for(const [hostKey,reach] of featureReach){
      const host=this.nodes.get(hostKey);if(!host?.flexRig||!host.obj.visible)continue;
      const envelope=host.flexRig.envelope.clone().applyMatrix4(host.obj.matrixWorld);envelope.radius+=reach;
      const size=new Vector3(envelope.radius*2,envelope.radius*2,envelope.radius*2),bounds=new Box3().setFromCenterAndSize(envelope.center,size);
      this.restSpheres.push({sphere:envelope,corners:boxCorners(bounds,undefined)});
    }
    // Connectors and streams are placed from where their parts now are; what hangs on a connector then needs its matrices again.
    updateAttached(this.nodes, frame, this.detail.radial, PATH_RADIUS);
    if (updateConnectors(this.nodes, frame, this.detail.radial)) this.scene.updateMatrixWorld(true);
    updateStreams(this.nodes, frame);
    this.scene.updateMatrixWorld(true);
    this.aim(frame, aspect, view, standBack);
    if (view) this.tidyTexts(view);
    // The person's Cut goes through the middle of the model from the side the camera looks from.
    this.cutaway.update(frame, this.nodes, this.scene, this.camera.getWorldDirection(new Vector3()).negate());
    this.placeShadow(frame);
  }

  private apply(node: Node, o: ObjectFrame, parentSpread: number, offset?: Vec3, rest = false): void {
    if(node.flexRig)node.flexRig.pose(rest ? node.flexRig.skeleton.bones.slice(1).map(()=>0) : o.flexPose?.angles ?? node.flexRig.skeleton.bones.slice(1).map(()=>0), rest ? 0 : o.flexPose?.profile ?? 0);
    const pulse = rest ? 0 : o.pulse;
    const pose = rest ? undefined : o.pose;
    const grow = 1 + 0.07 * pulse;
    // Spread by the model's own explode, then by the person's control; a machine's pose stands in for the rest values.
    const at = spreadPosition(pose?.pos ?? o.pos, (o.def as { explode?: Vec3 }).explode, o.shape==='flexSurface'?0:parentSpread);
    const rot = pose?.rot ?? o.rot;
    node.obj.position.set(at[0] + (offset?.[0] ?? 0), at[1] + (offset?.[1] ?? 0), at[2] + (offset?.[2] ?? 0));
    node.obj.rotation.copy(new Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'XYZ'));
    const loop = o.pose?.scale ?? [1, 1, 1]; // a pulse loop swells it on top of its own scale
    node.obj.scale.set(node.baseScale.x * o.scale[0] * loop[0] * grow, node.baseScale.y * o.scale[1] * loop[1] * grow, node.baseScale.z * o.scale[2] * loop[2] * grow);
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
    const az = cam.az * DEG, el = Math.max(-89, Math.min(89, cam.el)) * DEG;
    const fit = this.eased(this.fitTarget(az, el, tan, aspect), view?.now);
    let base = (FRAMING_UNITS / 2 / (aspect >= 1 ? 1 : aspect)) / tan;
    if (fit) base = Math.max(MIN_FIT_DISTANCE, fit.radius);
    void standBack;
    this.fitCenter = fit ? fit.center : undefined;
    const dist = base / Math.max(0.05, cam.zoom);
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
   * Text sprites in the scene (a value over a bar, a name on a part) are kept readable on screen: none shorter than a tag (same letter size and floor, `tagTextPx`) or more than 1.3 times as tall, and
   * two that would sit on each other are moved apart vertically (by the sprite's anchor, so they stay at their point in the world).
   */
  private tidyTexts(view: StageView): void {
    this.textRects = [];
    const sprites: Array<{ node: Node; cx: number; cy: number; w: number; h: number; depth: number }> = [];
    const p = new Vector3();
    const proj = this.camera.projectionMatrix.elements;
    const tagH = Math.ceil(tagTextPx(view.height, view.rect) * TAG_HEIGHT_FACTOR);
    for (const node of this.nodes.values()) {
      const sprite = node.obj;
      if (!(sprite instanceof Sprite)) continue;
      sprite.center.set(0.5, 0.5);
      if (!sprite.visible) continue;
      sprite.getWorldPosition(p);
      const depth = -p.clone().applyMatrix4(this.camera.matrixWorldInverse).z;
      if (depth <= 0) continue;
      p.project(this.camera);
      const cx = ((p.x + 1) / 2) * view.width, cy = ((1 - p.y) / 2) * view.height;
      const h = (sprite.scale.y * proj[5] * view.height) / (2 * depth);
      const k = h <= 0 ? 1 : h < tagH ? Math.min(12, tagH / h) : h > tagH * MAX_TEXT_OVER_TAG ? (tagH * MAX_TEXT_OVER_TAG) / h : 1;
      if (k !== 1) sprite.scale.multiplyScalar(k);
      sprites.push({ node, cx, cy, w: (sprite.scale.x / sprite.scale.y) * h * k, h: h * k, depth });
    }
    // Nearest first keeps its place; each later one moves up (then down) until it clears what is already placed.
    sprites.sort((a, b) => a.depth - b.depth);
    const placed: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
    for (const t of sprites) {
      const gap = 2;
      const clear = (dy: number): boolean => placed.every((r) => t.cx + t.w / 2 <= r.x0 || t.cx - t.w / 2 >= r.x1 || t.cy + dy + t.h / 2 + gap <= r.y0 || t.cy + dy - t.h / 2 - gap >= r.y1);
      let dy = 0;
      for (let i = 1; i <= 12 && !clear(dy); i++) dy = (i % 2 === 1 ? -1 : 1) * Math.ceil(i / 2) * (t.h + gap);
      if (!clear(dy)) dy = 0;
      if (dy !== 0) (t.node.obj as Sprite).center.set(0.5, 0.5 + dy / t.h);
      placed.push({ x0: t.cx - t.w / 2, y0: t.cy + dy - t.h / 2, x1: t.cx + t.w / 2, y1: t.cy + dy + t.h / 2 });
      this.textRects.push({ x: t.cx - t.w / 2, y: t.cy + dy - t.h / 2, w: t.w, h: t.h });
    }
  }

  /** True while the framing is still gliding to the model's size: the page should keep drawing frames. */
  get fitting(): boolean {
    return this.settling;
  }

  /**
   * The framing sphere eased toward the model's: a part added makes the model bigger, and a camera that jumped back for it would
   * make the whole model leap smaller; instead it glides. Without a clock, or with nothing shown before, it is taken as it is.
   */
  private eased(target: { center: Vector3; radius: number } | undefined, now: number | undefined): { center: Vector3; radius: number } | undefined {
    this.settling = false;
    if (!target || now === undefined || !this.shownFit || this.fitClock === undefined) {
      this.shownFit = target ? { center: target.center.clone(), radius: target.radius } : undefined;
      this.fitClock = now;
      return target;
    }
    const dt = Math.max(0, Math.min(250, now - this.fitClock)) / 1000;
    this.fitClock = now;
    const shown = this.shownFit;
    const k = 1 - Math.exp(-dt / FIT_SETTLE_SECONDS);
    shown.radius += (target.radius - shown.radius) * k;
    shown.center.lerp(target.center, k);
    if (Math.abs(target.radius - shown.radius) <= target.radius * 0.003 && shown.center.distanceTo(target.center) <= target.radius * 0.003) {
      shown.radius = target.radius;
      shown.center.copy(target.center);
    } else {
      this.settling = true;
    }
    return { center: shown.center.clone(), radius: shown.radius };
  }

  /**
   * A sphere round every visible part, from the parts' own bounding spheres (so a part turning on its axis does not make
   * the camera breathe the way a box round it would). Undefined when nothing is there.
   */
  private partSpheres(): PartHull[] {
    const spheres: PartHull[] = [];
    for (const node of this.nodes.values()) {
      if (!node.obj.visible || node.obj instanceof Sprite || node.pieces.length === 0 || (node.path && !node.path.body) || node.stream) continue;
      for (const p of node.pieces) {
        const mesh = p.object as Mesh;
        const geo = mesh.geometry;
        if (!geo) continue;
        if (mesh instanceof SkinnedMesh && mesh.boundingBox && mesh.boundingSphere) {
          const sphere=(node.flexRig?.envelope ?? mesh.boundingSphere).clone().applyMatrix4(mesh.matrixWorld);
          const box=new Box3().setFromCenterAndSize(sphere.center,new Vector3(sphere.radius*2,sphere.radius*2,sphere.radius*2));
          spheres.push({sphere,corners:boxCorners(box,undefined)});
          continue;
        }
        if (mesh instanceof InstancedMesh) {
          // The geometry is one instance; the piece is where all of them are.
          const box = new Box3().setFromObject(mesh);
          if (!box.isEmpty()) spheres.push({ sphere: box.getBoundingSphere(new Sphere()), corners: boxCorners(box, undefined) });
          continue;
        }
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        if (!geo.boundingBox) geo.computeBoundingBox();
        if (!geo.boundingSphere || !geo.boundingBox) continue;
        spheres.push({ sphere: geo.boundingSphere.clone().applyMatrix4(mesh.matrixWorld), corners: boxCorners(geo.boundingBox, mesh.matrixWorld) });
      }
    }
    return spheres;
  }

  /**
   * Where the model is on screen, tightly: for each part the overlap of its box's projection and its bounding sphere's, joined. A box alone
   * reaches past a round part by a corner's worth, which made a ball look bigger than it was (and its buttons and tags keep away from nothing).
   */
  private tightRect(width: number, height: number): ScreenRect | undefined {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const box = new Box3();
    const p = new Vector3();
    const proj = this.camera.projectionMatrix.elements;
    for (const node of this.nodes.values()) {
      if (!node.obj.visible || node.obj instanceof Sprite || node.pieces.length === 0 || (node.path && !node.path.body) || node.stream) continue;
      for (const piece of node.pieces) {
        const mesh = piece.object as Mesh;
        box.setFromObject(mesh);
        if (box.isEmpty()) continue;
        let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity;
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
          p.set(x, y, z).project(this.camera);
          const sx = ((p.x + 1) / 2) * width, sy = ((1 - p.y) / 2) * height;
          a0 = Math.min(a0, sx); a1 = Math.max(a1, sx); b0 = Math.min(b0, sy); b1 = Math.max(b1, sy);
        }
        if (!(mesh instanceof InstancedMesh) && !(mesh instanceof SkinnedMesh) && mesh.geometry) {
          if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
          const bs = mesh.geometry.boundingSphere?.clone().applyMatrix4(mesh.matrixWorld);
          if (bs) {
            const view = bs.center.clone().applyMatrix4(this.camera.matrixWorldInverse);
            const depth = -view.z, d3 = view.length();
            if (depth > 0 && bs.radius < d3 * 0.9) {
              const r = bs.radius / Math.sqrt(1 - (bs.radius / d3) ** 2);
              p.copy(bs.center).project(this.camera);
              const cx = ((p.x + 1) / 2) * width, cy = ((1 - p.y) / 2) * height;
              const rx = (r * proj[0] * width) / (2 * depth), ry = (r * proj[5] * height) / (2 * depth);
              a0 = Math.max(a0, cx - rx); a1 = Math.min(a1, cx + rx); b0 = Math.max(b0, cy - ry); b1 = Math.min(b1, cy + ry);
            }
          }
        }
        if (a0 > a1 || b0 > b1) continue;
        x0 = Math.min(x0, a0); x1 = Math.max(x1, a1); y0 = Math.min(y0, b0); y1 = Math.max(y1, b1);
      }
    }
    return x0 <= x1 && y0 <= y1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : undefined;
  }

  /**
   * Where everything drawn is on screen: the box of every visible mesh, line or sprite in the scene (the floor and its shadow blob are the shadow's own rectangle),
   * projected corner by corner. A box is roomier than the thing in it and never smaller. Something at or behind the camera could be anywhere on screen, so the
   * whole window is then given.
   */
  private looseRect(width: number, height: number): ScreenRect | undefined {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const box = new Box3();
    const p = new Vector3();
    const inv = this.camera.matrixWorldInverse;
    let anywhere = false;
    this.scene.traverseVisible((o) => {
      if (o === this.floor || o === this.blob || !((o as Mesh).isMesh || (o as LineSegments).isLineSegments || (o as Sprite).isSprite)) return;
      box.setFromObject(o);
      if (box.isEmpty()) return;
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        p.set(x, y, z);
        if (p.clone().applyMatrix4(inv).z > -this.camera.near) { anywhere = true; return; }
        p.project(this.camera);
        const sx = ((p.x + 1) / 2) * width, sy = ((1 - p.y) / 2) * height;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
    });
    if (anywhere) return { x: 0, y: 0, w: width, h: height };
    return x0 <= x1 && y0 <= y1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : undefined;
  }

  /**
   * Where the camera stands to show the model at rest as large as the stage allows from this direction: the middle of the parts' box and the
   * distance (returned as `radius`, so it eases like the old sphere did) at which every part's sphere sits inside the stage's frustum, with the
   * margin. A tall or long model fills its stage instead of leaving it mostly empty, and, being made from the rest pose, it does not breathe
   * when a part pulses or a machine moves. Never further than the all-round sphere would put it.
   */
  private fitTarget(az: number, el: number, tan: number, aspect: number): { center: Vector3; radius: number } | undefined {
    const parts = this.restSpheres;
    if (parts.length === 0) return undefined;
    const lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const p of parts) for (const c of p.corners) { lo.min(c); hi.max(c); }
    const center = lo.add(hi).multiplyScalar(0.5);
    const toCam = new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    const right = new Vector3().crossVectors(new Vector3(0, 1, 0), toCam);
    if (right.lengthSq() < 1e-9) right.set(1, 0, 0);
    right.normalize();
    const up = new Vector3().crossVectors(toCam, right).normalize();
    const tanY = tan, tanX = tan * aspect;
    const kx = Math.sqrt(1 + tanX * tanX), ky = Math.sqrt(1 + tanY * tanY);
    const rel = new Vector3();
    let dist = 0;
    for (const { sphere: s, corners } of parts) {
      // Each part needs the nearer of what its box asks and what its bounding sphere asks: a long thin part is held by its box, a round one by its sphere.
      let byBox = 0;
      for (const c of corners) {
        rel.copy(c).sub(center);
        byBox = Math.max(byBox, rel.dot(toCam) + Math.max(Math.abs(rel.dot(right)) / tanX, Math.abs(rel.dot(up)) / tanY));
      }
      rel.copy(s.center).sub(center);
      const bySphere = rel.dot(toCam) + Math.max((Math.abs(rel.dot(right)) + s.radius * kx) / tanX, (Math.abs(rel.dot(up)) + s.radius * ky) / tanY);
      dist = Math.max(dist, Math.min(byBox, bySphere));
    }
    return { center, radius: dist * FIT_MARGIN };  }

  /** How far the visible parts reach from a point: the largest distance to a corner of a part's box. */
  private reach(from: Vector3): number {
    let far = 0;
    const box = new Box3();
    const corner = new Vector3();
    for (const node of this.nodes.values()) {
      if (!node.obj.visible || node.obj instanceof Sprite || node.pieces.length === 0 || (node.path && !node.path.body) || node.stream) continue;
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
    // How solid the model is, by its biggest part: a shadow under a see-through shell would grey the layers inside it.
    let biggest = 0, solidity = 1;
    for (const node of this.nodes.values()) {
      if (!node.obj.visible || node.obj instanceof Sprite || node.pieces.length === 0 || (node.path && !node.path.body) || node.stream) continue;
      const b = new Box3().setFromObject(node.obj);
      if (!b.isEmpty()) {
        this.box.union(b);
        this.hasBox = true;
        const sz = b.getSize(new Vector3());
        const volume = sz.x * sz.y * sz.z;
        if (volume > biggest) {
          biggest = volume;
          solidity = node.alpha * Math.min(1, ...node.pieces.map((p) => p.surface?.userData.base ?? 1));
        }
      }
    }
    const weight = 0.12 + 0.88 * Math.max(0, Math.min(1, solidity)) ** 1.5;
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
    (this.floor.material as ShadowMaterial).opacity = 0.24 * presence * weight;
    if (this.blob && this.blobMaterial) {
      this.blob.position.set(centre.x, floorY + 0.002, centre.z);
      // Close to the foot of the model: a wider cloud smears across the stage and out of its card.
      this.blob.scale.set(size.x * 1.05 + 0.3, 1, size.z * 1.05 + 0.3);
      this.blobMaterial.opacity = 0.36 * presence * weight;
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

  /** Where a visible point on the named object falls in the window, in CSS pixels. */
  project(key: number, point: Vec3 | undefined, width: number, height: number, anchor?: string): { x: number; y: number; visible: boolean } | undefined {
    const node = this.nodes.get(key);
    const hidden = (reason = 'has no visible surface') => {
      const warnings=reason === 'exceeded the frame pick budget' ? this.flexBudgetWarnings : this.pinWarnings;
      if (!warnings.has(key) && warnings.size < 128) { warnings.add(key); console.warn(`talkthrough: pin target ${key} ${reason}`); }
      return { x: 0, y: 0, visible: false };
    };
    if (!node) { hidden(); return undefined; }
    const defer = () => { if(!this.flexPending.includes(key) && this.flexPending.length<160)this.flexPending.push(key); return hidden('exceeded the frame pick budget'); };
    if(this.flexPriority!==undefined && key!==this.flexPriority)return defer();
    if(this.flexPriority===key){this.flexPending=this.flexPending.filter(k=>k!==key);this.flexPriority=undefined;}
    const isVisible = (obj: Object3D): boolean => {
      for (let p: Object3D | null = obj; p; p = p.parent) if (!p.visible) return false;
      return true;
    };
    if (!isVisible(node.obj) || node.alpha <= 0.003) return hidden();
    // Scene text is a camera-facing sprite drawn with depth testing disabled.
    // Its origin is also used by the text-layout and clipping calculations.
    if (node.obj instanceof Sprite) {
      const world = point ? new Vector3(...point).applyMatrix4(node.obj.matrixWorld) : node.obj.getWorldPosition(new Vector3());
      const ndc = world.project(this.camera);
      return { x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height, visible: ndc.x >= -1 && ndc.x <= 1 && ndc.y >= -1 && ndc.y <= 1 && ndc.z > -1 && ndc.z < 1 };
    }
    const target: Mesh[] = [], occluders: Mesh[] = [];
    const posed = new Map<Mesh, Float32Array>();
    for (const other of this.nodes.values()) {
      if (!isVisible(other.obj) || other.alpha <= 0.003) continue;
      const belongs = other === node || isAncestor(node.obj, other.obj);
      for (const part of other.pieces) {
        if (!(part.object instanceof Mesh) || !isVisible(part.object) || !part.surface || part.surface.opacity <= 0.003) continue;
        const pick=flexPickObject(part.object);
        if (!pick) return hidden('has no current posed geometry');
        if (other.flexPosed) posed.set(pick, other.flexPosed);
        if (belongs) target.push(pick);
        else if (part.surface.opacity >= 0.98) occluders.push(pick);
      }
    }
    if (!target.length) return hidden();
    if (this.flexBudget && !this.flexBudget.query()) return defer();
    const candidates: Vector3[] = [];
    const named = anchor !== undefined && node.anchors && Object.hasOwn(node.anchors, anchor) ? node.anchors[anchor] : undefined;
    const explicit = named ?? point;
    if (explicit) candidates.push(new Vector3(...explicit).applyMatrix4(node.obj.matrixWorld));
    else {
      const box = new Box3().setFromObject(node.obj);
      if (!box.isEmpty()) candidates.push(box.getCenter(new Vector3()));
      if (node.path?.sampled.length) for (let i = 0; i < 12; i++) {
        const p = node.path.sampled[Math.floor((node.path.sampled.length - 1) * i / 11)]!;
        candidates.push(new Vector3(...p).applyMatrix4(node.obj.matrixWorld));
      }
      // Triangle interiors provide candidates on surfaces even when an AABB centre is empty.
      for (const mesh of target.slice(0, 8)) {
        const geo = mesh.geometry, pos = geo.getAttribute('position'), index = geo.getIndex();
        if (!pos) continue;
        const count = Math.floor((index?.count ?? pos.count) / 3);
        const start = Math.floor(geo.drawRange.start / 3), end = Math.min(count, Math.floor((geo.drawRange.start + geo.drawRange.count) / 3));
        for (let i = 0; i < 8 && end > start; i++) {
          const tri = start + Math.floor((end - start - 1) * i / 7), v = new Vector3();
          for (let j = 0; j < 3; j++) { const id=index ? index.getX(tri * 3 + j) : tri * 3 + j, cache=posed.get(mesh); v.add(cache ? new Vector3(cache[id*3]!,cache[id*3+1]!,cache[id*3+2]!) : new Vector3().fromBufferAttribute(pos,id)); }
          v.multiplyScalar(1 / 3);
          if (mesh instanceof InstancedMesh && mesh.count > 0) {
            const instance = new Matrix4();
            mesh.getMatrixAt(Math.floor((mesh.count - 1) * i / 7), instance);
            v.applyMatrix4(instance);
          }
          candidates.push(v.applyMatrix4(mesh.matrixWorld));
        }
      }
    }
    const ray = new Raycaster();
    ray.near = this.camera.near;
    ray.far = this.camera.far;
    const allowed = (hit: { point: Vector3; object: Object3D }): boolean => {
      const material = (hit.object as Mesh).material;
      const mats = Array.isArray(material) ? material : [material];
      return mats.some((m) => m && m.visible && !(m.clippingPlanes ?? []).some((plane) => plane.distanceToPoint(hit.point) < -1e-6));
    };
    for (const world of candidates) {
      const ndc = world.clone().project(this.camera);
      if (ndc.x < -1 || ndc.x > 1 || ndc.y < -1 || ndc.y > 1 || ndc.z <= -1 || ndc.z >= 1) continue;
      // A named or explicit point on the removed side of a cut is not visible,
      // even if the same camera ray happens to meet the back of the object.
      if (explicit && !target.some((mesh) => {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        return mats.some((m) => m.visible && !(m.clippingPlanes ?? []).some((plane) => plane.distanceToPoint(world) < -1e-6));
      })) continue;
      ray.setFromCamera(new Vector2(ndc.x, ndc.y), this.camera);
      const rayTarget=rayCandidates(target,ray);
      if (this.flexBudget && !this.flexBudget.ray(rayTarget)) return defer();
      const hit = safeRayIntersections(ray,rayTarget).find(allowed);
      if (!hit) continue;
      const rayOccluders=rayCandidates(occluders,ray);
      if (this.flexBudget && !this.flexBudget.ray(rayOccluders)) return defer();
      const blocker = safeRayIntersections(ray,rayOccluders).find(allowed);
      if (blocker && blocker.distance < hit.distance - 1e-5) continue;
      if (explicit) {
        // Do not snap a point in front of the target onto its visible face.
        const distance = world.distanceTo(this.camera.position);
        if (distance < hit.distance - 1e-4) {
          // A cut can expose the interior before the remaining back surface.
          const material = (hit.object as Mesh).material;
          const mats = Array.isArray(material) ? material : [material];
          const throughCut = mats.some((m) => (m.clippingPlanes ?? []).some((plane) => {
            const at = ray.ray.intersectPlane(plane, new Vector3());
            return at !== null && at.distanceTo(this.camera.position) < distance;
          }));
          if (!throughCut) continue;
        }
        // A reverse ray from the requested point sees a back face only when
        // the point is on or beyond it; an interior point can still project
        // to the visible front surface without being moved in screen space.
        const away = world.clone().sub(this.camera.position).normalize();
        const reverse = new Raycaster(world.clone().addScaledVector(away, 1e-4), away.negate(), 0, distance + 1e-4);
        // Cut surfaces render both sides, but the reverse test must still
        // distinguish a back face from the front face of an interior point.
        const sides = new Map<Material, Material['side']>();
        for (const mesh of target) for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
          if (!sides.has(m)) { sides.set(m, m.side); m.side = FrontSide; }
        }
        let beyond = false;
        const reverseTarget=rayCandidates(target,reverse);
        if (this.flexBudget && !this.flexBudget.ray(reverseTarget)) { for (const [m, side] of sides) m.side = side; return defer(); }
        try { beyond = safeRayIntersections(reverse,reverseTarget).some(allowed); }
        finally { for (const [m, side] of sides) m.side = side; }
        if (beyond) continue;
      }
      this.pinWarnings.delete(key);
      return { x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height, visible: true };
    }
    return hidden();
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
    const model = this.tightRect(width, height) ?? rect(corners);
    const size = this.box.getSize(new Vector3());
    const floorY = min.y - 0.03 * Math.max(size.x, size.y, size.z);
    const span = Math.max(size.x, size.z, 1) * 1.6;
    const centre = this.box.getCenter(new Vector3());
    const shadow = rect([-1, 1].flatMap((sx) => [-1, 1].map((sz) => new Vector3(centre.x + sx * span, floorY, centre.z + sz * span))));
    let x0 = Math.min(model.x, shadow.x), y0 = Math.min(model.y, shadow.y);
    let x1 = Math.max(model.x + model.w, shadow.x + shadow.w), y1 = Math.max(model.y + model.h, shadow.y + shadow.h);
    // Everything that is drawn, not only the parts the camera is fitted to: a line, an arrow, a hose or a stream, a cap on a cut, a part not yet counted.
    // The tight rectangle above is for where buttons and tags go; the scissor must never be tighter than what is actually drawn.
    const loose = this.looseRect(width, height);
    if (loose) { x0 = Math.min(x0, loose.x); y0 = Math.min(y0, loose.y); x1 = Math.max(x1, loose.x + loose.w); y1 = Math.max(y1, loose.y + loose.h); }
    // The text drawn over the model may stand a little beyond it (moved apart from its neighbours): the scissor has to let it through.
    for (const r of this.textRects) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
    // A little room all round: what is drawn (a lit edge, a part a pixel or two past its box) must not be cut by the scissor.
    const pad = 6 + 0.04 * Math.max(model.w, model.h);
    return { model, drawn: { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad } };
  }

  /**
   * The outline of every visible part of the model on screen, in CSS pixels: the convex hull of each
   * part's box. Tags are kept off these. Not cheap; ask when laying tags out, not every frame.
   */
  silhouette(width: number, height: number): Pt[][] {
    const hulls: Pt[][] = [];
    const corner = new Vector3();
    for (const node of this.nodes.values()) {
      if (!node.obj.visible || node.obj instanceof Sprite || node.path || node.stream) continue;
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
