type Vec = [number,number,number];
type Joint = {id:string;u:number;offset:Vec;axis:Vec;min:number;max:number};
type Section = {u:number;center:Vec;chord:Vec;halfWidth:number;camber:number;profileDelta:number};
export type FlexDefinition={mirror:'none'|'localX';root:{parentPoint:Vec;normal:Vec;maxGap:number};joints:Joint[];sections:Section[]};
export type FlexCycle={period:number;phase:number;keys:{t:number;angles:number[];profile:number}[]};
const data=(o:unknown,k:string):unknown=>{if(typeof o!=='object'||o===null)return undefined;const d=Object.getOwnPropertyDescriptor(o,k);return d&&'value' in d?d.value:undefined;};
const num=(v:unknown,lo:number,hi:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi;
const vector=(v:unknown):Vec|undefined=>{if(!Array.isArray(v)||data(v,'length')!==3)return;const a=[data(v,'0'),data(v,'1'),data(v,'2')];if(!a.every(x=>num(x,-100,100)))return;return a as Vec;};
const array=(v:unknown,min:number,max:number):unknown[]|undefined=>{if(!Array.isArray(v))return;const length=data(v,'length');if(typeof length!=='number'||length<min||length>max)return;const a=[];for(let i=0;i<length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!('value' in d))return;a.push(d.value);}return a;};
const length=(v:Vec)=>Math.hypot(...v);
export function parseFlexDefinition(raw:unknown):FlexDefinition|undefined {
 try {
  const mirror=data(raw,'mirror')??'none',root=data(raw,'root'),parentPoint=vector(data(root,'parentPoint')),normal=vector(data(root,'normal')),maxGap=data(root,'maxGap');
  const j=array(data(raw,'joints'),2,6),s=array(data(raw,'sections'),3,8);
  if((mirror!=='none'&&mirror!=='localX')||!parentPoint||!normal||length(normal)<1e-8||!num(maxGap,.01,.15)||!j||!s)return;
  const joints:Joint[]=[],sections:Section[]=[], ids=new Set<string>();
  for(const x of j){const id=data(x,'id'),u=data(x,'u'),offset=vector(data(x,'offset')),axis=vector(data(x,'axis')),min=data(x,'min'),max=data(x,'max');
    if(typeof id!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(id)||ids.has(id)||!num(u,0,1)||!offset||length(offset)>.25||!axis||length(axis)<1e-8||!num(min,-180,180)||!num(max,-180,180)||min>max||(joints.length&&u<=joints.at(-1)!.u))return;
    ids.add(id);joints.push({id,u,offset,axis,min,max});
  }
  for(const x of s){const u=data(x,'u'),center=vector(data(x,'center')),chord=vector(data(x,'chord')),halfWidth=data(x,'halfWidth'),camber=data(x,'camber'),profileDelta=data(x,'profileDelta');
    if(!num(u,0,1)||!center||!chord||length(chord)<1e-8||!num(halfWidth,.05,10)||!num(camber,-halfWidth/2,halfWidth/2)||!num(profileDelta,-halfWidth/2,halfWidth/2)||(sections.length&&(u<=sections.at(-1)!.u||Math.hypot(...center.map((n,i)=>n-sections.at(-1)!.center[i]!))<.05)))return;
    sections.push({u,center,chord,halfWidth,camber,profileDelta});
  }
  if(joints[0]!.u!==0||joints.at(-1)!.u!==1||sections[0]!.u!==0||sections.at(-1)!.u!==1)return;
  return {mirror,root:{parentPoint,normal,maxGap},joints,sections};
 }catch{return;}
}
export function parseFlexCycle(raw:unknown,def:FlexDefinition):FlexCycle|undefined {
 try {
  const period=data(raw,'period'),phase=data(raw,'phase')??0,rawKeys=array(data(raw,'keys'),3,8);
  if(!num(period,.05,12)||!num(phase,0,1)||phase===1||!rawKeys)return;
  const keys:FlexCycle['keys']=[];
  for(const key of rawKeys){const t=data(key,'t'),profile=data(key,'profile'),angles=array(data(key,'angles'),def.joints.length,def.joints.length);
    if(!num(t,0,1)||!num(profile,0,1)||!angles||!angles.every((a,i)=>num(a,def.joints[i]!.min,def.joints[i]!.max))||(keys.length&&t<=keys.at(-1)!.t))return;
    keys.push({t,profile,angles:angles as number[]});
  }
  const first=keys[0]!,last=keys.at(-1)!;
  if(first.t!==0||last.t!==1||first.profile!==last.profile||first.angles.some((a,i)=>a!==last.angles[i]))return;
  return {period,phase,keys};
 }catch{return;}
}
