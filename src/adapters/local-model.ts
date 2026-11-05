import { deflateSync } from 'node:zlib';
import { ModelError } from './model.ts';
import type { Model, ModelOutput, ModelRequest, Usage } from './model.ts';
import { createOutputStream, questionText, systemPrompt } from './subscription-shared.ts';

/**
 * A model that runs on this computer behind an OpenAI-compatible server (Ollama, LM Studio, llama.cpp's server and the like): the Chat
 * Completions API, streamed, with the screenshot sent as an image part. It needs a model that takes pictures (a "vision" model): every question
 * carries a screenshot. No key is used, and the address must be on this computer (see `isLoopbackUrl`), so nothing leaves it.
 *
 * The answer is held to the scene schema where the server can do that (`response_format` with a JSON schema). A server that refuses it is asked
 * once more with the schema in the prompt and plain JSON mode. The model is given no tools; the answer is data only.
 */
export type LocalModelOptions = {
  /** The server's API address, such as http://127.0.0.1:11434/v1 (Ollama) or http://127.0.0.1:1234/v1 (LM Studio). */
  baseUrl: string;
  /** The model's name on that server. */
  model: string;
  /** Give up on one answer after this long (a local model may need a while to load first). Default 120000. */
  timeoutMs?: number;
  fetch?: typeof fetch;
};

/** Only an address on this computer: the question and the screenshot never leave it. */
export function isLoopbackUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return (url.protocol === 'http:' || url.protocol === 'https:') && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]');
  } catch {
    return false;
  }
}

const trimBase = (base: string): string => base.trim().replace(/\/+$/, '');

type Part = { type: 'image_url'; image_url: { url: string } } | { type: 'text'; text: string };

function userParts(req: ModelRequest, extra?: string): Part[] {
  return [
    { type: 'image_url', image_url: { url: `data:${req.screenshot.mime};base64,${req.screenshot.base64}` } },
    ...(req.focus ?? []).map((f): Part => ({ type: 'image_url', image_url: { url: `data:${f.crop.mime};base64,${f.crop.base64}` } })),
    { type: 'text', text: extra ? `${questionText(req)}\n\n${extra}` : questionText(req) },
  ];
}

export function createLocalModel(options: LocalModelOptions): Model {
  const base = trimBase(options.baseUrl);
  const modelName = options.model;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const doFetch = options.fetch ?? globalThis.fetch;

  async function post(req: ModelRequest, signal: AbortSignal, plainJson: boolean): Promise<Response> {
    const body = {
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt() },
        { role: 'user', content: userParts(req, plainJson ? `Reply with one JSON object only, with no other text, that follows this JSON Schema: ${JSON.stringify(req.schema)}` : undefined) },
      ],
      response_format: plainJson ? { type: 'json_object' } : { type: 'json_schema', json_schema: { name: 'scene', strict: true, schema: req.schema } },
      stream: true,
      stream_options: { include_usage: true },
    };
    return doFetch(`${base}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(body), redirect: 'error', signal });
  }

  return {
    id: `local:${modelName}`,

    async *ask(req: ModelRequest): AsyncGenerator<ModelOutput> {
      if (req.signal?.aborted) throw new ModelError('aborted', 'request aborted');
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
      let response: Response;
      try {
        response = await post(req, signal, false);
        // A server that cannot hold the answer to a schema says so with a 400 or 422: once more, in plain JSON mode with the schema in the prompt.
        if (response.status === 400 || response.status === 422) {
          const first = await readError(response);
          if (looksLikePictureError(first)) throw new ModelError('failed', pictureMessage(modelName));
          response = await post(req, signal, true);
          if (!response.ok) throw await httpError(response, modelName);
        } else if (!response.ok) throw await httpError(response, modelName);
      } catch (error) {
        if (error instanceof ModelError) throw error;
        if (req.signal?.aborted) throw new ModelError('aborted', 'request aborted', { cause: error });
        if (timeout.aborted) throw new ModelError('failed', `no answer within ${Math.round(timeoutMs / 1000)} s`);
        throw new ModelError('unavailable', `the local model server could not be reached at ${base}`, { cause: error });
      }
      if (!response.body) throw new ModelError('failed', 'the local model server sent no answer');

      const stream = createOutputStream(req.pieces === true, req.onRaw);
      let finished = false;
      let usage: Usage | undefined;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';

      /** One server-sent event: the outputs it completed; throws on an error event. */
      const handle = (data: string): ModelOutput[] => {
        if (data === '[DONE]') {
          finished = true;
          return [];
        }
        let event: { error?: { message?: string }; choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>; usage?: { prompt_tokens?: number; completion_tokens?: number } | null };
        try {
          event = JSON.parse(data) as typeof event;
        } catch {
          return [];
        }
        if (event.error) throw new ModelError('failed', String(event.error.message ?? 'the local model server reported an error').slice(0, 300));
        const u = event.usage;
        if (u && typeof u.prompt_tokens === 'number') usage = { input: u.prompt_tokens, cached: 0, output: u.completion_tokens ?? 0 };
        const choice = event.choices?.[0];
        if (!choice) return [];
        let out: ModelOutput[] = [];
        if (typeof choice.delta?.content === 'string' && choice.delta.content) out = stream.push(choice.delta.content);
        if (choice.finish_reason === 'length') throw new ModelError('bad-output', 'the answer was cut short (the model ran out of room)');
        if (choice.finish_reason) finished = true;
        return out;
      };

      try {
        for (;;) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try {
            chunk = await reader.read();
          } catch (error) {
            if (req.signal?.aborted) throw new ModelError('aborted', 'request aborted', { cause: error });
            if (timeout.aborted) throw new ModelError('failed', 'the answer took too long');
            throw new ModelError('unavailable', 'the connection to the local model server was lost');
          }
          if (chunk.done) break;
          pending += decoder.decode(chunk.value, { stream: true });
          let at: number;
          while ((at = pending.search(/\r?\n\r?\n/)) >= 0) {
            const block = pending.slice(0, at);
            pending = pending.slice(at).replace(/^\r?\n\r?\n/, '');
            const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
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
        if (!finished) throw new ModelError('unavailable', 'the answer ended before it was complete');
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

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } | string; message?: string };
    const text = typeof body.error === 'string' ? body.error : body.error?.message ?? body.message;
    return typeof text === 'string' ? text.slice(0, 300) : '';
  } catch {
    return '';
  }
}

const looksLikePictureError = (message: string): boolean => /image|vision|multimodal|multi-modal|visual/i.test(message) && /not support|unsupported|cannot|can't|does not|doesn't|no support|only text|invalid/i.test(message);
const pictureMessage = (name: string): string => `the model ${name} does not take pictures, and every question carries a screenshot: choose a vision model`;

async function httpError(response: Response, modelName: string): Promise<ModelError> {
  const detail = await readError(response);
  const message = `the local model server answered ${response.status}${detail ? `: ${detail}` : ''}`;
  if (looksLikePictureError(detail)) return new ModelError('failed', pictureMessage(modelName));
  if (response.status === 404) return new ModelError('unavailable', `${message} (is the model name right, and loaded?)`);
  if (response.status === 401 || response.status === 403) return new ModelError('auth', message);
  if (response.status === 429) return new ModelError('rate-limited', message);
  if (response.status >= 500) return new ModelError('unavailable', message);
  return new ModelError('failed', message);
}

// ---- Test connection -----------------------------------------------------------------------------------------------------------------------

export type LocalTest = { ok: true; message: string } | { ok: false; message: string };

/** A small solid-colour PNG, made here so the test needs no file: a vision model is shown it to prove the server takes pictures. */
export function tinyPng(size = 64): string {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) {
    row[1 + x * 3] = 235;
    row[2 + x * 3] = 245;
    row[3 + x * 3] = 255;
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return png.toString('base64');
}

/**
 * The "test connection" button: is the server there, does it list the model, and does it take a picture. Each answer says what to do next. It
 * sends a tiny generated picture and one word of question; nothing of the person's is sent.
 */
export async function testLocalModel(options: { baseUrl: string; model: string; fetch?: typeof fetch; listTimeoutMs?: number; askTimeoutMs?: number }): Promise<LocalTest> {
  const base = trimBase(options.baseUrl);
  const doFetch = options.fetch ?? globalThis.fetch;
  if (!isLoopbackUrl(base)) return { ok: false, message: 'The address must be on this computer, such as http://127.0.0.1:11434/v1.' };
  if (!options.model.trim()) return { ok: false, message: 'Type the name of the model first.' };
  const name = options.model.trim();
  let listed: string[] | undefined;
  try {
    const response = await doFetch(`${base}/models`, { redirect: 'error', signal: AbortSignal.timeout(options.listTimeoutMs ?? 5000) });
    if (response.ok) {
      const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
      if (Array.isArray(body.data)) listed = body.data.map((m) => m.id).filter((id): id is string => typeof id === 'string');
    }
  } catch {
    return { ok: false, message: `Could not reach a server at ${base}. Is it running, and is the address right (it usually ends in /v1)?` };
  }
  if (listed && listed.length > 0 && !listed.includes(name) && !listed.includes(`${name}:latest`)) {
    return { ok: false, message: `Reached the server, but it has no model called ${name}. It has: ${listed.slice(0, 6).join(', ')}${listed.length > 6 ? ', …' : ''}.` };
  }
  try {
    const response = await doFetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(options.askTimeoutMs ?? 90_000),
      body: JSON.stringify({
        model: name,
        max_tokens: 8,
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${tinyPng()}` } }, { type: 'text', text: 'Reply with the single word ok.' }] }],
      }),
    });
    if (response.ok) return { ok: true, message: `Works: ${name} answered, and it took a picture.` };
    const detail = await readError(response);
    if (looksLikePictureError(detail)) return { ok: false, message: `Reached the server, but ${name} does not take pictures. Talkthrough sends a screenshot with every question, so choose a model with vision.` };
    if (response.status === 404) return { ok: false, message: `Reached the server, but it does not know a model called ${name}.` };
    return { ok: false, message: `Reached the server, but it answered ${response.status}${detail ? `: ${detail}` : ''}.` };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return { ok: false, message: timedOut ? `Reached the server, but ${name} took too long to answer. It may still be loading: try again in a moment.` : `Reached the server, but the test question failed.` };
  }
}
