import { ModelError } from './model.ts';
import type { Model, ModelRequest } from './model.ts';

/**
 * A model that plays back fixed steps (and optionally an escalation) with no network: for tests, for demos, and for the renderer
 * before any real model is connected. `gapMs` spaces the steps to imitate streaming.
 */
export function createScriptedModel(steps: readonly unknown[], options: { id?: string; gapMs?: number; escalate?: string } = {}): Model {
  const gapMs = options.gapMs ?? 0;
  return {
    id: options.id ?? 'scripted',
    async *ask(request: ModelRequest) {
      for (const step of steps) {
        if (request.signal?.aborted) throw new ModelError('aborted', 'request aborted');
        if (gapMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, gapMs));
          if (request.signal?.aborted) throw new ModelError('aborted', 'request aborted');
        }
        yield { type: 'step', step };
      }
      if (options.escalate !== undefined) yield { type: 'escalate', reason: options.escalate };
    },
  };
}
