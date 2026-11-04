// A quick answer written one step to a call. The first call writes step 1 and a plan (the titles of the steps still to come); as soon as it
// has finished, the next call is asked for step 2, and so on until a call says it wrote the last step. Each call has one step to think about,
// so each should answer well inside the speech of the step before it. Wraps any model whose answers carry `plan` and `done` (the
// scene schema for it is sceneSchemaChain); it makes one call per step, so it is a setting, and off unless the person turns it on.
//
// A step that ends on a wait for the person's click (a how-do-I walk) holds the chain: the next call is made only after the click, from the
// screen as it is then (the request's `afterStep` answers with it), so a step is never positioned on a screen the model has not seen. A step
// that does not wait is followed at once by the next call, as in an explanation. Without `afterStep` the chain never holds.
//
// A call after the first that fails ends the answer there (what was shown stays) with one line in the log; a failure of the first call
// fails the question. Whatever a call writes after its one step is dropped. Ending the question aborts the call in progress.

import { sumUsage } from './two-step.ts';
import type { FocusCrop, Model, ModelOutput, ModelRequest, Usage } from './model.ts';

export type StepByStepOptions = {
  log?: (message: string) => void;
  /** The most steps an answer may have (the plan is cut to fit). */
  maxSteps?: number;
};

/** A step that ends on a wait for the person's click. */
function endsOnWait(step: unknown): boolean {
  const actions = (step as { actions?: unknown }).actions;
  return Array.isArray(actions) && actions.some((a) => typeof a === 'object' && a !== null && (a as { op?: unknown }).op === 'wait');
}

/** The part of the screenshot a step enlarges (an `image` action's source box, 0..1000), or null. */
function enlargedBox(step: unknown): { box: { x: number; y: number; w: number; h: number }; card: { x: number; y: number; w: number; h: number } } | null {
  const actions = (step as { actions?: unknown }).actions;
  if (!Array.isArray(actions)) return null;
  for (const a of actions) {
    const m = a as { op?: unknown; sx?: unknown; sy?: unknown; sw?: unknown; sh?: unknown; dx?: unknown; dy?: unknown; dw?: unknown };
    if (m.op === 'image' && [m.sx, m.sy, m.sw, m.sh, m.dx, m.dy, m.dw].every((v) => typeof v === 'number' && Number.isFinite(v)) && (m.sw as number) > 0 && (m.sh as number) > 0 && (m.dw as number) > 0) {
      const x = Math.max(0, Math.min(1000, m.sx as number)), y = Math.max(0, Math.min(1000, m.sy as number));
      // The card shows the part at its own shape (the same scale across and down, so the units agree), with a border of about 8 above the picture.
      const card = { x: m.dx as number, y: (m.dy as number) + 8, w: m.dw as number, h: ((m.dw as number) * (m.sh as number)) / (m.sw as number) };
      return { box: { x, y, w: Math.min(1000 - x, m.sw as number), h: Math.min(1000 - y, m.sh as number) }, card };
    }
  }
  return null;
}

/** The end of the first JSON object in the text (the index after its closing brace), or -1. */
function objectEnd(text: string, from: number): number {
  let depth = 0;
  let inString = false;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * `plan` and `done` from a call's raw text, when it is a scene that has them. `given` is whether the call wrote either (null counts: it says
 * the answer is whole). The model sometimes closes the scene right after its steps and then carries on with `, "plan": ...`: those fields are read too.
 */
function planAndDone(raw: string): { plan: string[]; done: boolean; given: boolean } {
  let scene: { plan?: unknown; done?: unknown };
  try {
    const at = raw.indexOf('{');
    const text = at >= 0 ? raw.slice(at) : raw;
    try {
      scene = JSON.parse(text) as typeof scene;
    } catch {
      const end = objectEnd(text, 0);
      if (end < 0) throw new Error('not a scene');
      scene = JSON.parse(text.slice(0, end)) as typeof scene;
      const rest = text.slice(end).trim();
      if (rest.startsWith(',')) {
        try {
          scene = { ...scene, ...(JSON.parse('{' + rest.slice(1)) as typeof scene) };
        } catch {
          // what follows is not read
        }
      }
    }
  } catch {
    return { plan: [], done: true, given: true };
  }
  const plan = Array.isArray(scene.plan) ? scene.plan.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim()) : [];
  return { plan, done: scene.done === true, given: scene.plan !== undefined || scene.done !== undefined };
}

export function createStepByStepModel(inner: Model, options: StepByStepOptions = {}): Model {
  const log = options.log ?? (() => undefined);
  const maxSteps = Math.max(2, options.maxSteps ?? 6);
  const model: Model = {
    id: inner.id,

    async *ask(req: ModelRequest): AsyncGenerator<ModelOutput> {
      if (req.detail || req.stage) {
        yield* inner.ask(req);
        return;
      }
      const link = new AbortController();
      const stop = (): void => link.abort();
      if (req.signal?.aborted) link.abort();
      else req.signal?.addEventListener('abort', stop, { once: true });
      const raws: string[] = [];
      const usages: Usage[] = [];
      const shown: unknown[] = [];
      let plan: string[] = [];
      let screenshot = req.screenshot;
      let fresh = false;
      let waits = 0;
      // The first call wrote neither a plan nor done: the next call is asked once whether the answer goes on, and for a plan.
      let asking = false;
      const { focus: _pen, ...plain } = req;
      // What the step just written enlarged, being cut from the full-resolution frame while that step is spoken: the next call gets it as a sharp picture to place points on.
      let zoom: { box: { x: number; y: number; w: number; h: number }; card: { x: number; y: number; w: number; h: number }; crop: Promise<Awaited<ReturnType<NonNullable<ModelRequest['cropOf']>>>> } | undefined;
      try {
        for (let n = 1; n <= maxSteps; n++) {
          const began = Date.now();
          let raw = '';
          let firstAt = 0;
          let sawStep = false;
          let escalated = false;
          let waited = false;
          const closer: FocusCrop[] = [];
          if (zoom) {
            const crop = await zoom.crop;
            if (crop && !link.signal.aborted) closer.push({ crop, box: zoom.box, card: zoom.card, kind: 'picture' });
            log(`step ${n}: ${crop ? 'given a full-resolution picture of what step ' + (n - 1) + ' enlarged' : 'the enlarged part could not be cut (the frame is gone)'}`);
            zoom = undefined;
          }
          const focusNow = [...(fresh ? [] : req.focus ?? []), ...closer];
          const stage: NonNullable<ModelRequest['stage']> = n === 1 ? { part: 'first', plan: true } : { part: 'next', n, shown: [...shown], plan, ...(asking ? { unplanned: true as const } : {}), ...(fresh ? { fresh: true as const } : {}) };
          try {
            for await (const out of inner.ask({ ...plain, ...(focusNow.length > 0 ? { focus: focusNow } : {}), screenshot, stage, signal: link.signal, onRaw: (text: string) => void (raw = text) })) {
              if (out.type === 'usage') {
                usages.push(out.usage);
                continue;
              }
              if (sawStep && (out.type === 'step' || out.type === 'say' || out.type === 'action')) continue;
              firstAt ||= Date.now() - began;
              if (out.type === 'step') {
                sawStep = true;
                shown.push(out.step);
                const enlarged = !fresh && req.cropOf ? enlargedBox(out.step) : null;
                if (enlarged) zoom = { box: enlarged.box, card: enlarged.card, crop: req.cropOf!(enlarged.box).catch(() => null) };
                waited = endsOnWait(out.step);
                if (waited) waits++;
              }
              if (out.type === 'escalate') escalated = true;
              yield out;
            }
          } catch (error) {
            if (n === 1 || link.signal.aborted) throw error;
            log(`step ${n} failed, the answer ends after step ${n - 1}: ${error instanceof Error ? error.message : String(error)}`);
            break;
          }
          raws[n - 1] = raw;
          if (n > 1) log(`step ${n}: first output after ${firstAt} ms, ended after ${Date.now() - began} ms`);
          else log(`step 1: first output after ${firstAt} ms, ended after ${Date.now() - began} ms`);
          if (!sawStep || escalated) break;
          const got = planAndDone(raw);
          const wasAsking = asking;
          asking = false;
          if (n === 1) {
            plan = got.plan.slice(0, maxSteps - 1);
            if (!got.given) {
              asking = true;
              log('step 1 came with no plan and no done: asking once more, for the next step and a plan');
            }
          } else if (wasAsking) {
            plan = got.plan.slice(0, maxSteps - n);
            if (!got.given) log(`step ${n}, asked again, came with no plan and no done either: the answer ends after step ${n}`);
          }
          else plan = plan.slice(1);
          if (got.done || (plan.length === 0 && !asking)) break;
          if (waited && req.afterStep) {
            const held = Date.now();
            const gone = new Promise<'stop'>((resolve) => link.signal.addEventListener('abort', () => resolve('stop'), { once: true }));
            const after = await Promise.race([req.afterStep({ waits, signal: link.signal }), gone]);
            if (after === 'stop' || link.signal.aborted) {
              log(`step ${n} waited for the click, then the walk was over or replaced: no more calls`);
              break;
            }
            if (after !== 'go') {
              screenshot = after.screenshot;
              fresh = true;
              log(`step ${n + 1}: held ${Date.now() - held} ms for the click, then asked from the screen as it is now`);
            }
          }
        }
        if (usages.length > 0) {
          if (usages.length > 1) log(`${usages.length} calls, tokens (input/cached/output): ${usages.map((u) => `${u.input}/${u.cached}/${u.output}`).join(' then ')}`);
          yield { type: 'usage', usage: sumUsage(usages) };
        }
      } finally {
        link.abort();
        req.signal?.removeEventListener('abort', stop);
        if (req.onRaw && raws.length > 0) req.onRaw(raws.filter((r) => r !== undefined).join('\n\n--- next call ---\n\n'));
      }
    },
  };
  if (inner.warm) model.warm = () => inner.warm!();
  if (inner.prime) model.prime = () => inner.prime!();
  if (inner.unprime) model.unprime = () => inner.unprime!();
  if (inner.close) model.close = () => inner.close!();
  return model;
}
