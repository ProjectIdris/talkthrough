import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Scene } from '../src/scene/types.ts';
import { DiagramPainter } from '../src/overlay/diagram-draw.ts';
import type { Px } from '../src/overlay/diagram-layout.ts';
import { emptyFrame, planStep, settle } from '../src/overlay/timeline.ts';

/** Record the actual rounded rectangles painted by DiagramPainter, not its intended layout. */
function canvasGeometry() {
  const nodes: Px[] = [], labels: Px[] = [];
  const edges: Array<Array<{ x: number; y: number }>> = [];
  let points: Array<{ x: number; y: number }> = [];
  const state: Record<string, unknown> = { font: '10px sans-serif' };
  const stack: Array<Record<string, unknown>> = [];
  let corners: number[][] = [];
  const ctx = new Proxy(state, {
    get(t, k: string) {
      if (k === 'save') return () => stack.push({ ...t });
      if (k === 'restore') return () => Object.assign(t, stack.pop());
      if (k === 'beginPath') return () => { corners = []; points = []; };
      if (k === 'moveTo' || k === 'lineTo') return (x: number, y: number) => points.push({ x, y });
      if (k === 'stroke') return () => { if (t.lineWidth === 2.3) edges.push([...points]); };
      if (k === 'arcTo') return (...args: number[]) => corners.push(args);
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return (s: string) => ({ width: s.length * Number(/([\d.]+)px/.exec(String(t.font))?.[1] ?? 10) * 0.52 });
      if (k === 'fill') return () => {
        if (corners.length !== 4) return;
        const [a, b, c] = corners as [number[], number[], number[], number[]];
        const box = { x: c[0]!, y: a[1]!, w: a[0]! - c[0]!, h: b[1]! - a[1]! };
        if (t.fillStyle === 'rgba(14,19,31,0.9)') nodes.push(box);
        if (t.fillStyle === 'rgba(19,25,39,0.97)') labels.push(box);
      };
      return k in t ? t[k] : () => undefined;
    },
    set(t, k: string, v) { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, nodes, labels, edges, clear() { nodes.length = labels.length = edges.length = 0; } };
}

const overlaps = (a: Px, b: Px): boolean =>
  Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) + 0.5 &&
  Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y) + 0.5;

const sample = JSON.parse(readFileSync(new URL('../samples/scenes/diagram-flow.json', import.meta.url), 'utf8')) as Scene;
const chain = settle(planStep(emptyFrame(), sample.steps[0]!));
const loop = settle(planStep(chain, sample.steps[1]!));

for (const [name, from, to] of [['adding a return edge', chain, loop], ['removing a return edge', loop, chain]] as const) {
  for (const [width, height] of [[800, 600], [960, 640], [1280, 800]] as const) {
    test(`flow reflow keeps labels and arrows clear of nodes when ${name} at ${width}x${height}`, () => {
      const g = canvasGeometry(), painter = new DiagramPainter();
      const view = { width, height, dpr: 1 };
      painter.draw(g.ctx, from.diagrams, view, 0);
      for (let frame = 1; frame <= 45; frame++) {
        g.clear();
        painter.draw(g.ctx, to.diagrams, view, frame * 1000 / 30);
        assert.equal(g.nodes.length, 4, 'all nodes remain visible');
        assert.equal(g.labels.length, to === loop ? 4 : 3, 'all edge labels remain visible');
        assert.equal(g.edges.length, g.labels.length, 'all arrows remain visible');
        for (const edge of g.edges) for (const p of edge) for (const b of g.nodes) assert.ok(!(p.x > b.x + 1 && p.x < b.x + b.w - 1 && p.y > b.y + 1 && p.y < b.y + b.h - 1), `arrow crosses a node at frame ${frame}`);
        for (let i = 0; i < g.labels.length; i++) for (let j = i + 1; j < g.labels.length; j++) assert.ok(!overlaps(g.labels[i]!, g.labels[j]!), `labels overlap at frame ${frame}`);
        for (const label of g.labels) for (const node of g.nodes) assert.ok(!overlaps(label, node), `label covers a node at frame ${frame}`);
        for (let i = 0; i < g.nodes.length; i++) for (let j = i + 1; j < g.nodes.length; j++) assert.ok(!overlaps(g.nodes[i]!, g.nodes[j]!), `nodes overlap at frame ${frame}`);
      }
    });
  }
}

test('adding a node that changes the wrapped row width does not mix old and new row assignments', () => {
  const make = (count: number) => settle(planStep(emptyFrame(), {
    say: 'A sequence', actions: [
      { op: 'diagram', id: 'sequence', kind: 'flow', x: 100, y: 100, w: 420, h: 450 },
      ...Array.from({ length: count }, (_, i) => ({ op: 'node', id: `n${i}`, of: 'sequence', text: `Step ${i + 1}` })),
      ...Array.from({ length: count - 1 }, (_, i) => ({ op: 'edge', id: `e${i}`, from: `n${i}`, to: `n${i + 1}` })),
    ],
  } as Scene['steps'][number]));
  const g = canvasGeometry(), painter = new DiagramPainter();
  const view = { width: 960, height: 640, dpr: 1 };
  painter.draw(g.ctx, make(6).diagrams, view, 0);
  const next = make(7);
  for (let frame = 1; frame <= 45; frame++) {
    g.clear();
    painter.draw(g.ctx, next.diagrams, view, frame * 1000 / 30);
    assert.equal(g.nodes.length, 7);
    for (let i = 0; i < g.nodes.length; i++) for (let j = i + 1; j < g.nodes.length; j++) assert.ok(!overlaps(g.nodes[i]!, g.nodes[j]!), `nodes ${i}/${j} overlap at frame ${frame}`);
  }
});

test('replacing edges that change layers keeps the first transition frame coherent', () => {
  const base=settle(planStep(emptyFrame(),{say:'',actions:[
    {op:'diagram',id:'d',kind:'flow',x:100,y:100,w:600,h:550},
    ...Array.from({length:5},(_,i)=>({op:'node',id:`n${i}`,of:'d',text:`Item ${i}`})),
    ...[[0,1],[0,2],[2,3],[3,4]].map(([a,b],i)=>({op:'edge',id:`e${i}`,from:`n${a}`,to:`n${b}`,text:`Link ${i}`})),
  ]} as Scene['steps'][number]));
  const next=settle(planStep(base,{say:'',actions:[{op:'clear',target:'e0'},{op:'clear',target:'e1'},
    {op:'edge',id:'e0',from:'n0',to:'n2',text:'Link 0'}, {op:'edge',id:'e1',from:'n1',to:'n2',text:'Link 1'}]} as Scene['steps'][number]));
  const g=canvasGeometry(),p=new DiagramPainter(),view={width:960,height:640,dpr:1};
  p.draw(g.ctx,base.diagrams,view,0);
  for(let i=1;i<=45;i++) {
    g.clear(); p.draw(g.ctx,next.diagrams,view,i*1000/30);
    for(const label of g.labels) for(const node of g.nodes) assert.ok(!overlaps(label,node),`label overlaps node at frame ${i}`);
  }
});

function flowWithEdges(pairs: number[][]) {
  return settle(planStep(emptyFrame(),{say:'',actions:[
    {op:'diagram',id:'d',kind:'flow',x:100,y:100,w:600,h:550},
    ...Array.from({length:5},(_,i)=>({op:'node',id:`n${i}`,of:'d',text:`Item ${i}`})),
    ...pairs.map(([a,b],i)=>({op:'edge',id:`e${i}`,from:`n${a}`,to:`n${b}`,text:`Link ${i}`})),
  ]} as Scene['steps'][number]));
}

test('edge addition, removal and reversal do not retain stale routing cache', () => {
  const a=flowWithEdges([[0,1],[0,2],[2,3],[3,4]]);
  const b=flowWithEdges([[0,1],[0,2],[1,2],[2,3],[3,4]]);
  const g=canvasGeometry(),p=new DiagramPainter(),view={width:960,height:640,dpr:1};
  p.draw(g.ctx,a.diagrams,view,0);
  let revision=(p as unknown as {flowRouting:Map<number,{revision:number}>}).flowRouting.get(a.diagrams[0]!.key)!.revision;
  for(let i=1;i<=20;i++) {
    g.clear();p.draw(g.ctx,(i%2?b:a).diagrams,view,i*1000/30);
    assert.equal(g.nodes.length,5);
    assert.equal(g.labels.length,i%2?5:4,'edge labels remain present through the reversal');
    const next=(p as unknown as {flowRouting:Map<number,{revision:number}>}).flowRouting.get(a.diagrams[0]!.key)!.revision;
    assert.equal(next,revision+1,'each graph slot change gets a fresh routing revision');
    revision=next;
  }
  p.draw(g.ctx,[],view,1000);
  assert.equal((p as unknown as {cur:Map<string,unknown>}).cur.size,0);
  assert.equal((p as unknown as {flowRouting:Map<number,unknown>}).flowRouting.size,0);
});

test('one flow topology change does not reset another diagram', () => {
  const a=flowWithEdges([[0,1],[0,2],[2,3],[3,4]]),b=flowWithEdges([[0,2],[1,2],[2,3],[3,4]]);
  const second=structuredClone(a.diagrams[0]!); second.key=999;
  const g=canvasGeometry(),p=new DiagramPainter(),view={width:960,height:640,dpr:1};
  p.draw(g.ctx,[a.diagrams[0]!,second],view,0);
  const before=[...(p as unknown as {cur:Map<string,unknown>}).cur.keys()].filter(k=>k.startsWith('999:')).sort();
  p.draw(g.ctx,[b.diagrams[0]!,second],view,33);
  const after=[...(p as unknown as {cur:Map<string,unknown>}).cur.keys()].filter(k=>k.startsWith('999:')).sort();
  assert.deepEqual(after,before);
});

test('reordered unchanged edges and a resized card retain ordinary easing', () => {
  const pairs=[[0,1],[0,2],[2,3],[3,4]];
  const a=flowWithEdges(pairs), b=flowWithEdges([...pairs].reverse());
  const g=canvasGeometry(),p=new DiagramPainter();
  p.draw(g.ctx,a.diagrams,{width:960,height:640,dpr:1},0);
  const before=[...(p as unknown as {cur:Map<string,unknown>}).cur.keys()];
  p.draw(g.ctx,b.diagrams,{width:1100,height:640,dpr:1},33);
  const after=[...(p as unknown as {cur:Map<string,unknown>}).cur.keys()];
  assert.deepEqual(after.sort(),before.sort(),'edge ordering alone does not reset node identities');
  assert.equal(p.moving,true,'ordinary resize/card movement continues to ease');
});
