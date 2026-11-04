import { ModelError } from './model.ts';
import type { Model, ModelOutput, ModelRequest, Usage } from './model.ts';
import { createOutputStream, questionText, systemPrompt } from './subscription-shared.ts';

/**
 * A model that calls the OpenAI Responses API directly with an API key the person provides. The reply
 * is streamed (server-sent events) and held to the scene schema with strict structured outputs; each
 * finished step is yielded as soon as it is complete. Nothing is stored on the provider's side
 * (`store: false`). The model is given no tools, so the answer is data only.
 *
 * The key is read through `apiKey()` for every question, so it can be set or changed while the app runs.
 * It is only ever sent as the `Authorization` header: it is never logged, and any text taken from the
 * server's error messages is stripped of anything that looks like a key before it is shown.
 */
export type OpenAIModelOptions = {
  /** Returns the key, or undefined when none is set. Called for each question. */
  apiKey: () => string | undefined;
  /** Default gpt-6-luna. */
  model?: string;
  /** Reasoning effort. Default low. */
  effort?: string;
  /** The API's base address; default https://api.openai.com/v1. A compatible server can be named here. */
  baseUrl?: string;
  /** A service tier such as "fast", if the person wants one (it costs more). Unset: the provider's default. */
  serviceTier?: string;
  /** Give up on one answer after this long. Default 60000. */
  timeoutMs?: number;
  fetch?: typeof fetch;
};

const DEFAULT_BASE = 'https://api.openai.com/v1';
/** The exact message of the error for a missing key (a wrong key gets the provider's own message). */
export const NO_KEY_MESSAGE = 'no API key is set';

/** Removes anything that looks like an API key, and the key itself, from text that may reach a screen or a log. */
export function redactKeys(text: string, key?: string): string {
  let out = text;
  if (key) out = out.split(key).join('[key]');
  return out.replace(/sk-[A-Za-z0-9_\-*.]{6,}/g, '[key]');
}

export function createOpenAIModel(options: OpenAIModelOptions): Model {
  const modelName = options.model ?? 'gpt-6-luna';
  const effort = options.effort ?? 'low';
  const base = (options.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 60_000;
  const doFetch = options.fetch ?? globalThis.fetch;

  return {
    id: `openai:${modelName}`,

    async *ask(req: ModelRequest): AsyncGenerator<ModelOutput> {
      if (req.signal?.aborted) throw new ModelError('aborted', 'request aborted');
      const key = options.apiKey();
      if (!key) throw new ModelError('auth', NO_KEY_MESSAGE);

      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
      const body = {
        model: modelName,
        instructions: systemPrompt(),
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_image', image_url: `data:${req.screenshot.mime};base64,${req.screenshot.base64}` },
              ...(req.focus ? [{ type: 'input_image', image_url: `data:${req.focus.crop.mime};base64,${req.focus.crop.base64}` }] : []),
              { type: 'input_text', text: questionText(req) },
            ],
          },
        ],
        text: { format: { type: 'json_schema', name: 'scene', strict: true, schema: req.schema } },
        reasoning: { effort },
        stream: true,
        store: false,
        ...(options.serviceTier ? { service_tier: options.serviceTier } : {}),
      };

      let response: Response;
      try {
        response = await doFetch(`${base}/responses`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${key}` },
          body: JSON.stringify(body),
          // A key must never ride a redirect.
          redirect: 'error',
          signal,
        });
      } catch (error) {
        if (req.signal?.aborted) throw new ModelError('aborted', 'request aborted', { cause: error });
        if (timeout.aborted) throw new ModelError('failed', `no answer within ${(timeoutMs / 1000).toFixed(timeoutMs < 10_000 ? 1 : 0)} s`);
        throw new ModelError('unavailable', 'the API could not be reached');
      }
      if (!response.ok) throw await httpError(response, key);
      if (!response.body) throw new ModelError('failed', 'the API sent no answer');

      const stream = createOutputStream(req.pieces === true, req.onRaw);
      let completed = false;
      let usage: Usage | undefined;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';

      /** One server-sent event: returns the outputs it completed; throws on an error event. */
      const handle = (data: string): ModelOutput[] => {
        if (data === '[DONE]') return [];
        let event: { type?: string; delta?: string; refusal?: string; error?: { message?: string }; response?: { error?: { message?: string }; incomplete_details?: { reason?: string }; usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } } };
        try {
          event = JSON.parse(data) as typeof event;
        } catch {
          return [];
        }
        switch (event.type) {
          case 'response.output_text.delta':
            return typeof event.delta === 'string' ? stream.push(event.delta) : [];
          case 'response.refusal.delta':
          case 'response.refusal.done':
            throw new ModelError('refused', 'the model declined to answer');
          case 'response.completed': {
            completed = true;
            const u = event.response?.usage;
            if (u && typeof u.input_tokens === 'number') usage = { input: u.input_tokens, cached: u.input_tokens_details?.cached_tokens ?? 0, output: u.output_tokens ?? 0 };
            return [];
          }
          case 'response.incomplete':
            throw new ModelError('bad-output', `the answer was cut short (${event.response?.incomplete_details?.reason ?? 'incomplete'})`);
          case 'response.failed':
            throw sortError(event.response?.error?.message ?? 'the answer failed', key);
          case 'error':
            throw sortError(event.error?.message ?? 'the API reported an error', key);
          default:
            return [];
        }
      };

      try {
        for (;;) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try {
            chunk = await reader.read();
          } catch (error) {
            if (req.signal?.aborted) throw new ModelError('aborted', 'request aborted', { cause: error });
            if (timeout.aborted) throw new ModelError('failed', 'the answer took too long');
            throw new ModelError('unavailable', 'the connection to the API was lost');
          }
          if (chunk.done) break;
          pending += decoder.decode(chunk.value, { stream: true });
          let at: number;
          while ((at = pending.indexOf('\n\n')) >= 0) {
            const block = pending.slice(0, at);
            pending = pending.slice(at + 2);
            const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
            if (!data) continue;
            let outputs: ModelOutput[];
            try {
              outputs = handle(data);
            } catch (error) {
              if (error instanceof ModelError) throw error;
              throw new ModelError('bad-output', error instanceof Error ? error.message : String(error), { cause: error });
            }
            for (const piece of outputs) yield piece;
          }
        }
        if (!completed) throw new ModelError('unavailable', 'the answer ended before it was complete');
        try {
          stream.end();
        } catch (error) {
          throw new ModelError('bad-output', error instanceof Error ? error.message : String(error), { cause: error });
        }
        const escalate = stream.escalate;
        if (escalate && escalate.trim()) yield { type: 'escalate', reason: escalate };
        if (usage) yield { type: 'usage', usage };
      } finally {
        void reader.cancel().catch(() => undefined);
      }
    },
  };
}

async function httpError(response: Response, key: string): Promise<ModelError> {
  let message = `the API answered ${response.status}`;
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (typeof body.error?.message === 'string') message = `${message}: ${redactKeys(body.error.message, key).slice(0, 300)}`;
  } catch {
    // no readable body: the status says enough
  }
  if (response.status === 401 || response.status === 403) return new ModelError('auth', message);
  if (response.status === 429) return new ModelError('rate-limited', message);
  if (response.status >= 500) return new ModelError('unavailable', message);
  return new ModelError('failed', message);
}

function sortError(message: string, key: string): ModelError {
  const clean = redactKeys(message, key).slice(0, 300);
  const m = clean.toLowerCase();
  if (m.includes('api key') || m.includes('unauthorized') || m.includes('authentication')) return new ModelError('auth', clean);
  if (m.includes('rate limit') || m.includes('quota')) return new ModelError('rate-limited', clean);
  return new ModelError('failed', clean);
}
