import type { ThreadTurn } from './model.ts';
import type { Screenshot } from './types.ts';

export type BackendRequest = {
  question: string;
  screenshot: Screenshot;
  thread: readonly ThreadTurn[];
  signal?: AbortSignal;
};

export type BackendReceipt = {
  /** True when the other end took the request. */
  accepted: boolean;
  /** A short note for the user, e.g. why it was not accepted. */
  detail?: string;
};

/**
 * Hands the screenshot and the question to something else (another assistant, a coordinator).
 * Whatever answers comes back through that other end, not through this interface.
 */
export interface Backend {
  readonly id: string;
  send(request: BackendRequest): Promise<BackendReceipt>;
}

/** The default: nothing configured, nothing sent. */
export function createStubBackend(): Backend {
  return {
    id: 'none',
    async send() {
      return { accepted: false, detail: 'No backend is configured.' };
    },
  };
}
