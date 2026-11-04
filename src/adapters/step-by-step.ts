// A quick answer written one step to a call. The first call writes step 1 and a plan (the titles of the steps still to come); as soon as it
// has finished, the next call is asked for step 2, and so on until a call says it wrote the last step. Each call has one step to think about,
// so each should answer well inside the speech of the step before it. Wraps any model whose answers carry `plan` and `done` (the
// scene schema for it is sceneSchemaChain); it makes one call per step, so it is a setting, and off unless the person turns it on.
//
// A call after the first that fails ends the answer there (what was shown stays) with one line in the log; a failure of the first call
// fails the question. Whatever a call writes after its one step is dropped. Ending the question aborts the call in progress.

import { sumUsage } from './two-step.ts';
import type { Model, ModelOutput, ModelRequest, Usage } from './model.ts';

export type StepByStepOptions = {
  log?: (message: string) => void;
  /** The most steps an answer may have (the plan is cut to fit). */
  maxSteps?: number;
};

/** `plan` and `done` from a call's raw text, when it is a scene that has them. */
function planAndDone(raw: string): { plan: string[]; done: boolean } {
  try {
    const at = raw.indexOf('{');
    const scene = JSON.parse(at >= 0 ? raw.slice(at) : raw) as { plan?: unknown; done?: unknown };
    const plan = Array.isArray(scene.plan) ? scene.plan.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim()) : [];
    return { plan, done: scene.done === true };
  } catch {
    return { plan: [], done: true };
  }
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
      try {
        for (let n = 1; n <= maxSteps; n++) {
          const began = Date.now();
          let raw = '';
          let firstAt = 0;
          let sawStep = false;
          let escalated = false;
          const stage: NonNullable<ModelRequest['stage']> = n === 1 ? { part: 'first', plan: true } : { part: 'next', n, shown: [...shown], plan };
          try {
            for await (const out of inner.ask({ ...req, stage, signal: link.signal, onRaw: (text: string) => void (raw = text) })) {
              if (out.type === 'usage') {
                usages.push(out.usage);
                continue;
              }
              if (sawStep && (out.type === 'step' || out.type === 'say' || out.type === 'action')) continue;
              firstAt ||= Date.now() - began;
              if (out.type === 'step') {
                sawStep = true;
                shown.push(out.step);
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
          if (n === 1) plan = got.plan.slice(0, maxSteps - 1);
          else plan = plan.slice(1);
          if (got.done || plan.length === 0) break;
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
