import { applyPathTreatment, setPathSurfaceCoordinates, treatmentOf } from './surface-treatment.ts';
import { taperedExtrudeEdges, taperedExtrudeGeometry } from './tapered-extrusion.ts';
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
  FrontSide, Group, HemisphereLight, InstancedMesh, LineBasicMaterial, LineSegments, Material, Matrix4, Mesh, MeshBasicMaterial, Object3D,
  DoubleSide, PerspectiveCamera, PlaneGeometry, Raycaster, Scene, ShadowMaterial, Sphere, SphereGeometry, SRGBColorSpace, Sprite, SpriteMaterial, TorusGeometry, Vector2, Vector3,
} from 'three';
import type { Texture } from 'three';
import type { AddAction, SurfaceFinish, Vec3 } from '../scene/types.ts';
import { sweepGeometry, sweepEdges } from './sweep.ts';
import { shellGeometry, shellEdges } from './shell.ts';
import { BLOB_MIN_TRIANGLES, blobGeometry } from './blob.ts';
import { buildHullGeometry } from './hull.ts';
import { loftEdges, loftGeometry } from './loft.ts';
import { DETAIL, boxGeometry, defaultBevel, drawFraction, extrudeGeometry, latheGeometry, pointAlong, roundedCylinderGeometry, samplePath, shadeByHeight, tubeGeometry } from './geometry.ts';
import type { Detail } from './geometry.ts';
import { closedTubeGeometry } from './closed-tube.ts';
import { TIERS, applySurface, makeSurface } from './materials.ts';
import type { Surface, Tier } from './materials.ts';
import { buildPart } from './parts.ts';
import { TAG_HEIGHT_FACTOR, tagTextPx } from './theme.ts';
import { convexHull } from './labels.ts';
import type { Pt } from './labels.ts';
import type { Piece } from './parts.ts';
import { sweptPoses } from './timeline.ts';
import type { FocusFrame, Frame, ObjectFrame, Rgb } from './timeline.ts';
import type { Pose } from './motion.ts';
import { spreadPosition, userOffsets } from './explode.ts';
import type { Part } from './explode.ts';
import { PATCH_SEGMENTS } from '../scene/patch.ts';
import { patchGeometry, patchEdges } from './patch.ts';
import { Cutaway } from './cutaway.ts';
import { anchorsOf } from '../scene/anchors.ts';
import { latheSectorEdges, latheSectorGeometry } from './lathe-sector.ts';
import { buildConnector, buildForce, buildParticles, buildStream, updateAttached, updateConnectors, updateForces, updateParticles, updateStreams, updateWaves } from './scene3d-flow.ts';
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
  texture?: CanvasTexture;
  /** The size the object is built at (text sprites are sized, everything else is 1). */
  baseScale: Vector3;
  /** How it looks just now (for what a cut needs to know). */
  alpha: number;
  color: Rgb;
  /** The points of this object a connector or a part can be attached at, in its own space (built in, a kit part's own, and those the model named). */
  anchors?: Record<string, Vec3>;
  anchorsFrom?: { def: object; points: object | undefined };
  /** A faint line from where an attached part sits assembled to where it is pulled to (an exploded view), in its parent's space. */
  join?: LineSegments;
  /** For tubes, lines and arrows: what is needed to draw them part way. */
  path?: { geo: BufferGeometry; sampled: Vec3[]; head: Mesh | undefined; /** A tube thick for its length (a stem, a vessel, a limb, a pipe): part of the body, not a trailing cable. */ body: boolean };
  /** A connector's tube and what it was last built from; a stream's markers (see scene3d-flow.ts). */
  connector?: FlowNode['connector'];
  stream?: FlowNode['stream'];
  wave?: FlowNode['wave'];
  particles?: FlowNode['particles'];
  force?: FlowNode['force'];
  /** A tube or line with an end on a part: its points as drawn at rest (see scene3d-flow.ts). */
  attached?: FlowNode['attached'];
};

type AddMesh = (geo: BufferGeometry, surface: string | undefined, edges: boolean) => Mesh;

/** A rounded box has a continuous surface, not authored creases. Position hashing on
 * tiny rounded meshes can invent dark seams, so do not derive crease lines for them. */
function creaseGeometry(geo: BufferGeometry): BufferGeometry {
  return geo.type === 'RoundedBoxGeometry' ? new BufferGeometry().setFromPoints([]) : new EdgesGeometry(geo, 28);
}

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
  /** The parts' spheres and boxes at the poses a running machine takes over its cycle (see `sweptPoses`), kept while the machine and its parts are as they were. */
  private sweepHulls: PartHull[] = [];
  private sweepKey = '';
  /** Where the text sprites were put on screen by the last `tidyTexts` (window pixels): what is drawn includes them. */
  private textRects: ScreenRect[] = [];
  private settling = false;
  private cutaway = new Cutaway();
  private sharedEdges = new Map<string, { geometry: BufferGeometry; refs: number }>();
  private edgeKeys = new WeakMap<BufferGeometry, string>();
  /** Only immutable primitive buffers are shared; materials, transforms and mutable paths stay per node. */
  private sharedSolids = new Map<string, { geometry: BufferGeometry; refs: number }>();
  private solidKeys = new WeakMap<BufferGeometry, string>();
  private pinWarnings = new Set<number>();

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
    const finish: SurfaceFinish = {
      roughness: 'roughness' in def ? def.roughness : undefined,
      metalness: 'metalness' in def ? def.metalness : undefined,
      clearcoat: 'clearcoat' in def ? def.clearcoat : undefined,
      clearcoatRoughness: 'clearcoatRoughness' in def ? def.clearcoatRoughness : undefined,
    };
    const addMesh: AddMesh = (geo, surfaceName, edges) => {
      const surface = makeSurface(surfaceName, settings, finish);
      if (def.shape === 'tube' || def.shape === 'connector') {
        setPathSurfaceCoordinates(geo, treatmentOf(def));
        applyPathTreatment(surface, treatmentOf(def));
      }
      if (def.shape === 'patch') { surface.side = DoubleSide; surface.forceSinglePass = true; }
      if (geo.getAttribute('color')) surface.vertexColors = true;
      const mesh = new Mesh(geo, surface);
      mesh.castShadow = settings.shadows;
      mesh.receiveShadow = settings.shadows;
      // Stream markers reuse one buffer inside this node, with separate materials.
      // Record node ownership once, not once per marker, so teardown releases once.
      if (!node.geometries.includes(geo)) node.geometries.push(geo);
      node.materials.push(surface);
      const closed = def.shape === 'box' || def.shape === 'sphere' || def.shape === 'cylinder' || def.shape === 'cone' || def.shape === 'extrude' || def.shape === 'hull' || def.shape === 'shell' || def.shape === 'loft' || def.shape === 'sweep' || def.shape === 'torus' || (def.shape === 'lathe' && def.sweep != null);
      const piece: NodePiece = { object: mesh, surface, tint: true, color: undefined, lines: undefined, closed };
      if (edges && settings.edges && surfaceName !== 'glass' && surfaceName !== 'glow' && surfaceName !== 'bead') piece.lines = this.edgeLines(mesh, geo, node, this.primitiveKey(def), def.shape === 'lathe' && def.sweep != null ? 'sector' : def.shape === 'extrude' && (def.taper != null || def.shift != null) ? 'tapered' : def.shape === 'patch' ? 'patch' : undefined);
      node.pieces.push(piece);
      return mesh;
    };
    switch (def.shape) {
      case 'group': case 'array': case 'field': break;
      case 'hull': {
        const result = buildHullGeometry(def.pts);
        if (result.ok) node.obj = addMesh(result.geometry, material, def.edges !== false);
        else console.warn(`talkthrough: hull ${o.id} could not be built: ${result.message}`);
        break;
      }
      case 'part': {
        const built = buildPart(def, this.detail);
        node.obj = built.root;
        for (const p of built.pieces) this.adoptPiece(node, p);
        break;
      }
      case 'sweep': {
        const geo = sweepGeometry(def, this.tier);
        if (geo) node.obj = addMesh(geo, material, def.edges !== false);
        break;
      }
      case 'loft': {
        const geo = loftGeometry(def, this.tier);
        if (geo) node.obj = addMesh(geo, material, def.edges !== false);
        break;
      }
      case 'shell': {
        const geometry = shellGeometry(def, this.tier);
        if (!geometry) break;
        const mesh = addMesh(geometry, material, false);
        node.obj = mesh;
        if (def.edges !== false && settings.edges && material !== 'glass' && material !== 'glow' && (geometry.userData.shellEdges as Float32Array).length) {
          const mat = new LineBasicMaterial({ color: 0x10131a, transparent: true, opacity: 0.5 });
          const lines = new LineSegments(shellEdges(geometry), mat);
          mesh.add(lines); node.geometries.push(lines.geometry); node.materials.push(mat);
          node.pieces[0]!.lines = lines;
        }
        break;
      }
      case 'text': this.buildText(node, o); break;
      case 'tube': case 'line': case 'arrow': this.buildPath(node, o, addMesh); break;
      case 'connector': buildConnector(node, o, addMesh, this.detail.radial); break;
      case 'stream': buildStream(node, o, addMesh); break;
      case 'particles': buildParticles(node, o, addMesh); break;
      case 'force': buildForce(node, o, addMesh); break;
      default: {
        const geo = this.solidGeometry(def);
        if (def.shape === 'blob') shadeByHeight(geo);
        // These primitives have continuous surfaces, not authored creases. Facet-angle
        // extraction invents dark seams on thin ellipsoids, rounded rims and stretched
        // rings; position buckets can add more on compact meshes enlarged by a parent.
        const continuous = def.shape === 'blob' || def.shape === 'sphere' || def.shape === 'cylinder' || def.shape === 'torus';
        node.obj = addMesh(geo, material, !continuous && ('edges' in def ? def.edges !== false : true));
      }
    }
    if (node.obj instanceof Sprite) node.baseScale = node.obj.scale.clone();
    return node;
  }

  private primitiveKey(def: AddAction): string | undefined {
    if (!['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane'].includes(def.shape)) return undefined;
    const solid = def as { size: Vec3; bevel?: number };
    return JSON.stringify([this.tier, def.shape, solid.size, def.shape === 'box' ? solid.bevel ?? defaultBevel(solid.size) : null]);
  }

  private edgeLines(mesh: Mesh, geo: BufferGeometry, node: Node, key?: string, boundary?: 'sector' | 'tapered' | 'patch'): LineSegments {
    const mat = new LineBasicMaterial({ color: 0x10131a, transparent: true, opacity: 0.5 });
    let outline: BufferGeometry;
    const existing = key && this.sharedEdges.get(key);
    if (existing) { existing.refs++; outline = existing.geometry; }
    else if (key) {
      // EdgesGeometry.parameters retains the input mesh geometry. Copy the derived
      // buffers so a surviving outline never retains a removed part's geometry.
      const generated = creaseGeometry(geo);
      outline = new BufferGeometry().copy(generated);
      generated.dispose();
      this.sharedEdges.set(key, { geometry: outline, refs: 1 });
      this.edgeKeys.set(outline, key);
    } else outline = boundary === 'sector' ? latheSectorEdges(geo) : boundary === 'tapered' ? taperedExtrudeEdges(geo) : boundary === 'patch' ? patchEdges(geo, PATCH_SEGMENTS[this.tier]) : geo.userData.sweepEdges instanceof Float32Array ? sweepEdges(geo) : geo.userData.loftEdges instanceof Float32Array ? loftEdges(geo) : creaseGeometry(geo);
    const lines = new LineSegments(outline, mat);
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
    const key = this.primitiveKey(def);
    if (!key) return this.buildSolidGeometry(def);
    const existing = this.sharedSolids.get(key);
    if (existing) {
      existing.refs++;
      return existing.geometry;
    }
    const geometry = this.buildSolidGeometry(def);
    this.sharedSolids.set(key, { geometry, refs: 1 });
    this.solidKeys.set(geometry, key);
    return geometry;
  }

  private buildSolidGeometry(def: AddAction): BufferGeometry {
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
      case 'patch': return patchGeometry(def.pts, PATCH_SEGMENTS[this.tier]);
      case 'extrude': {
        const e = def as { outline: Array<[number, number]>; depth: number; bevel?: number; holes?: Array<Array<[number, number]>>; taper?: number; shift?: [number, number] };
        if (e.taper != null || e.shift != null) return taperedExtrudeGeometry(e.outline, e.depth, e.taper ?? 1, e.shift ?? [0, 0]);
        return extrudeGeometry(e.outline, e.depth, e.bevel ?? Math.min(0.1, e.depth * 0.2), d, e.holes);
      }
      case 'blob': {
        const b = def as { pts: Vec3[]; sizes: Vec3[]; soft?: number };
        // Past the scene's budget of blob triangles a later blob is cut coarser (never dropped, never below a floor).
        let used = 0;
        for (const n of this.nodes.values()) for (const g of n.geometries) used += (g.userData.triangles as number | undefined) ?? 0;
        return blobGeometry(b.pts, b.sizes, b.soft ?? 0.5, d.blob, Math.max(BLOB_MIN_TRIANGLES, d.blobTriangles - used));
      }
      case 'lathe': {
        const l = def as { profile: Array<[number, number]>; sides?: number; sweep?: number };
        return l.sweep == null ? latheGeometry(l.profile, l.sides ?? d.curve) : latheSectorGeometry(l.profile, l.sides ?? d.curve, l.sweep);
      }
      default: {
        const b = def as { size: Vec3; bevel?: number };
        return boxGeometry(b.size, b.bevel ?? defaultBevel(b.size), d);
      }
    }
  }

  private buildPath(node: Node, o: ObjectFrame, addMesh: AddMesh): void {
    const def = o.def as { shape: string; pts: Vec3[]; radius?: number; flat?: number; swell?: Array<[number, number]>; closed?: boolean; material?: string };
    const tube = def.shape === 'tube';
    // A field line (made by the timeline) is finer than an arrow the model draws, and counts in the fit of the camera: the lines are the picture.
    const fine = (def as { fine?: boolean }).fine === true;
    const radius = tube ? def.radius ?? PATH_RADIUS : fine ? PATH_RADIUS * 0.8 : PATH_RADIUS;
    const loop = tube && def.closed ? closedTubeGeometry(def.pts, radius, def.flat ?? 1, this.detail.radial, this.detail.tube, def.swell) : undefined;
    const sampled = loop?.sampled ?? samplePath(def.pts, tube, this.detail.tube);
    const geo = loop?.geo ?? tubeGeometry(sampled, radius, tube ? def.flat ?? 1 : 1, this.detail.radial, tube ? def.swell : undefined);
    const mesh = addMesh(geo, tube ? def.material : 'plastic', false);
    const group = new Group();
    group.add(mesh);
    let head: Mesh | undefined;
    if (def.shape === 'arrow') {
      head = addMesh(new ConeGeometry(PATH_RADIUS * 3.4, 0.55, 20), 'plastic', false);
      if (fine) head.scale.setScalar(0.85);
      group.add(head);
    }
    node.obj = group;
    let length = 0;
    for (let i = 1; i < sampled.length; i++) length += Math.hypot(sampled[i]![0] - sampled[i - 1]![0], sampled[i]![1] - sampled[i - 1]![1], sampled[i]![2] - sampled[i - 1]![2]);
    // Closed loops are model geometry, even when thin; only open trailing cables
    // may stay outside the camera fit and the bounds that enable rendering.
    node.path = { geo, sampled, head, body: fine || (tube && (def.closed === true || radius >= 0.04 * length)) };
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
    node.obj.removeFromParent();
    if (node.join) {
      node.join.removeFromParent();
      node.join.geometry.dispose();
      (node.join.material as LineBasicMaterial).dispose();
    }
    for (const g of node.geometries) {
      const solidKey = this.solidKeys.get(g);
      const solid = solidKey && this.sharedSolids.get(solidKey);
      if (solid) {
        if (--solid.refs === 0) { this.sharedSolids.delete(solidKey!); this.solidKeys.delete(g); g.dispose(); }
        continue;
      }
      const key = this.edgeKeys.get(g);
      const shared = key && this.sharedEdges.get(key);
      if (shared) {
        if (--shared.refs === 0) { this.sharedEdges.delete(key!); this.edgeKeys.delete(g); g.dispose(); }
      } else g.dispose();
    }
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
        this.nodes.delete(key);
      }
    }
    // The camera fits the model at rest: a machine's pose and a part's pulse move parts about, and a camera that followed them would breathe.
    // So the parts' spheres are taken once with poses and pulses left out, then the frame is laid out as it really stands.
    if (frame.objects.some((o) => o.pose || o.pulse !== 0)) {
      layout(offsets, true);
      this.scene.updateMatrixWorld(true);
      this.restSpheres = this.partSpheres();
      this.sweepHulls = this.sweptHulls(frame, offsets, spreads);
      layout(offsets);
    }
    this.scene.updateMatrixWorld(true);
    if (!frame.objects.some((o) => o.pose || o.pulse !== 0)) {
      this.restSpheres = this.partSpheres();
      // Nothing is moving yet but something will be, later in this step: the camera is already fitted to it.
      this.sweepHulls = frame.ahead ? this.sweptHulls(frame, offsets, spreads) : [];
      if (!frame.ahead) this.sweepKey = '';
      else {
        layout(offsets);
        this.scene.updateMatrixWorld(true);
      }
    }
    // Connectors and streams are placed from where their parts now are; what hangs on a connector then needs its matrices again.
    updateAttached(this.nodes, frame, this.detail.radial, PATH_RADIUS);
    if (updateConnectors(this.nodes, frame, this.detail.radial)) this.scene.updateMatrixWorld(true);
    updateWaves(this.nodes, frame, this.detail.radial);
    updateStreams(this.nodes, frame);
    updateParticles(this.nodes, frame);
    updateForces(this.nodes, frame);
    this.scene.updateMatrixWorld(true);
    this.aim(frame, aspect, view, standBack);
    if (view) this.tidyTexts(view);
    // The person's Cut goes through the middle of the model from the side the camera looks from.
    this.cutaway.update(frame, this.nodes, this.scene, this.camera.getWorldDirection(new Vector3()).negate());
    this.placeShadow(frame);
    this.fitDepth(frame);
  }

  /** Fit depth to what is drawn, independently of the camera's framing/glide.
   * Fixed near/far planes can erase compact close-ups or enlarged models that
   * already fit the stage. Paths and posed parts must count even when they do
   * not participate in the resting model's framing. */
  private fitDepth(frame: Frame): void {
    let nearest = Infinity, positiveNearest = Infinity, furthest = -Infinity;
    const box = new Box3(), point = new Vector3();
    const include = (min: number, max: number, shadow: boolean): void => {
      furthest = Math.max(furthest, max);
      if (shadow) return; // The oversized receiver is not a surface near the model.
      nearest = Math.min(nearest, min);
      if (min > 0) positiveNearest = Math.min(positiveNearest, min);
    };
    const measure = (o: Object3D, shadow = false): void => {
      if (o instanceof Sprite) {
        // A billboard faces the camera: all its vertices have its centre depth.
        const depth = -o.getWorldPosition(point).applyMatrix4(this.camera.matrixWorldInverse).z;
        include(depth, depth, shadow);
        return;
      }
      if (!(o instanceof Mesh || o instanceof LineSegments)) return;
      if (o instanceof InstancedMesh) {
        if (!o.boundingBox) o.computeBoundingBox();
        if (!o.boundingBox) return;
        box.copy(o.boundingBox);
      } else {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        if (!o.geometry.boundingBox) return;
        box.copy(o.geometry.boundingBox);
      }
      if (box.isEmpty()) return;
      o.updateWorldMatrix(true, false);
      let min = Infinity, max = -Infinity;
      // Transform this drawable only, not hidden descendants or stencil caps.
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const depth = -point.set(x, y, z).applyMatrix4(o.matrixWorld).applyMatrix4(this.camera.matrixWorldInverse).z;
        min = Math.min(min, depth); max = Math.max(max, depth);
      }
      include(min, max, shadow);
    };
    this.content.traverseVisible(measure);
    if (this.floor.visible) measure(this.floor, true);
    if (this.blob?.visible) measure(this.blob, true);
    const usable = Number.isFinite(nearest) && Number.isFinite(furthest) && furthest > 0;
    // If geometry crosses the camera, some clipping is unavoidable. Use a small
    // fraction of the viewing distance, not an unrelated distant object's depth;
    // retain any separate, entirely forward piece closer than that fallback.
    const distance = this.camera.position.distanceTo(this.focusPoint(frame.camera.focus, point));
    const near = usable ? Math.max(1e-6, nearest > 0 ? nearest * 0.5 : Math.min(distance * 0.001, positiveNearest * 0.5)) : 0.3;
    const far = usable ? Math.max(near * 2, furthest * 1.1) : 1500;
    if (this.camera.near !== near || this.camera.far !== far) {
      this.camera.near = near; this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * An attached part pulled from where it sits assembled (the model's explode, the person's Explode control or a drag) shows a faint line back to the point it
   * attaches at, in its parent's space; assembled again, or let go with detach, there is none. Its own motion (a slide, a swing) is not a pulling apart.
   */
  private joinLine(node: Node, o: ObjectFrame, assembled: Vec3, placed: Vector3, rot: Vec3): void {
    const parent = o.parentKey !== null ? this.nodes.get(o.parentKey)?.obj : undefined;
    const apart = o.mount && parent ? Math.hypot(placed.x - assembled[0], placed.y - assembled[1], placed.z - assembled[2]) : 0;
    if (!o.mount || !parent || apart < 1e-3) {
      if (node.join) node.join.visible = false;
      return;
    }
    // Its own point, where it would be assembled and where it is now.
    const self = new Vector3(o.mount.self[0] * o.scale[0], o.mount.self[1] * o.scale[1], o.mount.self[2] * o.scale[2]).applyEuler(new Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'XYZ'));
    if (!node.join) {
      const line = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0x9fb4c8, transparent: true, opacity: 0.45, depthTest: false, toneMapped: false }));
      line.renderOrder = 998;
      line.frustumCulled = false;
      node.join = line;
    }
    const line = node.join;
    if (line.parent !== parent) parent.add(line);
    line.geometry.setFromPoints([new Vector3(assembled[0], assembled[1], assembled[2]).add(self), placed.clone().add(self)]);
    (line.material as LineBasicMaterial).opacity = 0.45 * Math.min(1, node.alpha);
    line.visible = node.obj.visible;
  }

  /** Where a part stands and how big it is: its own values, or a machine's pose in their place; swell is what a pulse loop multiplies its scale by. */
  private place(node: Node, o: ObjectFrame, parentSpread: number, offset: Vec3 | undefined, pose: Pose | undefined, swell: Vec3 | undefined, grow: number): void {
    const at = spreadPosition(pose?.pos ?? o.pos, (o.def as { explode?: Vec3 }).explode, parentSpread);
    const rot = pose?.rot ?? o.rot;
    node.obj.position.set(at[0] + (offset?.[0] ?? 0), at[1] + (offset?.[1] ?? 0), at[2] + (offset?.[2] ?? 0));
    node.obj.rotation.copy(new Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'XYZ'));
    const loop = swell ?? [1, 1, 1];
    node.obj.scale.set(node.baseScale.x * o.scale[0] * loop[0] * grow, node.baseScale.y * o.scale[1] * loop[1] * grow, node.baseScale.z * o.scale[2] * loop[2] * grow);
  }

  private apply(node: Node, o: ObjectFrame, parentSpread: number, offset?: Vec3, rest = false): void {
    const pulse = rest ? 0 : o.pulse;
    const pose = rest ? undefined : o.pose;
    const grow = 1 + 0.07 * pulse;
    // Spread by the model's own explode, then by the person's control; a machine's pose stands in for the rest values.
    const rot = pose?.rot ?? o.rot;
    this.place(node, o, parentSpread, offset, pose, o.pose?.scale, grow); // a pulse loop swells it on top of its own scale
    if (!node.anchorsFrom || node.anchorsFrom.def !== o.def || node.anchorsFrom.points !== o.points) {
      node.anchors = anchorsOf(o.points ? { ...o.def, points: o.points } : o.def);
      node.anchorsFrom = { def: o.def, points: o.points };
    }
    this.joinLine(node, o, pose?.pos ?? o.pos, node.obj.position, rot);
    const alpha = Math.max(0, Math.min(1, (o.pose?.opacity ?? o.opacity) * o.appear * o.fade));
    node.obj.visible = alpha > 0.003;
    node.alpha = alpha;
    node.color = o.color;
    // A path's endpoints can hold its fade. Classify its material only after that
    // factor is known, not once as solid here and again as translucent each frame.
    const heldOpacity = o.def.shape === 'connector' ||
      ((o.def.shape === 'tube' || o.def.shape === 'line') && !!o.def.attach);
    const dark: Rgb = [o.color[0] * 0.22, o.color[1] * 0.22, o.color[2] * 0.22];
    for (const p of node.pieces) {
      const rgb = p.tint ? o.color : p.color ?? o.color;
      if (p.surface) applySurface(p.surface, rgb, alpha, pulse, o.pulseColor, heldOpacity);
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
        head.position.set(p[0], p[1], p[2]).addScaledVector(d, -0.2 * head.scale.y);
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
    // A sweep may reach the screen's edge, not only the stage's: how much wider than the stage that is, each way, from the stage's middle.
    const room = { x: 1, y: 1 };
    if (view) {
      const cx = view.rect.x + view.rect.w / 2, cy = view.rect.y + view.rect.h / 2;
      room.x = Math.max(1, (0.96 * Math.min(cx, view.width - cx)) / (view.rect.w / 2));
      room.y = Math.max(1, (0.96 * Math.min(cy, view.height - cy)) / (view.rect.h / 2));
    }
    const fit = this.eased(this.fitTarget(az, el, tan, aspect, room), view?.now);
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
      if (!node.obj.visible || node.obj instanceof Sprite || node.pieces.length === 0 || (node.path && !node.path.body) || node.stream || node.particles || node.force) continue;
      for (const p of node.pieces) {
        const mesh = p.object as Mesh;
        const geo = mesh.geometry;
        if (!geo) continue;
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
   * The parts' spheres and boxes at each of the poses a running machine takes over its cycle: the camera fits the stage to all of them with the rest ones, so
   * a part that swings out of its rest shape does not leave the stage. Taken again only when the parts or the machine change (a part appears, moves, or
   * a loop or joint is written), never as the machine runs, so the camera stands still over the cycle.
   */
  private sweptHulls(frame: Frame, offsets: Map<number, Vec3> | undefined, spreads: ReadonlyMap<number, number>): PartHull[] {
    const q = (v: readonly number[], k: number): string => v.map((x) => Math.round(x * k)).join(',');
    const m = frame.ahead ?? frame.motion;
    const key = frame.objects.map((o) => `${o.key}:${o.parentKey}:${q(o.pos, 4)}:${q(o.rot, 1)}:${q(o.scale, 4)}:${o.opacity * o.appear * o.fade > 0.003 ? 1 : 0}`).join('|')
      + '#' + JSON.stringify([m.cranks, m.cams, m.loops, m.joints, m.couples, m.muscles, m.spins.map((s) => [s.key, s.axis, s.rate !== 0, s.lock ?? null])]);
    if (key === this.sweepKey) return this.sweepHulls;
    this.sweepKey = key;
    const hulls: PartHull[] = [];
    for (const set of sweptPoses(frame)) {
      for (const o of frame.objects) {
        const node = this.nodes.get(o.key);
        if (!node) continue;
        const pose = set.get(o.key);
        this.place(node, o, o.parentKey !== null ? spreads.get(o.parentKey) ?? 0 : 0, offsets?.get(o.key), pose, pose?.scale, 1);
      }
      this.scene.updateMatrixWorld(true);
      hulls.push(...this.partSpheres());
    }
    return hulls;
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
        if (!(mesh instanceof InstancedMesh) && mesh.geometry) {
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
   * Where everything drawn is on screen: the box of every visible mesh, line or sprite, including the actual shadow receiver and blob,
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
      if (!((o as Mesh).isMesh || (o as LineSegments).isLineSegments || (o as Sprite).isSprite)) return;
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
  private fitTarget(az: number, el: number, tan: number, aspect: number, room = { x: 1, y: 1 }): { center: Vector3; radius: number } | undefined {
    const groups: Array<[PartHull[], number, number]> = [[this.restSpheres, 1, 1], [this.sweepHulls, room.x, room.y]];
    if (this.restSpheres.length === 0) return undefined;
    const lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const [parts] of groups) for (const p of parts) for (const c of p.corners) { lo.min(c); hi.max(c); }
    const center = lo.add(hi).multiplyScalar(0.5);
    const toCam = new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    const right = new Vector3().crossVectors(new Vector3(0, 1, 0), toCam);
    if (right.lengthSq() < 1e-9) right.set(1, 0, 0);
    right.normalize();
    const up = new Vector3().crossVectors(toCam, right).normalize();
    const rel = new Vector3();
    let dist = 0;
    for (const [parts, sx, sy] of groups) for (const { sphere: s, corners } of parts) {
      const tanY = tan * sy, tanX = tan * aspect * sx;
      const kx = Math.sqrt(1 + tanX * tanX), ky = Math.sqrt(1 + tanY * tanY);
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
    let biggest = 0, solidity = 1, smallestRadius = Infinity;
    for (const node of this.nodes.values()) {
      if (!node.obj.visible || node.obj instanceof Sprite || node.pieces.length === 0 || (node.path && !node.path.body) || node.stream) continue;
      const b = new Box3().setFromObject(node.obj);
      if (!b.isEmpty()) {
        this.box.union(b);
        this.hasBox = true;
        const sz = b.getSize(new Vector3());
        smallestRadius = Math.min(smallestRadius, sz.length() / 2);
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
    const radius = Math.max(size.length() / 2, 1e-9);
    const floorY = this.box.min.y - 0.03 * Math.max(size.x, size.y, size.z);
    const dir = new Vector3(-0.16, 1, 0.3).normalize();
    // The receiver must cover the caster's projection along the light, not a
    // square around its feet: a tall narrow part can throw a long shadow.
    const footprint = new Box3();
    for (const x of [this.box.min.x, this.box.max.x]) for (const y of [this.box.min.y, this.box.max.y]) for (const z of [this.box.min.z, this.box.max.z]) {
      footprint.expandByPoint(new Vector3(x, y, z).addScaledVector(dir, (floorY - y) / dir.y));
    }
    const receiverSize = footprint.getSize(new Vector3());
    const receiverCentre = footprint.getCenter(new Vector3());
    // Leave room for the shadow-map filter around the projected silhouette.
    const padding = radius * 0.1;
    this.floor.position.set(receiverCentre.x, floorY, receiverCentre.z);
    this.floor.scale.set(receiverSize.x + 2 * padding, 1, receiverSize.z + 2 * padding);
    (this.floor.material as ShadowMaterial).opacity = 0.24 * presence * weight;
    if (this.blob && this.blobMaterial) {
      this.blob.position.set(centre.x, floorY + radius * 0.002, centre.z);
      // All distances follow the model's scale. Fixed padding overwhelms a
      // compact model even though the camera has already framed its geometry.
      this.blob.scale.set(size.x * 1.15, 1, size.z * 1.15);
      this.blobMaterial.opacity = 0.36 * presence * weight;
    }
    // One light serves the whole assembly. A distant part must not push a
    // local surface's lookup through its neighbour and erase their shadow.
    this.light.shadow.normalBias = Math.min(radius, smallestRadius) * 0.02;
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
    const hidden = () => {
      if (!this.pinWarnings.has(key) && this.pinWarnings.size < 128) { this.pinWarnings.add(key); console.warn(`talkthrough: pin target ${key} has no visible surface`); }
      return { x: 0, y: 0, visible: false };
    };
    if (!node) { hidden(); return undefined; }
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
    for (const other of this.nodes.values()) {
      if (!isVisible(other.obj) || other.alpha <= 0.003) continue;
      const belongs = other === node || isAncestor(node.obj, other.obj);
      for (const part of other.pieces) {
        if (!(part.object instanceof Mesh) || !isVisible(part.object) || !part.surface || part.surface.opacity <= 0.003) continue;
        if (belongs) target.push(part.object);
        else if (part.surface.opacity >= 0.98) occluders.push(part.object);
      }
    }
    if (!target.length) return hidden();
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
          for (let j = 0; j < 3; j++) v.add(new Vector3().fromBufferAttribute(pos, index ? index.getX(tri * 3 + j) : tri * 3 + j));
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
    const forward = this.camera.getWorldDirection(new Vector3());
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
      // Camera clipping is axial depth; Raycaster limits are distance along
      // this oblique ray, including paths that extend outside the fitted stage.
      const axial = ray.ray.direction.dot(forward);
      ray.near = this.camera.near / axial;
      ray.far = this.camera.far / axial;
      const hit = ray.intersectObjects(target, false).find(allowed);
      if (!hit) continue;
      const blocker = ray.intersectObjects(occluders, false).find(allowed);
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
        try { beyond = reverse.intersectObjects(target, false).some(allowed); }
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
    let x0 = model.x, y0 = model.y;
    let x1 = model.x + model.w, y1 = model.y + model.h;
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
