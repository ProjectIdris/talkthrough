// A quick answer written in two calls. The first asks for step 1 only: little to think about, so the first word comes sooner. When step 1
// arrives, a second call on the same question writes the steps after it, thinking while step 1 is spoken. Wraps any model; it asks
// twice per question, so it is a setting, and off unless the person turns it on.
//
// If the second call fails, the answer ends after step 1 and nothing is reported as an error. If the first fails, so does the question.
// A first call that writes more than step 1 has the rest dropped.
// Ending the question (the consumer stops reading, or the request is aborted) aborts both calls.

import { AsyncQueue } from './subscription-shared.ts';
import type { Model, ModelOutput, ModelRequest, Usage } from './model.ts';

export type TwoStepOptions = {
  /** Start the second call together with the first, telling it that step 1 is being written separately, instead of when step 1 has arrived (sooner by about the first call's whole time). */
  early?: boolean;
  /** For the one line that says the second call failed. */
  log?: (message: string) => void;
};

export function sumUsage(usages: readonly Usage[]): Usage {
  const total: Usage = { input: 0, cached: 0, output: 0 };
  let wrote = 0;
  for (const u of usages) {
    total.input += u.input;
    total.cached += u.cached;
    total.output += u.output;
    wrote += u.cacheWrite ?? 0;
  }
  if (wrote > 0) total.cacheWrite = wrote;
  return total;
}

export function createTwoStepModel(inner: Model, options: TwoStepOptions = {}): Model {
  const log = options.log ?? (() => undefined);
  const model: Model = {
    id: inner.id,

    async *ask(req: ModelRequest): AsyncGenerator<ModelOutput> {
      // A detail pass, or a request already asking for a part, is not split.
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
      const part = (index: number): Pick<ModelRequest, 'onRaw'> | Record<string, never> => (req.onRaw ? { onRaw: (text: string) => void (raws[index] = text) } : {});
      let rest: AsyncQueue<ModelOutput> | null = options.early ? startRest(undefined) : null;
      let sawStep = false;
      try {
        for await (const out of inner.ask({ ...req, stage: { part: 'first' }, signal: link.signal, ...part(0) })) {
          if (out.type === 'usage') {
            usages.push(out.usage);
            continue;
          }
          // The first call was asked for step 1 only. Whatever it writes after that step (its words and marks as they come, further steps) is dropped:
          // the second call writes those, and passing both on would play them twice.
          if (sawStep && (out.type === 'step' || out.type === 'say' || out.type === 'action')) continue;
          if (out.type === 'step') {
            sawStep = true;
            rest ??= startRest(out.step); // before the step is handed on: the second call must not wait for the reader
          }
          yield out;
        }
        if (rest && sawStep) {
          try {
            for await (const out of rest) {
              if (out.type === 'usage') usages.push(out.usage);
              else yield out;
            }
          } catch (error) {
            if (link.signal.aborted) throw error;
            log(`second call failed, the answer ends after step 1: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        if (usages.length > 1) log(`two calls, tokens (input/cached/output): ${usages.map((u) => `${u.input}/${u.cached}/${u.output}`).join(' then ')}`);
        if (usages.length > 0) yield { type: 'usage', usage: sumUsage(usages) };
      } finally {
        link.abort();
        req.signal?.removeEventListener('abort', stop);
        if (req.onRaw && raws.length > 0) req.onRaw(raws.filter((r) => r !== undefined).join('\n\n--- second call ---\n\n'));
      }

      /** Starts the second call at once and lets its output queue up until the first call has been read to its end. */
      function startRest(first: unknown | undefined): AsyncQueue<ModelOutput> {
        const queue = new AsyncQueue<ModelOutput>();
        const began = Date.now();
        void (async () => {
          try {
            let firstAt = 0;
            for await (const out of inner.ask({ ...req, stage: { part: 'rest', first }, signal: link.signal, ...part(1) })) {
              firstAt ||= Date.now() - began;
              queue.push(out);
            }
            log(`second call: first output after ${firstAt} ms, ended after ${Date.now() - began} ms`);
            queue.close();
          } catch (error) {
            queue.fail(error);
          }
        })();
        return queue;
      }
    },
  };
  if (inner.warm) model.warm = () => inner.warm!();
  if (inner.prime) model.prime = () => inner.prime!();
  if (inner.unprime) model.unprime = () => inner.unprime!();
  if (inner.close) model.close = () => inner.close!();
  return model;
}
