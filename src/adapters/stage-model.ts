// One answer written by two models: the first step by a fast one, the steps after it by another (Claude route only, off unless the settings name
// a second model). Each call of a step-by-step answer carries its stage; this sends step 1 (and a question with no stage) to `first` and every
// later call to `later`. The later model is started as soon as step 1 is asked for, so its process is ready by the time step 2 is wanted.

import type { Model, ModelOutput, ModelRequest } from './model.ts';

export function createStageModel(first: Model, later: Model): Model {
  return {
    id: `${first.id}+${later.id}`,
    async *ask(request: ModelRequest): AsyncGenerator<ModelOutput> {
      if (request.stage && request.stage.part !== 'first') {
        yield* later.ask(request);
        return;
      }
      if (request.stage) void later.warm?.().catch(() => undefined);
      yield* first.ask(request);
    },
    async warm() {
      await Promise.all([first.warm?.(), later.warm?.()]);
    },
    prime() {
      first.prime?.();
    },
    unprime() {
      first.unprime?.();
    },
    async close() {
      await Promise.all([first.close?.(), later.close?.()]);
    },
  };
}
