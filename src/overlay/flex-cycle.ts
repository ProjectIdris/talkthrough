import type { FlexCycle } from '../scene/flex-validate.ts';
import { periodicCurve, samplePeriodicCurve } from './flex-curve.ts';
const compiled=new WeakMap<FlexCycle,ReturnType<typeof periodicCurve>[]>();
export function flexPoseAt(cycle:FlexCycle, elapsed:number):{angles:number[];profile:number}|undefined {
  if (!Number.isFinite(elapsed) || elapsed<0) return;
  let curves=compiled.get(cycle);
  if(!curves){const times=cycle.keys.map(k=>k.t);curves=cycle.keys[0]!.angles.map((_,i)=>periodicCurve(times,cycle.keys.map(k=>k.angles[i]!)));curves.push(periodicCurve(times,cycle.keys.map(k=>k.profile)));compiled.set(cycle,curves);}
  const phase=elapsed/cycle.period+cycle.phase, values=curves.map(c=>samplePeriodicCurve(c,phase));
  return {angles:values.slice(0,-1),profile:values.at(-1)!};
}
