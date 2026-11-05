import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFlexGeometry } from '../src/overlay/flex-geometry.ts';
import { sampleFrames } from '../src/overlay/flex-frames.ts';
const sections = [
  { u: 0, center: [0,0,0], chord:[0,0,1], halfWidth:.2, camber:.02, profileDelta:.01 },
  { u: .5, center: [1,0,0], chord:[0,0,1], halfWidth:.5, camber:.04, profileDelta:.02 },
  { u: 1, center: [2,0,0], chord:[0,0,1], halfWidth:.2, camber:.02, profileDelta:.01 },
] as const;
test('closed mesh has pinned shared seam, bounded size, and valid skin weights', () => {
  const frames = sampleFrames(sections);
  const seam = Array.from({length:7}, (_,j) => frames[0]!.center.clone().addScaledVector(frames[0]!.chord,(2*j/6-1)*.2));
  const geo = buildFlexGeometry(frames, [0,.5,1], seam, false);
  assert.equal(geo.getAttribute('position').count, 343);
  assert.ok(geo.index!.count / 3 <= 688);
  const morph = geo.morphAttributes.position![0]!;
  for(let i=0;i<7;i++) assert.equal(morph.getX(i)**2+morph.getY(i)**2+morph.getZ(i)**2, 0);
  const weights=geo.getAttribute('skinWeight');
  for(let i=0;i<weights.count;i++) assert.ok(Math.abs(weights.getX(i)+weights.getY(i)-1)<1e-6);
  geo.dispose();
});

test('local X reflection reverses winding while preserving skin and seam geometry', () => {
  const frames=sampleFrames(sections);
  const seam=Array.from({length:7},(_,j)=>frames[0]!.center.clone().addScaledVector(frames[0]!.chord,(2*j/6-1)*.2));
  const a=buildFlexGeometry(frames,[0,.5,1],seam,false), b=buildFlexGeometry(frames,[0,.5,1],seam,true);
  const pa=a.getAttribute('position'),pb=b.getAttribute('position');
  for(let i=0;i<pa.count;i++) { assert.equal(pb.getX(i),-pa.getX(i)); assert.equal(pb.getY(i),pa.getY(i)); assert.equal(pb.getZ(i),pa.getZ(i)); }
  for(let i=0;i<a.index!.count;i+=3){assert.equal(a.index!.getX(i),b.index!.getX(i)); assert.equal(a.index!.getX(i+1),b.index!.getX(i+2)); assert.equal(a.index!.getX(i+2),b.index!.getX(i+1));}
  a.dispose();b.dispose();
});

test('front winding follows chord cross tangent',()=>{
 const f=sampleFrames(sections), seam=Array.from({length:7},(_,j)=>f[0]!.center.clone().addScaledVector(f[0]!.chord,(2*j/6-1)*.2));
 const g=buildFlexGeometry(f,[0,.5,1],seam,false),p=g.getAttribute('position'), ix=g.index!;
 const vector=(n:number)=>f[0]!.center.clone().fromBufferAttribute(p,ix.getX(n));
 const a=vector(0),b=vector(1),c=vector(2),normal=b.sub(a).cross(c.sub(a)).normalize();
 assert.ok(normal.dot(f[1]!.normal)>.9);g.dispose();
});

test('profile morph provides changing normals for the curved surface',()=>{
 const f=sampleFrames(sections),seam=Array.from({length:7},(_,j)=>f[0]!.center.clone().addScaledVector(f[0]!.chord,(2*j/6-1)*.2)),g=buildFlexGeometry(f,[0,.5,1],seam,false);const normal=g.morphAttributes.normal?.[0];assert.ok(normal,'morph must update shading normals');let magnitude=0;for(let i=0;i<normal.count;i++)magnitude+=Math.abs(normal.getX(i))+Math.abs(normal.getY(i))+Math.abs(normal.getZ(i));assert.ok(magnitude>1e-4);g.dispose();
});
