import type { Step } from '../scene/types.ts';
import type { Screenshot } from './types.ts';

/** One thing the person marked with the pen: a closer picture of it, where it is, and what kind of mark it was. */
export type FocusCrop = {
  crop: Screenshot;
  box: { x: number; y: number; w: number; h: number };
  /** Default: a circle. */
  kind?: 'circle' | 'underline' | 'arrow' | 'picture';
  /** For a closer picture of an enlargement: where the enlargement card's picture is drawn on the screenshot (0..1000), the rectangle its points are written in. */
  card?: { x: number; y: number; w: number; h: number };
  /** For a closer picture with a lettered and numbered grid drawn on it: its columns (A..) and rows (1..). */
  grid?: { cols: number; rows: number };
  /** A circle that was gone round more than once. */
  loops?: number;
  /** A circle that was not closed. */
  open?: boolean;
};

/** One finished turn of the visual thread, so a follow-up can reach what is already on screen. */
export type ThreadTurn = {
  question: string;
  /** The validated steps that were shown for that question. */
  steps: readonly Step[];
  /** A detail pass: a richer version of the scene as it stood, replacing what the turns before it drew (the ids it writes again are swapped in place). */
  detail?: true;
};

export type ModelRequest = {
  question: string;
  screenshot: Screenshot;
  /** Earlier turns of the same thread, oldest first. Empty for a fresh question. */
  thread: readonly ThreadTurn[];
  /** The JSON Schema the answer must follow (the scene schema); a model that can hold output to a schema should. */
  schema: unknown;
  /**
   * Set when the person marked something with the pen (up to three things, in the order drawn). `screenshot` already has the strokes
   * drawn on it (in red, numbered when there is more than one); each `crop` is a closer, clean picture of what that mark is on (the whole
   * block, figure or words the rough stroke covers, not just the stroke's box), and `box` is that area on the 0..1000 scale of the whole
   * screenshot. Marks still use the scale of the whole screenshot.
   */
  focus?: readonly FocusCrop[];
  /**
   * The part of the screenshot (a 0..1000 box) cut from the full-resolution frame, as a closer picture; null when the frame is gone. Absent when
   * this build cannot. The step-by-step model uses it to give the step after an enlargement a sharp picture of what was enlarged.
   */
  cropOf?(box: { x: number; y: number; w: number; h: number }): Promise<(Screenshot & { grid?: { cols: number; rows: number } }) | null>;
  /**
   * Set for a detail pass: what is already on screen (the steps drawn so far, the ids in them). The model is asked
   * for a much richer version of the same scene, in the same language and with the same ids, instead of an answer.
   */
  detail?: { steps: readonly unknown[] };
  /**
   * One half of a quick answer written in two calls (see two-step.ts). `first`: write step 1 and nothing after it. `rest`: step 1 is
   * already drawn and spoken (given raw, or, when `first` is absent, being written at the same time by the other call); write the steps after it. Absent: the whole answer. Not used with `detail`.
   */
  stage?: { part: 'first'; plan?: true } | { part: 'rest'; first?: unknown } | { part: 'next'; /** The number of the step to write (2 or more). */ n: number; /** The steps written so far, raw. */ shown: readonly unknown[]; /** The titles of the steps still to come, the next one first. */ plan: readonly string[]; /** The first call gave no plan: this one is asked whether the answer goes on (a step, and a plan for the rest) or is whole (no step, done). */ unplanned?: true; /** The picture is the screen as it is now, after the person followed the step before (not the one the earlier steps were made from). */ fresh?: true };
  /** Also yield each step's say text and each of its actions as they are written, before the step (see ModelOutput). Default off. */
  pieces?: boolean;
  /** Called once with the model's whole raw text when its answer ends or turns out not to be a scene (a check run's log). Default off. */
  onRaw?: (text: string) => void;
  /**
   * For an answer written one step to a call (step-by-step.ts): asked after a step that ends on a wait for the person's click, before the call for
   * the next step. `waits` is how many steps so far end on such a wait. It answers with the screen as it is after the click (the next call
   * is made from that picture), 'go' to carry on at once with the picture it has, or 'stop' when the walk is over or its plan has been replaced.
   */
  afterStep?: (info: { waits: number; signal: AbortSignal }) => Promise<{ screenshot: Screenshot } | 'go' | 'stop'>;
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
