// The real models' meshes in the overlay page: loaded once from the app's own files, checked against the hash the catalogue pins, and kept as named parts.
// Nothing here reaches a network: the bytes come from a file next to the page (`connect-src file:` in the page's policy), a file whose hash is not the
// catalogue's, or that points at anything outside itself, is refused, and a model that cannot be loaded leaves its parts empty so the scene still plays.

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BufferGeometry, Mesh, Object3D } from 'three';
import { MODELS } from '../scene/model-catalogue.ts';
import type { ModelEntry } from '../scene/model-catalogue.ts';
import { findModel } from '../scene/models.ts';

export type ModelState = 'idle' | 'loading' | 'ready' | 'failed';

/** What the renderer needs of the models: whether one is loaded, and the geometry of a named part (centred on itself, in metres). */
export interface ModelStore {
  state(model: string): ModelState;
  /** Starts loading the models (if not begun) and resolves when each is ready or has failed. Never rejects. */
  ensure(models: Iterable<string>): Promise<void>;
  /** The part's mesh geometry, centred on itself, in metres: shared with the store, so never changed or disposed by the caller. */
  geometry(model: string, part: string): BufferGeometry | undefined;
  /** Why a model failed, for the log. */
  failure(model: string): string | undefined;
}

export type StoreOptions = {
  /** Reads the bytes of a built model file by its name (`heart.glb`). */
  read: (file: string) => Promise<ArrayBuffer>;
  /** Called when a model finishes loading or fails, so a waiting frame can be drawn again. */
  changed?: () => void;
  catalogue?: readonly ModelEntry[];
};

const hex = (bytes: ArrayBuffer): string => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

/** The JSON chunk of a GLB, or a reason it is not one. */
function glbJson(buffer: ArrayBuffer): { json?: Record<string, unknown>; reason?: string } {
  const view = new DataView(buffer);
  if (buffer.byteLength < 28 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) return { reason: 'not a GLB 2 file' };
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || 20 + length > buffer.byteLength) return { reason: 'no JSON chunk' };
  try { return { json: JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length))) as Record<string, unknown> }; } catch { return { reason: 'unreadable JSON chunk' }; }
}

/** A model file may carry its data and nothing that fetches: no external buffer or image, no data URIs that stand for them. */
export function externalReference(json: Record<string, unknown>): string | undefined {
  for (const key of ['buffers', 'images']) {
    const list = json[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) if (item && typeof item === 'object' && 'uri' in item) return `${key} carries a uri`;
  }
  return undefined;
}

export function createModelStore(options: StoreOptions): ModelStore {
  const catalogue = options.catalogue ?? MODELS;
  const states = new Map<string, ModelState>();
  const failures = new Map<string, string>();
  const parts = new Map<string, Map<string, BufferGeometry>>();
  const waiting = new Map<string, Promise<void>>();

  const parse = (buffer: ArrayBuffer): Promise<Object3D> => new Promise((ok, bad) => new GLTFLoader().parse(buffer, '', (gltf) => ok(gltf.scene), (error) => bad(error instanceof Error ? error : new Error(String(error)))));

  async function load(entry: ModelEntry): Promise<void> {
    states.set(entry.id, 'loading');
    try {
      const bytes = await options.read(entry.built.file);
      if (bytes.byteLength !== entry.built.bytes) throw new Error(`${entry.built.file} is ${bytes.byteLength} bytes, not ${entry.built.bytes}`);
      const digest = hex(await crypto.subtle.digest('SHA-256', bytes));
      if (digest !== entry.built.sha256) throw new Error(`${entry.built.file} is not the file the catalogue pins (hash differs)`);
      const { json, reason } = glbJson(bytes);
      if (!json) throw new Error(`${entry.built.file}: ${reason}`);
      const external = externalReference(json);
      if (external) throw new Error(`${entry.built.file}: ${external}`);
      const root = await parse(bytes);
      const named = new Map<string, BufferGeometry>();
      root.traverse((node) => {
        const mesh = node as Mesh;
        if (mesh.isMesh && entry.parts.some((p) => p.key === mesh.name)) named.set(mesh.name, mesh.geometry);
      });
      const missing = entry.parts.filter((p) => !named.has(p.key)).map((p) => p.key);
      if (missing.length) throw new Error(`${entry.built.file} lacks parts: ${missing.join(', ')}`);
      parts.set(entry.id, named);
      states.set(entry.id, 'ready');
    } catch (error) {
      failures.set(entry.id, error instanceof Error ? error.message : String(error));
      states.set(entry.id, 'failed');
    }
    options.changed?.();
  }

  return {
    state: (model) => states.get(model) ?? 'idle',
    failure: (model) => failures.get(model),
    geometry: (model, part) => parts.get(model)?.get(part),
    async ensure(models) {
      const runs: Promise<void>[] = [];
      for (const id of models) {
        const entry = catalogue.find((m) => m.id === id);
        if (!entry) continue;
        let run = waiting.get(id);
        if (!run) { run = load(entry); waiting.set(id, run); }
        runs.push(run);
      }
      await Promise.all(runs);
    },
  };
}

/** The ids of the real models a scene uses, so they can be loaded before its first frame. */
export function modelsIn(scene: { steps: readonly { actions: readonly unknown[] }[] }): string[] {
  const out = new Set<string>();
  for (const step of scene.steps) for (const a of step.actions) {
    const act = a as { op?: string; shape?: string; model?: unknown };
    const model = act.op === 'add' && act.shape === 'model' ? findModel(act.model) : undefined;
    if (model) out.add(model.id);
  }
  return [...out];
}

/** The credit line a drawing owes for the real models in it (CC BY asks for it to be shown), one per model, or none. */
export function creditLine(objects: readonly { def: { shape?: string; model?: unknown } }[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const o of objects) {
    if (o.def.shape !== 'model') continue;
    const model = findModel(o.def.model);
    if (!model?.credit || seen.has(model.id)) continue;
    seen.add(model.id);
    // The short form, without the licence's web address (that is in the credits file).
    lines.push(`${model.name}: ${model.credit.replace(/\s*\(https?:[^)]*\)/g, '')}`);
  }
  return lines.join(' · ');
}
