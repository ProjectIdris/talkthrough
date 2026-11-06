// Exercise the real browser bundle (including Three), without Electron, a GPU, or new dependencies.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/overlay/overlay.ts', import.meta.url))], bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent' });
const source = bundle.outputFiles[0]!.text;

function boot(webgl: 'null' | 'throw', decodedBackdrop = false) {
  const paint: Array<[string, ...unknown[]]> = [];
  const calls: Record<string, any[][]> = {};
  const errors: unknown[][] = [];
  let clock = 1000, serial = 0;
  const frames = new Map<number, Function>();
  const timers = new Map<number, { fn: Function; at: number }>();
  const context2d = new Proxy({
    measureText: (s: string) => ({ width: s.length * 8, actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 3 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    getImageData: (_x: number, _y: number, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4).fill(240) }),
  } as any, { get(target, key) { return key in target ? target[key] : (...args: unknown[]) => { paint.push([String(key), ...args]); }; } });
  class Element {
    style: any = { display: 'none' };
    complete = false; naturalWidth = 0; naturalHeight = 0;
    width = 1000; height = 800; offsetWidth = 240; offsetHeight = 40;
    children: Element[] = []; parentElement: Element | null = null;
    listeners = new Map<string, Function[]>();
    private text = '';
    classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
    get textContent(): string { return this.text + this.children.map(c => c.textContent).join(''); }
    set textContent(s: string) { this.text = s; this.children = []; }
    querySelector() { return new Element(); }
    replaceChildren(...children: Element[]) { this.text = ''; this.children = children; }
    addEventListener(name: string, fn: Function) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]); }
    removeEventListener() {}
    contains(e: Element): boolean { return e === this || this.children.some(c => c.contains(e)); }
    click() { for (const fn of this.listeners.get('click') ?? []) fn({ target: this }); }
    setAttribute() {} removeAttribute() {} hasPointerCapture() { return false; }
    getBoundingClientRect() { const hidden = this.style.display === 'none'; return { x: 0, y: 0, left: 0, top: 0, right: hidden ? 0 : 240, bottom: hidden ? 0 : 40, width: hidden ? 0 : 240, height: hidden ? 0 : 40 }; }
    getContext(kind: string) { if (kind === '2d') return context2d; if (webgl === 'throw') throw new Error('WebGL blocked by test'); return null; }
  }
  const elements = new Map<string, Element>();
  const el = (id: string) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!; };
  if (decodedBackdrop) Object.assign(el('backdrop'), { complete: true, naturalWidth: 1000, naturalHeight: 800 });
  let onScene: Function, onDisplay: Function;
  const record = (name: string) => (...args: any[]) => { (calls[name] ??= []).push(args); };
  const bridge = new Proxy({
    onScene: (fn: Function) => { onScene = fn; }, onDisplay: (fn: Function) => { onDisplay = fn; },
    voice: { speak: record('voiceSpeak'), cancel: record('voiceCancel'), onEvent: () => () => {} },
  } as any, { get: (target, key) => target[key] ?? record(String(key)) });
  const doc = Object.assign(new Element(), { getElementById: el, createElement: () => new Element(), createElementNS: () => new Element(), documentElement: new Element(), body: new Element(), elementFromPoint: () => null });
  const win = Object.assign(new Element(), { talkthrough: bridge, innerWidth: 1000, innerHeight: 800, devicePixelRatio: 1, matchMedia: () => ({ matches: true, addEventListener() {} }) });
  const sandbox: any = { window: win, self: win, document: doc, Image: Element, HTMLElement: Element, Element, Node: Element,
    location: { search: '?tier=low' }, URLSearchParams, performance: { now: () => clock },
    console: { info() {}, warn() {}, error: (...args: unknown[]) => errors.push(args) },
    requestAnimationFrame: (fn: Function) => { frames.set(++serial, fn); return serial; }, cancelAnimationFrame: (id: number) => frames.delete(id),
    setTimeout: (fn: Function, ms = 0) => { timers.set(++serial, { fn, at: clock + ms }); return serial; }, clearTimeout: (id: number) => timers.delete(id),
    setInterval: () => ++serial, clearInterval() {}, getComputedStyle: (e: Element) => e.style,
  };
  vm.runInNewContext(source, sandbox, { filename: 'overlay.bundle.js', timeout: 5000 });
  async function flush(frameMs = 16) { for (let i = 0; i < 5; i++) { clock += frameMs; for (const [id, timer] of [...timers]) { if (timer.at <= clock) { timers.delete(id); timer.fn(); } } const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(clock)); await Promise.resolve(); } }
  return { paint, calls, errors, el, flush,
    scene: (message: any) => onScene(message),
    display: (extra: any = {}) => onDisplay({ id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 }, scaleFactor: 1, ...extra }),
  };
}
function noUnexpectedErrors(h: ReturnType<typeof boot>) {
  assert.deepEqual(h.errors.filter(e => !String(e[0]).startsWith('THREE.WebGLRenderer:')), [], 'only the expected failed-context diagnostic is allowed');
}
const model = [{ op: 'panel', x: 100, y: 100, w: 600, h: 600 }, { op: 'add', shape: 'box', id: 'cube', size: [2, 2, 2], color: 'blue' }, { op: 'pin', id: 'cube-label', on: 'cube', text: 'Invisible model pin' }];
const scene = (actions: any[], say = 'The explanation remains available.') => ({ v: 1, steps: [{ say, actions }] });
const marks = [{ op: 'box', id: 'box', x: 100, y: 100, w: 180, h: 120, color: 'blue' }, { op: 'label', id: 'label', x: 100, y: 300, text: 'Visible fallback label', color: 'blue' }];

for (const mode of ['null', 'throw'] as const) {
  test(`overlay starts and paints 2D when WebGL contexts ${mode}`, async () => {
    const h = boot(mode);
    assert.equal(h.calls.ready?.length, 1);
    h.display({ captions: 'text' });
    h.scene({ kind: 'seek', scene: scene(marks), step: 0, t: 8, token: 1 });
    await h.flush();
    assert.ok(h.paint.some(([method]) => method === 'stroke'), '2D box painted');
    assert.ok(h.paint.some(([method, text]) => method === 'fillText' && text === 'Visible fallback label'), '2D label painted');
    assert.ok(h.calls.rendered?.some(([token]) => token === 1));
    noUnexpectedErrors(h);
  });
}

test('degraded overlay retains diagrams, captions and voice IPC', async () => {
  const h = boot('null');
  h.display({ captions: 'text' });
  h.scene({ kind: 'seek', scene: scene([{ op: 'diagram', id: 'flow', kind: 'flow', x: 100, y: 100, w: 600, h: 300 }, { op: 'node', id: 'first', of: 'flow', text: 'Diagram survives' }]), step: 0, t: 8, token: 2 });
  await h.flush();
  assert.match(h.paint.filter(([method]) => method === 'fillText').map(([, text]) => text).join(' '), /Diagram survives/, JSON.stringify(h.paint.filter(([method]) => method === 'fillText')));
  h.scene({ kind: 'begin', turn: 1, question: 'Does text work?' });
  h.scene({ kind: 'step', step: { say: 'Text survives without WebGL.', actions: [] } });
  h.scene({ kind: 'end' });
  await h.flush();
  assert.equal(h.el('answer').style.display, 'block');
  assert.match(h.el('answer-text').textContent, /Text survives without WebGL/);
  h.scene({ kind: 'begin', turn: 1 });
  h.scene({ kind: 'step', step: { say: 'Caption above a 2D drawing.', actions: marks } });
  h.scene({ kind: 'end' });
  await h.flush();
  assert.equal(h.el('caption').style.display, 'block');
  assert.equal(h.el('caption').textContent, 'Caption above a 2D drawing.');
  assert.equal(h.el('answer').style.display, 'none');
  h.display({ captions: 'voice', voice: { server: true, firstAudioMs: 5000, cooldownMs: 1000 } });
  h.scene({ kind: 'play', turn: 1, scene: scene([], 'Voice still routes to main.') });
  await h.flush();
  assert.ok(h.calls.voiceSpeak?.some(([, text]) => text === 'Voice still routes to main.'));
  noUnexpectedErrors(h);
});

test('unavailable 3D is disclosed without phantom hits, controls or camera receipts', async () => {
  const h = boot('null');
  h.display({ detail: true });
  h.scene({ kind: 'seek', scene: scene([...model, ...marks]), step: 0, t: 8, token: 3, captureMetadata: true });
  await h.flush();
  assert.match(h.el('notice-text').textContent, /3D.*(unavailable|not available|disabled|could not|cannot)/i);
  assert.notEqual(h.el('notice').style.display, 'none');
  for (const id of ['explode', 'cut', 'detail', 'panel']) assert.equal(h.el(id).style.display, 'none');
  const snapshots = h.calls.visibleRegions ?? [];
  const latest = snapshots.at(-1)?.[0];
  assert.ok(latest, 'visible-region receipt published');
  h.scene({ kind: 'model-hit-query', x: 500, y: 400, revision: latest.revision });
  assert.equal(h.calls.modelHit?.at(-1)?.[0].hit, false);
  assert.ok(latest.regions.every((r: any) => r.id !== 'model-geometry' && !r.id.startsWith('pin-')), 'no model or model pin interaction region');
  assert.ok(!h.paint.some(([method, text]) => method === 'fillText' && text === 'Invisible model pin'));
  assert.ok(h.paint.some(([method, text]) => method === 'fillText' && text === 'Visible fallback label'), 'mixed 2D label still paints');
  assert.ok(h.calls.buttons?.every(([buttons]) => buttons.every((b: any) => !['explode', 'cut', 'detail'].includes(b.id))), 'no model control catchers');
  const receipt = h.calls.rendered?.find(([token]) => token === 3)?.[1];
  assert.ok(receipt, 'capture receipt delivered');
  assert.equal(receipt.camera, null);
  assert.equal(receipt.worldCamera, null);
  noUnexpectedErrors(h);
});

for (const streamed of [false, true]) {
  test(`model-only text answer survives ${streamed ? 'incremental actions' : 'whole steps'}`, async () => {
    const h = boot('null');
    h.display({ captions: 'text' });
    h.scene({ kind: 'begin', turn: 1, question: 'Describe the cube.' });
    const say = 'This cube is explained in text even without 3D.';
    if (streamed) {
      h.scene({ kind: 'step-open', say });
      for (const action of model) h.scene({ kind: 'action', action });
      h.scene({ kind: 'step-close' });
    } else h.scene({ kind: 'step', step: { say, actions: model } });
    h.scene({ kind: 'end' });
    await h.flush();
    assert.equal(h.el('answer').style.display, 'block');
    assert.equal(h.el('answer-text').textContent, say);
    assert.equal(h.el('answer-q').textContent, 'Describe the cube.');
    assert.equal(h.el('caption').style.display, 'none');
    assert.equal(h.calls.voiceSpeak, undefined, 'text-only must not request speech');
    noUnexpectedErrors(h);
  });
}

test('fallback notice respects application warnings, dismissal, new turns and clearing', async () => {
  const h = boot('null');
  h.display();
  const showModel = async () => {
    h.scene({ kind: 'seek', scene: scene(model), step: 0, t: 8, token: 4 });
    await h.flush();
  };
  const expectFallback = () => {
    assert.equal(h.el('notice').style.display, 'flex');
    assert.match(h.el('notice-text').textContent, /3D is unavailable/);
  };
  await showModel();
  expectFallback();
  h.scene({ kind: 'notice', text: 'Your answer is incomplete.', level: 'warning', persistent: true });
  await h.flush();
  assert.equal(h.el('notice-text').textContent, 'Your answer is incomplete.');
  h.el('notice').click();
  await h.flush();
  expectFallback();
  h.el('notice').click();
  await h.flush();
  assert.equal(h.el('notice').style.display, 'none');
  await showModel();
  assert.equal(h.el('notice').style.display, 'none', 'dismissal persists in same turn');
  h.scene({ kind: 'begin', turn: 1 });
  await showModel();
  expectFallback();
  h.scene({ kind: 'clear' });
  await h.flush();
  assert.equal(h.el('notice').style.display, 'none');
  await showModel();
  expectFallback();
  h.scene({ kind: 'seek', scene: scene(marks), step: 0, t: 8, token: 5 });
  await h.flush();
  assert.equal(h.el('notice').style.display, 'none', '2D-only frame removes stale fallback notice');
  noUnexpectedErrors(h);
});

for (const streamed of [false, true]) {
  test(`invisible panel does not displace screenshot-backed 2D cards (${streamed ? 'streamed' : 'seek'})`, async () => {
    async function cardRect(withPanel: boolean) {
      const h = boot('null', true);
      h.display({ backdrop: 'data:image/png;base64,test', captions: 'text' });
      const card = { op: 'card', at: 0, id: 'card', x: 200, y: 200, w: 300, title: 'Card title', rows: ['Card row'] };
      const actions = [...(withPanel ? model.slice(0, 2) : []), card];
      if (streamed) {
        h.scene({ kind: 'begin', turn: 1 });
        h.scene({ kind: 'step-open', say: 'Here is a card.' });
        for (const action of actions) h.scene({ kind: 'action', action });
        h.scene({ kind: 'step-close' });
        h.scene({ kind: 'end' });
      } else h.scene({ kind: 'seek', scene: scene(actions), step: 0, t: 8, token: 9 });
      await h.flush(250);
      noUnexpectedErrors(h);
      assert.ok(h.paint.some(([method]) => method === 'drawImage'), 'decoded backdrop activates page analysis');
      const latest = h.calls.visibleRegions?.at(-1)?.[0];
      const region = latest?.regions.find((r: any) => r.id.startsWith('card:'));
      assert.ok(region, 'visible card footprint published');
      return JSON.parse(JSON.stringify(region.shape));
    }
    assert.deepEqual(await cardRect(true), await cardRect(false), 'an undrawn panel must not reserve page space');
  });
}
