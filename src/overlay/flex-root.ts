import { Matrix3, Matrix4, Mesh, Ray, Vector3 } from 'three';

/** Root intersection is against this one caller-validated rigid parent, never another object. */
export function projectRoot(parent: Mesh, seam: readonly Vector3[], flexToParent: Matrix4, parentPoint: Vector3, parentNormal: Vector3, maxGap: number): Vector3[] {
  if (seam.length !== 7 || !Number.isFinite(maxGap) || maxGap < .01 || maxGap > .15 || parentNormal.lengthSq() < 1e-16) throw Error('invalid root');
  const scale=new Vector3().setFromMatrixScale(parent.matrixWorld);
  if (!(scale.x > 0 && scale.y > 0 && scale.z > 0) || Math.max(scale.x,scale.y,scale.z)-Math.min(scale.x,scale.y,scale.z)>1e-4 || parent.matrixWorld.determinant() <= 0) throw Error('unsupported parent scale');
  const middle=seam[3]!.clone().applyMatrix4(flexToParent);
  if(middle.distanceTo(parentPoint)>.001) throw Error('root point mismatch');
  const normal=parentNormal.clone().normalize().applyMatrix3(new Matrix3().getNormalMatrix(parent.matrixWorld)).normalize();
  const positions=parent.geometry.getAttribute('position'), indices=parent.geometry.getIndex();
  if(!positions || (indices?.count ?? positions.count)%3 !== 0) throw Error('invalid parent mesh');
  const inverse=new Matrix4().copy(parent.matrixWorld).multiply(flexToParent).invert();
  const a=new Vector3(),b=new Vector3(),c=new Vector3(),hit=new Vector3();
  const out: Vector3[]=[];
  for(const point of seam) {
    const origin=point.clone().applyMatrix4(flexToParent).applyMatrix4(parent.matrixWorld), ray=new Ray(origin,normal), hits:Vector3[]=[];
    const count=indices?.count ?? positions.count;
    for(let i=0;i<count;i+=3){
      const ia=indices?indices.getX(i):i,ib=indices?indices.getX(i+1):i+1,ic=indices?indices.getX(i+2):i+2;
      a.fromBufferAttribute(positions,ia).applyMatrix4(parent.matrixWorld);b.fromBufferAttribute(positions,ib).applyMatrix4(parent.matrixWorld);c.fromBufferAttribute(positions,ic).applyMatrix4(parent.matrixWorld);
      if(new Vector3().subVectors(b,a).cross(new Vector3().subVectors(c,a)).dot(normal)<=0)continue;
      if(!ray.intersectTriangle(a,b,c,false,hit))continue;
      const dist=origin.distanceTo(hit);
      if(dist > maxGap*scale.x+1e-8 || hits.some(p=>p.distanceTo(hit)<=1e-5))continue;
      hits.push(hit.clone());
    }
    hits.sort((x,y)=>origin.distanceToSquared(x)-origin.distanceToSquared(y));
    if(!hits.length || (hits.length>1 && Math.abs(origin.distanceTo(hits[0]!)-origin.distanceTo(hits[1]!))<=1e-5)) throw Error('root exit unavailable or ambiguous');
    out.push(hits[0]!.applyMatrix4(inverse));
  }
  return out;
}
