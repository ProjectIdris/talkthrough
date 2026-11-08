import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Mesh, MeshPhysicalMaterial, Raycaster, ShaderLib, Triangle, Vector3 } from 'three';
import type { Object3D, WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt, evaluate, planStep } from '../src/overlay/timeline.ts';
import { createSceneState, validateScene, sceneSchema, sceneSchemaLean } from '../src/scene/index.ts';
import { check, variantDefinitions } from './support/json-schema.ts';

const tube = { op: 'add', shape: 'tube', id: 'path', pts: [[-2,0,0],[0,1,0],[2,0,0]], radius: 0.23, material: 'tissue' };
const ends = [
  { op: 'add', shape: 'sphere', id: 'a', size: [0.3,0.3,0.3], pos: [-2,0,0] },
  { op: 'add', shape: 'sphere', id: 'b', size: [0.3,0.3,0.3], pos: [2,0,0] },
];
const connector = { op: 'add', shape: 'connector', id: 'path', from: 'a', to: 'b', kind: 'slack', sag: 0.3, radius: 0.18, material: 'rubber' };
function scene(...actions: unknown[]) {
  const result = validateScene({ steps: [{ say: 'Inspect the surface.', actions }] }, createSceneState());
  assert.ok(result.scene);
  return { ...result, scene: result.scene };
}
function meshOf(object: Object3D | undefined): Mesh {
  let mesh: Mesh | undefined;
  object?.traverse(o => { if (!mesh && o instanceof Mesh) mesh = o; });
  assert.ok(mesh);
  return mesh;
}
function patch(material: MeshPhysicalMaterial) {
  const shader = { vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader, uniforms: {} };
  material.onBeforeCompile(shader as WebGLProgramParametersWithUniforms, {} as WebGLRenderer);
  return shader;
}
function setup(actions: unknown[], tier: 'low' | 'mid' | 'high' = 'mid', attached = false) {
  const result = scene(...actions);
  assert.deepEqual(result.issues.filter(i => !attached || !i.message.includes('it is joined to it')), []);
  const frame = frameAt(result.scene.steps, 0, 99);
  const panel = new PanelScene({ tier });
  panel.sync(frame, 1);
  const key = frame.objects.find(o => o.id === 'path')!.key;
  return { panel, frame, key, mesh: meshOf(panel.nodeOf(key)) };
}

test('the single fibre preset survives tube and connector validation; null is absent', () => {
  for (const action of [tube, connector]) {
    const before = action.shape === 'connector' ? ends : [];
    const withTreatment = { ...action, treatment: 'fibres' };
    const result = scene(...before, withTreatment);
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.scene.steps[0]!.actions.at(-1), withTreatment);
    const without = scene(...before, { ...action, treatment: null });
    assert.deepEqual(without.issues, []);
    assert.deepEqual(without.scene.steps[0]!.actions.at(-1), action);
    for (const value of ['arbitrary-glsl', 1, true, {}, ['fibres']]) {
      const invalid = scene(...before, { ...action, treatment: value }, action);
      assert.equal(invalid.issues.filter(i => i.kind === 'dropped').length, 1);
      assert.deepEqual(invalid.scene.steps[0]!.actions.at(-1), action, 'an invalid treatment must not consume the ID');
    }
  }
});

test('full and lean strict schemas admit only the path treatment enum on supported shapes', () => {
  for (const schema of [sceneSchema, sceneSchemaLean]) {
    const defs = variantDefinitions(schema);
    for (const name of ['addTube','addConnector']) {
      const properties = defs[name]!.properties!;
      assert.deepEqual((properties.treatment as { enum: unknown })?.enum, ['fibres', null]);
      assert.ok(defs[name]!.required!.includes('treatment'));
      assert.deepEqual(check(schema, defs[name]!, { ...(name === 'addTube' ? tube : connector), treatment: 'fibres' }, '$', true), []);
    }
    for (const name of ['addSolid','addPart','addGroup','addPath','addText','addStream','style']) {
      assert.equal(defs[name]!.properties!.treatment, undefined);
    }
  }
});

test('treatment preserves all geometry and base material state on every tier, adding coordinates only when used', () => {
  for (const tier of ['low','mid','high'] as const) {
    const plain = setup([tube], tier);
    const fibres = setup([{ ...tube, treatment: 'fibres' }], tier);
    try {
      for (const name of ['position','normal']) assert.deepEqual(fibres.mesh.geometry.getAttribute(name).array, plain.mesh.geometry.getAttribute(name).array);
      assert.deepEqual(fibres.mesh.geometry.index!.array, plain.mesh.geometry.index!.array);
      const coords = fibres.mesh.geometry.getAttribute('surfaceCoord');
      assert.ok(coords, 'path coordinates are renderer-owned');
      assert.equal(coords.count, fibres.mesh.geometry.getAttribute('position').count);
      assert.equal(plain.mesh.geometry.getAttribute('surfaceCoord'), undefined, 'untreated geometry keeps its memory budget');
      const a = fibres.mesh.material as MeshPhysicalMaterial, b = plain.mesh.material as MeshPhysicalMaterial;
      for (const field of ['roughness','metalness','clearcoat','clearcoatRoughness','opacity','transparent','depthWrite','side','sheen','emissiveIntensity'] as const) assert.equal(a[field], b[field], field);
      assert.notEqual(patch(a).fragmentShader, patch(b).fragmentShader);
      assert.notEqual(a.customProgramCacheKey(), b.customProgramCacheKey(), 'shader cache must distinguish the treatment');
      assert.equal(fibres.panel.scene.children.length, plain.panel.scene.children.length);
    } finally { plain.panel.destroy(); fibres.panel.destroy(); }
  }
});

test('fibre coordinates remain longitudinal round the circumference and fade at cap poles', () => {
  const { panel, mesh } = setup([{ ...tube, treatment: 'fibres' }]);
  try {
    const g = mesh.geometry, coord = g.getAttribute('surfaceCoord');
    assert.ok(coord);
    const rings = g.userData.rings as number, radial = g.userData.indicesPerRing / 6, row = radial + 1;
    for (let ring = 0; ring < rings; ring++) for (let j = 0; j <= radial; j++) {
      const i = ring * row + j;
      assert.ok(Math.abs(coord.getX(i) - j / radial) < 1e-6);
      assert.ok(Math.abs(coord.getY(i) - ring / (rings - 1)) < 1e-6);
      assert.equal(coord.getZ(i), 1);
    }
    const capRings = (coord.count / row - rings) / 2;
    for (const start of [rings * row, (rings + capRings) * row]) {
      for (let ring = 0; ring < capRings; ring++) for (let j = 0; j <= radial; j++) {
        assert.ok(coord.getZ(start + ring * row + j) >= 0 && coord.getZ(start + ring * row + j) < 1);
      }
      for (let j = 0; j <= radial; j++) assert.ok(coord.getZ(start + (capRings - 1) * row + j) < 1e-6);
    }
  } finally { panel.destroy(); }
});

test('closed and flattened tubes carry seam-safe coordinates without adding caps', () => {
  for (const flat of [1, 0.2]) {
    const { panel, mesh } = setup([{ ...tube, closed: true, flat, treatment: 'fibres' }]);
    try {
      const g = mesh.geometry, coord = g.getAttribute('surfaceCoord');
      assert.ok(coord);
      assert.equal(g.userData.startCap, 0);
      const radial = g.userData.indicesPerRing / 6, row = radial + 1;
      const last = (g.userData.rings - 1) * row;
      for (let j = 0; j <= radial; j++) {
        assert.equal(coord.getX(j), coord.getX(last + j));
        assert.equal(coord.getZ(j), 1); assert.equal(coord.getZ(last + j), 1);
      }
      assert.equal(coord.getX(0), 0); assert.equal(coord.getX(radial), 1);
    } finally { panel.destroy(); }
  }
});

test('moving connectors regenerate coordinates with no material churn and deterministic reverse seeks', () => {
  const { panel, frame, key, mesh } = setup([...ends, { ...connector, treatment: 'fibres' }]);
  try {
    const material = mesh.material, geo = mesh.geometry;
    const old = mesh.geometry.getAttribute('surfaceCoord');
    assert.ok(old);
    let disposed = 0; geo.addEventListener('dispose', () => disposed++);
    const moved = evaluate(planStep(frame, { say: 'Bend.', actions: [{ op: 'move', id: 'b', to: [0.5,1,0.4], dur: 0 }] }), 99);
    panel.sync(moved, 1);
    assert.notEqual(mesh.geometry, geo);
    assert.equal(mesh.material, material);
    assert.equal(disposed, 1);
    assert.deepEqual(mesh.geometry.getAttribute('surfaceCoord').array, old.array);
    panel.sync(frame, 1);
    assert.deepEqual(mesh.geometry.getAttribute('position').array, geo.getAttribute('position').array);
    assert.deepEqual(mesh.geometry.getAttribute('surfaceCoord').array, old.array);
    const stable = mesh.geometry; panel.sync(frame, 1); assert.equal(mesh.geometry, stable);
    assert.equal(meshOf(panel.nodeOf(key)).material, material);
  } finally { panel.destroy(); }
});

test('treated elastic connectors keep the current bulge and endpoint limits through contraction and reverse seeks', () => {
  for (const tier of ['low', 'mid', 'high'] as const) {
    const actions = [
      { ...ends[0], pos: [0, 0, 0] }, { ...ends[1], pos: [0, 4, 0] },
      { ...connector, kind: 'straight', radius: 0.1, restLength: 4,
        fromPoint: [0, 0, 0], toPoint: [0, 0, 0], swell: [[0, 0.2], [0.5, 2], [1, 0.2]] },
    ];
    const plain = setup(actions, tier);
    const treated = setup([...actions.slice(0, -1), { ...actions.at(-1), treatment: 'fibres' }], tier);
    try {
      const original = treated.mesh.geometry;
      const shorten = (frame: typeof treated.frame) => evaluate(planStep(frame, { say: 'Shorten.', actions: [{ op: 'move', id: 'b', to: [0, 0.02, 0], dur: 0 }] }), 99);
      const moved = shorten(treated.frame), plainMoved = shorten(plain.frame);
      for (const [plainFrame, frame] of [[plain.frame, treated.frame], [plainMoved, moved], [plain.frame, treated.frame]] as const) {
        plain.panel.sync(plainFrame, 1); treated.panel.sync(frame, 1);
        const a = plain.mesh.geometry, b = treated.mesh.geometry;
        for (const name of ['position', 'normal']) assert.deepEqual(b.getAttribute(name).array, a.getAttribute(name).array);
        assert.deepEqual(b.index!.array, a.index!.array);
        assert.equal(a.getAttribute('surfaceCoord'), undefined, `${tier}: untreated paths remain unmodified`);
        assert.ok(b.getAttribute('surfaceCoord'), `${tier}: rebuilt elastic path retains its material coordinates`);
        const positions = b.getAttribute('position');
        let widest = 0, low = Infinity, high = -Infinity;
        for (let i = 0; i < positions.count; i++) {
          widest = Math.max(widest, Math.hypot(positions.getX(i), positions.getZ(i)));
          low = Math.min(low, positions.getY(i)); high = Math.max(high, positions.getY(i));
        }
        assert.ok(widest > 0.19 && widest <= 0.20001, `${tier}: authored swell is retained without growing past its bound (${widest})`);
        if (frame === moved) assert.ok(low >= -0.00501 && high <= 0.02501, `${tier}: rounded ends stay within a quarter-span (${low}..${high})`);
      }
      assert.deepEqual(treated.mesh.geometry.getAttribute('position').array, original.getAttribute('position').array);
      assert.deepEqual(treated.mesh.geometry.getAttribute('surfaceCoord').array, original.getAttribute('surfaceCoord').array);
    } finally { plain.panel.destroy(); treated.panel.destroy(); }
  }
});

test('attached tubes regenerate their treatment when an endpoint moves', () => {
  const { panel, frame, mesh } = setup([...ends, { ...tube, pts: [[-2,0,0],[0,0.6,0],[2,0,0]], treatment: 'fibres' }], 'mid', true);
  try {
    const geo = mesh.geometry;
    assert.ok(frame.objects.find(o => o.id === 'path')!.def && 'attach' in frame.objects.find(o => o.id === 'path')!.def);
    const moved = evaluate(planStep(frame, { say: 'Move.', actions: [{ op: 'move', id: 'b', to: [2,1,0], dur: 0 }] }), 99);
    panel.sync(moved, 1);
    assert.notEqual(mesh.geometry, geo);
    assert.ok(mesh.geometry.getAttribute('surfaceCoord'));
    assert.deepEqual(mesh.geometry.getAttribute('surfaceCoord').array, geo.getAttribute('surfaceCoord').array);
  } finally { panel.destroy(); }
});

test('glass, clipping, reveals and opacity changes retain treatment without changing alpha rules', () => {
  const { panel, frame, mesh } = setup([{ ...tube, material: 'glass', draw: 0.4, treatment: 'fibres' }, { op: 'cut', id: 'path', to: 0, dur: 0 }]);
  try {
    const material = mesh.material as MeshPhysicalMaterial;
    assert.equal(material.opacity, 0.34); assert.equal(material.transparent, true); assert.equal(material.depthWrite, false);
    assert.ok(material.clippingPlanes?.length);
    assert.ok(mesh.geometry.drawRange.count < mesh.geometry.index!.count);
    const shader = patch(material);
    assert.match(shader.fragmentShader, /vSurfaceCoord/);
    assert.match(shader.fragmentShader, /#include <clipping_planes_fragment>/);
    const faded = evaluate(planStep(frame, { say: 'Fade.', actions: [{ op: 'style', id: 'path', opacity: 0.5, dur: 0 }] }), 99);
    panel.sync(faded, 1);
    assert.equal(material.opacity, 0.17); assert.equal(mesh.material, material);
    assert.equal(patch(material).fragmentShader, shader.fragmentShader);
  } finally { panel.destroy(); }
});

test('arrays inherit treatment while untargeted materials remain unpatched and disposal stays owned once', () => {
  const { panel } = setup([{ ...tube, treatment: 'fibres' }, { op: 'add', shape: 'array', id: 'copies', of: 'path', count: 3, step: [0,2,0] }]);
  const materials: MeshPhysicalMaterial[] = [];
  panel.scene.traverse(o => { if (o instanceof Mesh && o.material instanceof MeshPhysicalMaterial) materials.push(o.material); });
  assert.equal(materials.length, 3);
  let disposed = 0;
  for (const material of materials) {
    assert.match(patch(material).fragmentShader, /vSurfaceCoord/);
    material.addEventListener('dispose', () => disposed++);
  }
  panel.destroy();
  assert.equal(disposed, 3);
});

test('the emitted fibre filter fades unresolved detail to neutral and keeps resolved contrast bounded', () => {
  const { panel, mesh } = setup([{ ...tube, treatment: 'fibres' }]);
  try {
    const shader = patch(mesh.material as MeshPhysicalMaterial);
    // Evaluate the actual small scalar GLSL filter, not a duplicate production JS helper.
    const body = shader.fragmentShader.match(/float filteredFibreWave\(float phase, float footprint\) \{([^}]+)\}/)?.[1];
    assert.ok(body);
    const smoothstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x-a)/(b-a))); return t*t*(3-2*t); };
    const filter = new Function('phase','footprint','smoothstep','cos','fract', body.replace(/float /g,'let ')) as (...args: unknown[]) => number;
    const sample = (phase: number, width: number) => filter(phase, width, smoothstep, Math.cos, (x: number) => x-Math.floor(x));
    assert.equal(sample(0, 0), 1);
    assert.ok(Math.abs(sample(0.5, 0) + 1) < 1e-12);
    for (const width of [0.75,1,4,100]) for (const phase of [-10,-0.3,0,0.2,0.5,3.8]) assert.equal(Math.abs(sample(phase,width)),0);
    let previous = 1;
    for (let i=0;i<=100;i++) { const value=sample(0,i/100); assert.ok(value>=0 && value<=previous); previous=value; }
    for (let i=-200;i<=200;i++) assert.ok(Math.abs(sample(i/31,0.1))<=1);
    assert.ok(shader.fragmentShader.indexOf('fwidth(fibrePhase)') < shader.fragmentShader.indexOf('#include <clipping_planes_fragment>'));
    assert.match(shader.fragmentShader, /roughnessFactor = clamp/);
    assert.match(shader.fragmentShader, /diffuseColor\.rgb \*=/);
    assert.doesNotMatch(shader.fragmentShader, /diffuseColor\.a\s*=/);
  } finally { panel.destroy(); }
});


test('the paired demonstration validates unchanged and renders every authored state on each tier', () => {
  const input = JSON.parse(readFileSync(new URL('../samples/scenes/path-surface-treatments.json', import.meta.url), 'utf8'));
  const result = validateScene(input);
  assert.deepEqual(result.issues, []); assert.deepEqual(result.scene, input); assert.ok(result.scene);
  for (const tier of ['low','mid','high'] as const) {
    const panel = new PanelScene({ tier });
    try {
      for (const step of [0,1,2,3,1,0]) {
        const frame = frameAt(result.scene.steps,step,99); panel.sync(frame,1);
        for (const kind of ['Tissue','Cord','Glass']) {
          const get = (prefix: string) => meshOf(panel.nodeOf(frame.objects.find(o => o.id===prefix+kind)!.key));
          const a=get('plain'), b=get('treated');
          assert.deepEqual(a.geometry.getAttribute('position').array,b.geometry.getAttribute('position').array);
          assert.ok(b.geometry.getAttribute('surfaceCoord'));
          assert.equal(a.geometry.getAttribute('surfaceCoord'),undefined);
        }
      }
    } finally { panel.destroy(); }
  }
});


test('tiny endpoint motion across an ambiguous initial frame does not jump the material pattern', async t => {
  const cases: Array<[[number,number,number],[number,number,number]]> = [
    [[0,2.62358973342153,3.0194000911911534], [0,2.6236697334215298,3.01933057645694]],
    [[0.00004,2.62360973342153,3.0193827125914012], [0.00004,2.62362973342153,3.0193653340241013]],
  ];
  for (const [before,after] of cases) await t.test(before[0] === 0 ? 'discrete sign flip' : 'rapid frame rotation', () => {
  const { panel, frame, mesh } = setup([
    { ...ends[0], pos: [0,0,0] }, { ...ends[1], pos: before },
    { ...connector, kind: 'straight', radius: 0.2, treatment: 'fibres' },
  ], 'high');
  const waveAtRight = (end: [number,number,number]): number => {
    panel.scene.updateMatrixWorld(true);
    const origin=new Vector3(2,end[1]/2,end[2]/2);
    const hit=new Raycaster(origin,new Vector3(-1,0,0)).intersectObject(mesh,false)[0]; assert.ok(hit?.face);
    const positions=mesh.geometry.getAttribute('position'), coordinates=mesh.geometry.getAttribute('surfaceCoord');
    const face=hit.face;
    const bary=new Triangle(new Vector3().fromBufferAttribute(positions,face.a),new Vector3().fromBufferAttribute(positions,face.b),new Vector3().fromBufferAttribute(positions,face.c)).getBarycoord(mesh.worldToLocal(hit.point.clone()),new Vector3()); assert.ok(bary);
    const u=coordinates.getX(face.a)*bary.x+coordinates.getX(face.b)*bary.y+coordinates.getX(face.c)*bary.z;
    const fade=coordinates.getZ(face.a)*bary.x+coordinates.getZ(face.b)*bary.y+coordinates.getZ(face.c)*bary.z;
    const code=patch(mesh.material as MeshPhysicalMaterial).fragmentShader;
    const body=code.match(/float filteredFibreWave\(float phase, float footprint\) \{([^}]+)\}/)![1]!;
    const smoothstep=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
    const filter=new Function('phase','footprint','smoothstep','cos','fract',body.replace(/float /g,'let '));
    const sample=(phase:number,width:number)=>filter(phase,width,smoothstep,Math.cos,(x:number)=>x-Math.floor(x));
    const main=code.match(/float fibrePhase =[^]*?float fibreWave =[^]*?;/)![0];
    return new Function('vSurfaceCoord','fwidth','filteredFibreWave',main.replace(/float /g,'let ')+'return fibreWave;')({x:u,y:0.5,z:fade},()=>0,sample);
  };
  try {
    const a=waveAtRight(before);
    panel.sync(evaluate(planStep(frame,{say:'Tiny movement.',actions:[{op:'move',id:'b',to:after,dur:0}]}),99),1);
    const b=waveAtRight(after);
    assert.ok(Math.abs(a-b)<1e-5, `material wave jumps from ${a} to ${b}`);
    panel.sync(frame,1);assert.ok(Math.abs(waveAtRight(before)-a)<1e-5);
  } finally { panel.destroy(); }
  });
});

test('named fibre materials retain their implicit treatment through contraction and reverse seeks', () => {
  for (const material of ['muscle', 'tendon', 'rope']) for (const tier of ['low', 'mid', 'high'] as const) {
    const actions = [
      { ...ends[0], pos: [0, 0, 0] }, { ...ends[1], pos: [0, 4, 0] },
      { ...connector, kind: 'straight', radius: 0.1, restLength: 4,
        fromPoint: [0, 0, 0], toPoint: [0, 0, 0], swell: [[0, 0.2], [0.5, 2], [1, 0.2]] },
    ];
    const plain = setup(actions, tier);
    const treated = setup([...actions.slice(0, -1), { ...actions.at(-1), material }], tier);
    try {
      const original = treated.mesh.geometry, originalMaterial = treated.mesh.material;
      const shorten = (frame: typeof treated.frame) => evaluate(planStep(frame, { say: 'Shorten.', actions: [{ op: 'move', id: 'b', to: [0, 0.02, 0], dur: 0 }] }), 99);
      const moved = shorten(treated.frame), plainMoved = shorten(plain.frame);
      for (const [plainFrame, frame] of [[plain.frame, treated.frame], [plainMoved, moved], [plain.frame, treated.frame]] as const) {
        plain.panel.sync(plainFrame, 1); treated.panel.sync(frame, 1);
        const a = plain.mesh.geometry, b = treated.mesh.geometry;
        for (const name of ['position', 'normal']) assert.deepEqual(b.getAttribute(name).array, a.getAttribute(name).array);
        assert.deepEqual(b.index!.array, a.index!.array);
        assert.equal(a.getAttribute('surfaceCoord'), undefined, `${tier}: untreated paths remain unmodified`);
        assert.ok(b.getAttribute('surfaceCoord'), `${material}/${tier}: rebuilt elastic path retains its material coordinates`);
        assert.equal(treated.mesh.material, originalMaterial);
        assert.match(patch(originalMaterial as MeshPhysicalMaterial).fragmentShader, /vSurfaceCoord/);
        const positions = b.getAttribute('position');
        let widest = 0, low = Infinity, high = -Infinity;
        for (let i = 0; i < positions.count; i++) {
          widest = Math.max(widest, Math.hypot(positions.getX(i), positions.getZ(i)));
          low = Math.min(low, positions.getY(i)); high = Math.max(high, positions.getY(i));
        }
        assert.ok(widest > 0.19 && widest <= 0.20001, `${tier}: authored swell is retained without growing past its bound (${widest})`);
        if (frame === moved) assert.ok(low >= -0.00501 && high <= 0.02501, `${tier}: rounded ends stay within a quarter-span (${low}..${high})`);
      }
      assert.deepEqual(treated.mesh.geometry.getAttribute('position').array, original.getAttribute('position').array);
      assert.deepEqual(treated.mesh.geometry.getAttribute('surfaceCoord').array, original.getAttribute('surfaceCoord').array);
    } finally { plain.panel.destroy(); treated.panel.destroy(); }
  }
});
