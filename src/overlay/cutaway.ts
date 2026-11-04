// Cutting a model open: clipping planes on the surfaces of what is cut, and a cap on each cut face so a solid part
// looks solid inside (an engine block cut through shows its bore, a piston its section) and not like an empty shell.
//
// The planes are three.js clipping planes (points on the negative side of a plane are removed), shared by every
// material they cut. The caps are the usual stencil trick, once for each closed part: the part drawn back faces
// first adds one to the stencil, its front faces take one away, and what is left (inside the part) is where a cap
// is drawn on the plane. Each part's three draws are kept together in the draw order so their stencil does not mix.
//
// Two things cut: an object's own `cut` (its whole subtree), and the person's Cut control (everything, through the middle
// of the model, from the front). Both can act at once; a part clipped by two planes is capped on each.

import {
  BackSide, Box3, DecrementWrapStencilOp, DoubleSide, FrontSide, IncrementWrapStencilOp, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, NotEqualStencilFunc, AlwaysStencilFunc, PlaneGeometry, Plane, ReplaceStencilOp, Vector3,
} from 'three';
import type { Material, Object3D, StencilOp } from 'three';
import type { Frame } from './timeline.ts';

/** What the cutting needs to know of a drawn object: its three.js root, its meshes, and how it looks just now. */
export type CutPiece = {
  object: Object3D;
  surface: Material | undefined;
  lines: { material: Material | Material[] } | undefined;
  /** A closed part, which can have a cap: the stencil count only means something for a closed surface. */
  closed: boolean;
};
export type CutNode = {
  obj: Object3D;
  pieces: CutPiece[];
  alpha: number;
  color: [number, number, number];
};

type PieceState = {
  side: number;
  helpers: Array<{ back: Mesh; front: Mesh; cap: Mesh; plane: Plane }>;
};

/** Cap faces get a plain matte tone from the part's own colour, a little paler, so the cut reads as a section. */
function capTone(rgb: readonly number[], out: MeshStandardMaterial): void {
  out.color.setRGB(Math.min(1, rgb[0]! / 255 * 0.8 + 0.2), Math.min(1, rgb[1]! / 255 * 0.8 + 0.2), Math.min(1, rgb[2]! / 255 * 0.8 + 0.2), 'srgb');
}

export class Cutaway {
  private states = new WeakMap<Object3D, PieceState>();
  private ownerPlanes = new Map<number, Plane>();
  private userPlane = new Plane();
  private order = 3000;
  private box = new Box3();
  private slab = new PlaneGeometry(1, 1);

  /**
   * Brings the clipping planes and caps in line with a frame. `nodes` are the drawn objects by key (the same keys as
   * the frame's objects); `content` holds them all.
   */
  update(frame: Frame, nodes: ReadonlyMap<number, CutNode>, host: Object3D): void {
    const children = new Map<number, number[]>();
    for (const o of frame.objects) if (o.parentKey !== null) children.set(o.parentKey, [...(children.get(o.parentKey) ?? []), o.key]);

    const planesFor = new Map<number, Plane[]>();
    const give = (key: number, plane: Plane): void => {
      planesFor.set(key, [...(planesFor.get(key) ?? []), plane]);
      for (const child of children.get(key) ?? []) give(child, plane);
    };
    // The person's cut first: through the middle of the model from the front, a little more of it each step of the control.
    const user = frame.userCut ?? 0;
    let radius = 10;
    if (user > 0 || frame.objects.some((o) => o.cut)) {
      this.box.makeEmpty();
      for (const node of nodes.values()) if (node.obj.visible) this.box.expandByObject(node.obj);
      if (!this.box.isEmpty()) radius = Math.max(1, this.box.getSize(new Vector3()).length());
    }
    if (user > 0 && !this.box.isEmpty()) {
      const front = this.box.max.z + 0.01, middle = (this.box.min.z + this.box.max.z) / 2;
      this.userPlane.set(new Vector3(0, 0, -1), front - (front - middle) * Math.min(1, user));
      for (const o of frame.objects) if (o.parentKey === null) give(o.key, this.userPlane);
    }
    const live = new Set<number>();
    for (const o of frame.objects) {
      if (!o.cut) continue;
      const node = nodes.get(o.key);
      if (!node) continue;
      live.add(o.key);
      let plane = this.ownerPlanes.get(o.key);
      if (!plane) {
        plane = new Plane();
        this.ownerPlanes.set(o.key, plane);
      }
      // The object's own axis, turned the way the object is turned; the removed side is the +axis side.
      node.obj.updateWorldMatrix(true, false);
      const axis = new Vector3(o.cut.axis === 0 ? 1 : 0, o.cut.axis === 1 ? 1 : 0, o.cut.axis === 2 ? 1 : 0);
      const at = axis.clone().multiplyScalar(o.cut.at);
      node.obj.localToWorld(at);
      const normal = axis.transformDirection(node.obj.matrixWorld).negate();
      plane.setFromNormalAndCoplanarPoint(normal, at);
      give(o.key, plane);
    }
    for (const key of [...this.ownerPlanes.keys()]) if (!live.has(key)) this.ownerPlanes.delete(key);

    this.order = 3000;
    for (const [key, node] of nodes) this.apply(node, planesFor.get(key) ?? [], host, radius);
  }

  private apply(node: CutNode, planes: Plane[], host: Object3D, radius: number): void {
    for (const p of node.pieces) {
      const mesh = p.object as Mesh;
      const material = p.surface;
      if (!material || !(mesh as { isMesh?: boolean }).isMesh) continue;
      let state = this.states.get(mesh);
      if (planes.length === 0) {
        if (state) {
          material.clippingPlanes = null;
          material.side = state.side as typeof FrontSide;
          if (p.lines) (p.lines.material as Material).clippingPlanes = null;
          for (const h of state.helpers) this.retire(h);
          this.states.delete(mesh);
        }
        continue;
      }
      if (!state) {
        state = { side: material.side, helpers: [] };
        this.states.set(mesh, state);
      }
      material.clippingPlanes = planes;
      material.clipShadows = true;
      material.side = DoubleSide;
      if (p.lines) (p.lines.material as Material).clippingPlanes = planes;
      const capped = p.closed && (material as { userData?: { base?: number } }).userData?.base === 1 && node.alpha >= 0.98 && node.obj.visible;
      // One helper set for each plane that cuts this part; spare ones are put away.
      while (state.helpers.length > planes.length) this.retire(state.helpers.pop()!);
      for (let i = 0; i < planes.length; i++) {
        let helper = state.helpers[i];
        if (!helper) {
          helper = this.helper(mesh, host);
          state.helpers.push(helper);
        }
        helper.plane = planes[i]!;
        const others = planes.filter((_, j) => j !== i);
        for (const m of [helper.back.material, helper.front.material] as MeshBasicMaterial[]) m.clippingPlanes = planes;
        (helper.cap.material as MeshStandardMaterial).clippingPlanes = others.length ? others : null;
        for (const h of [helper.back, helper.front, helper.cap]) h.visible = capped;
        if (!capped) continue;
        helper.back.renderOrder = this.order++;
        helper.front.renderOrder = this.order++;
        helper.cap.renderOrder = this.order++;
        capTone(node.color, helper.cap.material as MeshStandardMaterial);
        // The cap lies on the plane, large enough to cover the part, facing along it.
        const cap = helper.cap;
        const plane = helper.plane;
        const point = plane.coplanarPoint(new Vector3());
        cap.position.copy(point);
        cap.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), plane.normal);
        cap.scale.setScalar(radius * 2);
      }
    }
  }

  private helper(mesh: Mesh, host: Object3D): PieceState['helpers'][number] {
    const stencil = (side: number, op: StencilOp): MeshBasicMaterial => new MeshBasicMaterial({
      side: side as typeof FrontSide, colorWrite: false, depthWrite: false, depthTest: false, stencilWrite: true, stencilFunc: AlwaysStencilFunc,
      stencilFail: op, stencilZFail: op, stencilZPass: op,
    });
    const back = new Mesh(mesh.geometry, stencil(BackSide, IncrementWrapStencilOp));
    const front = new Mesh(mesh.geometry, stencil(FrontSide, DecrementWrapStencilOp));
    const capMaterial = new MeshStandardMaterial({
      side: DoubleSide, roughness: 0.82, metalness: 0.02, stencilWrite: true, stencilRef: 0, stencilFunc: NotEqualStencilFunc,
      stencilFail: ReplaceStencilOp, stencilZFail: ReplaceStencilOp, stencilZPass: ReplaceStencilOp,
    });
    const cap = new Mesh(this.slab, capMaterial);
    for (const m of [back, front, cap]) {
      m.castShadow = false;
      m.receiveShadow = false;
      m.matrixAutoUpdate = true;
    }
    mesh.add(back, front);
    host.add(cap);
    return { back, front, cap, plane: new Plane() };
  }

  private retire(h: PieceState['helpers'][number]): void {
    h.back.removeFromParent();
    h.front.removeFromParent();
    h.cap.removeFromParent();
    (h.back.material as Material).dispose();
    (h.front.material as Material).dispose();
    (h.cap.material as Material).dispose();
  }

  /** A drawn object is going: put its caps away (they hang from the scene, not from it). */
  release(node: CutNode): void {
    for (const p of node.pieces) {
      const state = this.states.get(p.object);
      if (!state) continue;
      for (const h of state.helpers) this.retire(h);
      this.states.delete(p.object);
    }
  }

  dispose(): void {
    this.slab.dispose();
  }
}

