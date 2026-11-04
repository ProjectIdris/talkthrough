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
  /**
   * Set when the person circled something with the pen. `screenshot` already has the stroke drawn on it
   * (in red); `crop` is a closer, clean picture of the area around the stroke, and `box` is that area
   * on the 0..1000 scale of the whole screenshot. Marks still use the scale of the whole screenshot.
   */
  focus?: { crop: Screenshot; box: { x: number; y: number; w: number; h: number } };
  /**
   * Set for a detail pass: what is already on screen (the steps drawn so far, the ids in them). The model is asked
   * for a much richer version of the same scene, in the same language and with the same ids, instead of an answer.
   */
  detail?: { steps: readonly unknown[] };
  /** Also yield each step's say text and each of its actions as they are written, before the step (see ModelOutput). Default off. */
  pieces?: boolean;
  /** Aborting drops the request: the stream ends and no more steps are yielded. */
  signal?: AbortSignal;
};

/** What one question cost, in tokens, as the provider reports it (when it does). */
export type Usage = {
  /** All input tokens of the request, cached ones included. */
  input: number;
  /** Of those, how many were read from the provider's cache. */
  cached: number;
  /** Tokens written to a cache, where the provider says so. */
  cacheWrite?: number;
  output: number;
};

/**
 * What a model yields: raw (unvalidated) steps as they complete, then at most one escalation, and, when
 * the provider reports it, the token usage of the question (last, after the answer). When the request asks
 * for `pieces`, each step's words ('say') and each of its actions ('action') come as they are written, before
 * the step itself, which stays the boundary of the step.
 */
export type ModelOutput = { type: 'step'; step: unknown } | { type: 'say'; say: string } | { type: 'action'; action: unknown } | { type: 'escalate'; reason: unknown } | { type: 'usage'; usage: Usage };

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
  /**
   * Optional: a first question is probably coming (the key chord is complete). Get ready for it in the
   * background so it starts with the fixed prompt already loaded. Costs a call's input; unprime() or the
   * question ends it.
   */
  prime?(): void;
  /** Optional: no question is coming after all; let go of what prime() prepared. */
  unprime?(): void;
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
