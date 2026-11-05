import { Mesh, Raycaster, Vector2 } from 'three';
import { flexPickObject } from './flex-pick-proxy.ts';
import { rayCandidates } from './flex-pick-budget.ts';
import type { Camera, Intersection, Material, Object3D } from 'three';
import type { FlexPickBudget } from './flex-pick-budget.ts';
import { overModel } from './orbit.ts';
import type { Rect } from './timeline.ts';

function hierarchyVisible(object:Object3D):boolean { for(let p:Object3D|null=object;p;p=p.parent)if(!p.visible)return false;return true; }

/** An unknown posed mesh must not be treated as empty background. */
export function hasUnknownFlexPick(objects:readonly Object3D[]):boolean {
 let unknown=false;const seen=new Set<Object3D>();
 for(const root of objects) root.traverse(object=>{if(seen.has(object))return;seen.add(object);if(object instanceof Mesh && hierarchyVisible(object) && !flexPickObject(object))unknown=true;});
 return unknown;
}

/** Stale geometry is unknown even when the last screen bounds do not cover the point. */
export function hitModelRegion(objects:readonly Object3D[],camera:Camera,rect:Rect|undefined,width:number,height:number,x:number,y:number,budget?:FlexPickBudget):'hit'|'miss'|'unknown' {
 if(budget && hasUnknownFlexPick(objects))return 'unknown';
 if(!overModel(rect,x,y))return 'miss';
 return hitVisibleModel(objects,camera,width,height,x,y,budget)?'hit':'miss';
}

/** Ray-test drawn model objects; projected bounds alone include empty holes. */
export function hitVisibleModel(objects: readonly Object3D[], camera: Camera, width: number, height: number, x: number, y: number, budget?: FlexPickBudget): boolean {
  if (width <= 0 || height <= 0 || x < 0 || y < 0 || x > width || y > height) return false;
  const seen=new Set<Object3D>(), hits:Object3D[]=[];let unknown=false;
  for(const root of objects) root.traverse(object=>{if(seen.has(object))return;seen.add(object);const pick=object instanceof Mesh?flexPickObject(object):object;if(pick)hits.push(pick);else if(hierarchyVisible(object))unknown=true;});
  if(unknown)return true;
  const ray = new Raycaster();
  ray.params.Line.threshold = 0.02;
  ray.setFromCamera(new Vector2(x / width * 2 - 1, 1 - y / height * 2), camera);
  const candidates=rayCandidates(hits,ray);
  // An exhausted frame cannot safely classify a possible hit as background.
  if (budget && !budget.ray(candidates)) return true;
  return ray.intersectObjects(candidates, false).some(visibleHit);
}

function visibleHit(hit: Intersection): boolean {
  for (let object: Object3D | null = hit.object; object; object = object.parent) if (!object.visible) return false;
  const material = (hit.object as Object3D & { material?: Material | Material[] }).material;
  const materials = Array.isArray(material) ? material : material ? [material] : [];
  return materials.some((m) => m.visible && m.opacity > 0.02 && !(m.clippingPlanes ?? []).some((p) => p.distanceToPoint(hit.point) < -1e-6));
}
