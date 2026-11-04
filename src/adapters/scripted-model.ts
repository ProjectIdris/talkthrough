import { ModelError } from './model.ts';
import type { Model, ModelRequest } from './model.ts';

/**
 * A model that plays back fixed steps (and optionally an escalation) with no network: for tests, for demos, and for the renderer
 * before any real model is connected. `gapMs` spaces the steps to imitate streaming; when the request asks for pieces, each step's words and actions come first, `pieceGapMs` apart.
 */
export function createScriptedModel(steps: readonly unknown[], options: { id?: string; gapMs?: number; pieceGapMs?: number; escalate?: string } = {}): Model {
  const gapMs = options.gapMs ?? 0;
  const pieceGapMs = options.pieceGapMs ?? 0;
  return {
    id: options.id ?? 'scripted',
    async *ask(request: ModelRequest) {
      for (const step of steps) {
        if (request.signal?.aborted) throw new ModelError('aborted', 'request aborted');
        if (gapMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, gapMs));
          if (request.signal?.aborted) throw new ModelError('aborted', 'request aborted');
        }
        if (request.pieces && typeof step === 'object' && step !== null) {
          // As a streaming model would: the words, each action, then the step itself.
          const { say, actions } = step as { say?: unknown; actions?: unknown };
          if (typeof say === 'string') yield { type: 'say', say };
          if (Array.isArray(actions)) {
            for (const action of actions) {
              if (pieceGapMs > 0) await new Promise((resolve) => setTimeout(resolve, pieceGapMs));
              if (request.signal?.aborted) throw new ModelError('aborted', 'request aborted');
              yield { type: 'action', action };
            }
          }
        }
        yield { type: 'step', step };
      }
      if (options.escalate !== undefined) yield { type: 'escalate', reason: options.escalate };
    },
  };
}
