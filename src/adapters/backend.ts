import { ModelError } from './model.ts';
import type { ThreadTurn } from './model.ts';
import type { Screenshot } from './types.ts';

/** What the backend is told. The wire format is in docs/backend.md. */
export type BackendRequest = {
  question: string;
  /** The picture the model saw (with the pen stroke drawn on it, if the user circled something). */
  screenshot: Screenshot;
  /** The conversation so far: each question with the validated steps that were shown for it. */
  thread: readonly ThreadTurn[];
  /** What is on screen: the steps drawn in this thread, oldest first, and the ids in use (id: kind). */
  scene: { steps: readonly unknown[]; ids: Readonly<Record<string, string>> };
  /** Why the fast model gave up, when the user accepted its offer. */
  reason?: string;
  /** How this request came about. */
  trigger: 'offer' | 'spoken';
  signal?: AbortSignal;
};

/** What the backend answers: a scene to draw (raw, validated by the app like any model's), or only a line of text to show. */
export type BackendReply = { scene?: unknown; message?: string };

/**
 * A deeper helper the app can hand a question to: a coordinator, another assistant, a long-running
 * agent. It answers in the scene language, so the reply draws and speaks the same way as a model's.
 * Failures throw ModelError (the same codes as a model).
 */
export interface Backend {
  readonly id: string;
  ask(request: BackendRequest): Promise<BackendReply>;
}

export type HttpBackendOptions = {
  /** Where requests are posted. https, or a loopback address (http://127.0.0.1:...). */
  url: string;
  /** Give up after this long. Default 180000: a deeper helper may think for a while. */
  timeoutMs?: number;
  fetch?: typeof fetch;
};

/** The largest reply read, in bytes. */
const MAX_REPLY_BYTES = 4 * 1024 * 1024;
/** Most spoken lines kept per earlier turn, so a long thread stays a modest request. */
const MAX_SAID = 12;

/** Text from the other end that may reach the screen: control characters out, short. */
export function cleanBackendText(text: string, max = 300): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** One earlier turn as it is written down for others: the question and the lines that were spoken for it. */
export function threadEntry(turn: ThreadTurn): { question: string; said: string[]; incomplete?: true } {
  return {
    question: turn.question,
    ...(turn.incomplete ? { incomplete: true as const } : {}),
    said: turn.steps.map((s) => (s as { say?: unknown }).say).filter((t): t is string => typeof t === 'string').slice(0, MAX_SAID),
  };
}

/** The request body (the wire format of docs/backend.md). */
export function backendBody(req: BackendRequest): Record<string, unknown> {
  return {
    v: 1,
    trigger: req.trigger,
    ...(req.reason ? { reason: req.reason } : {}),
    question: req.question,
    screenshot: { mime: req.screenshot.mime, width: req.screenshot.width, height: req.screenshot.height, base64: req.screenshot.base64 },
    thread: req.thread.map(threadEntry),
    scene: { steps: req.scene.steps, ids: req.scene.ids },
  };
}

/** One body read, with an abort listener removed after this read (not one retained promise per chunk). */
function readNext(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const abort = (): void => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    reader.read().then(
      (chunk) => { signal.removeEventListener('abort', abort); resolve(chunk); },
      (error: unknown) => { signal.removeEventListener('abort', abort); reject(error); },
    );
  });
}

/** Count bytes before retaining them; a peer need not finish an over-limit reply before it is refused. */
async function readReply(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body) { signal.throwIfAborted(); return ''; }
  const reader = response.body.getReader();
  let finished = false;
  try {
    signal.throwIfAborted();
    // A bounded growing buffer avoids retaining an unbounded number of tiny chunk objects.
    let bytes = new Uint8Array(64 * 1024);
    let length = 0;
    for (;;) {
      const chunk = await readNext(reader, signal);
      signal.throwIfAborted();
      if (chunk.done) { finished = true; break; }
      const needed = length + chunk.value.byteLength;
      if (needed > MAX_REPLY_BYTES) throw new ModelError('bad-output', 'the backend sent too much');
      if (needed > bytes.length) {
        const grown = new Uint8Array(Math.min(MAX_REPLY_BYTES, Math.max(needed, bytes.length * 2)));
        grown.set(bytes.subarray(0, length));
        bytes = grown;
      }
      bytes.set(chunk.value, length);
      length = needed;
    }
    return new TextDecoder().decode(bytes.subarray(0, length));
  } finally {
    // Cancellation is local stream cleanup, not confirmation that a remote worker stopped.
    // A supplied stream's cancellation callback may never settle: do not wait on it.
    if (!finished) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/**
 * A generic HTTP backend: posts the question, the screenshot, the thread and the scene on screen as
 * JSON and expects a scene (or a message) back. Nothing about what answers is assumed. There is no
 * built-in address and nothing is sent unless the user names one in their settings.
 */
export function createHttpBackend(options: HttpBackendOptions): Backend {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const doFetch = options.fetch ?? globalThis.fetch;
  return {
    id: 'http',

    async ask(req: BackendRequest): Promise<BackendReply> {
      if (req.signal?.aborted) throw new ModelError('aborted', 'request aborted');
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
      let response: Response;
      try {
        response = await doFetch(options.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(backendBody(req)),
          redirect: 'error',
          signal,
        });
      } catch (error) {
        if (req.signal?.aborted) throw new ModelError('aborted', 'request aborted', { cause: error });
        if (timeout.aborted) throw new ModelError('failed', `no answer within ${Math.round(timeoutMs / 1000)} s`);
        throw new ModelError('unavailable', 'the backend could not be reached');
      }

      let text: string;
      try {
        text = await readReply(response, signal);
      } catch (error) {
        if (req.signal?.aborted) throw new ModelError('aborted', 'request aborted', { cause: error });
        if (timeout.aborted) throw new ModelError('failed', `no answer within ${Math.round(timeoutMs / 1000)} s`);
        if (error instanceof ModelError) throw error;
        throw new ModelError('unavailable', 'the connection to the backend was lost');
      }

      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
      const fields = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : undefined;

      if (!response.ok) {
        const said = typeof fields?.error === 'string' ? `: ${cleanBackendText(fields.error)}` : '';
        const message = `the backend answered ${response.status}${said}`;
        if (response.status === 401 || response.status === 403) throw new ModelError('auth', message);
        if (response.status === 429) throw new ModelError('rate-limited', message);
        if (response.status >= 500) throw new ModelError('unavailable', message);
        throw new ModelError('failed', message);
      }
      if (!fields) throw new ModelError('bad-output', 'the backend did not send JSON');
      if (typeof fields.error === 'string') throw new ModelError('failed', cleanBackendText(fields.error));
      const reply: BackendReply = {};
      if (fields.scene !== undefined && fields.scene !== null) reply.scene = fields.scene;
      if (typeof fields.message === 'string' && fields.message.trim()) reply.message = cleanBackendText(fields.message);
      if (reply.scene === undefined && reply.message === undefined) throw new ModelError('bad-output', 'the backend sent neither a scene nor a message');
      return reply;
    },
  };
}
