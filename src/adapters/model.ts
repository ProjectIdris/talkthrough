import type { Step } from '../scene/types.ts';
import type { Screenshot } from './types.ts';

/** One finished turn of the visual thread, so a follow-up can reach what is already on screen. */
export type ThreadTurn = {
  question: string;
  /** The validated steps that were shown for that question. */
  steps: readonly Step[];
};

export type ModelRequest = {
  question: string;
  screenshot: Screenshot;
  /** Earlier turns of the same thread, oldest first. Empty for a fresh question. */
  thread: readonly ThreadTurn[];
  /** The JSON Schema the answer must follow (the scene schema); a model that can hold output to a schema should. */
  schema: unknown;
  /** Aborting drops the request: the stream ends and no more steps are yielded. */
  signal?: AbortSignal;
};

/** What a model yields: raw (unvalidated) steps as they complete, then at most one escalation. */
export type ModelOutput = { type: 'step'; step: unknown } | { type: 'escalate'; reason: unknown };

/**
 * A vision model that answers with scene steps.
 *
 * ask() yields each step as soon as it is complete, raw and unvalidated (the scene validator owns
 * trust), as { type: 'step' }. If the model says the question is beyond it, the answer ends with one
 * { type: 'escalate' } carrying its raw reason (validate it with the scene code's validateEscalate);
 * that may come with steps or instead of them. An implementation must not give the model tools, a shell or any way to run code: the
 * answer is data only. Failures throw ModelError from the iterator.
 */
export interface Model {
  readonly id: string;
  ask(request: ModelRequest): AsyncIterable<ModelOutput>;
  /** Optional: start whatever is slow to start (a process, a connection) before the first question. */
  warm?(): Promise<void>;
  /** Optional: release it. */
  close?(): Promise<void>;
}

export type ModelErrorCode = 'unavailable' | 'auth' | 'rate-limited' | 'refused' | 'bad-output' | 'aborted' | 'failed';

export class ModelError extends Error {
  readonly code: ModelErrorCode;
  constructor(code: ModelErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ModelError';
    this.code = code;
  }
}
