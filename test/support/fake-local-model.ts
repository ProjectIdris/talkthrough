// A stand-in for an OpenAI-compatible server on this computer (Ollama, LM Studio): /v1/models and /v1/chat/completions, streamed. Records what it was sent.
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export type Sent = { method: string | undefined; url: string | undefined; headers: Record<string, string | string[] | undefined>; body: Record<string, any> | null };
export type FakeLocal = {
  baseUrl: string;
  sent: Sent[];
  close(): Promise<void>;
};
export type FakeLocalOptions = {
  /** What /v1/models lists; null: the route does not exist. */
  models?: string[] | null;
  /** The text the model "writes", sent in pieces. */
  reply?: string;
  /** End without a finish reason or the final marker. */
  unfinished?: boolean;
  eventError?: string;
  finishReason?: string;
  /** Send a terminal [DONE] without a finish-reason event. */
  doneOnly?: boolean;
  /** A non-streaming HTTP success, a redirect, or an answer that never ends. */
  responseBody?: string;
  redirect?: string;
  stall?: boolean;
  /** Answer a call of chat/completions (1-based) with this status and error message instead. */
  fail?: (call: number, body: Record<string, any> | null) => { status: number; message: string } | undefined;
};

export async function startFakeLocal(options: FakeLocalOptions = {}): Promise<FakeLocal> {
  const sent: Sent[] = [];
  let calls = 0;
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      let body: Record<string, any> | null = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, any>;
      } catch {
        body = null;
      }
      sent.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (req.url === '/v1/models') {
        if (options.models === null) return void (res.writeHead(404), res.end());
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return void res.end(JSON.stringify({ object: 'list', data: (options.models ?? ['vision-model']).map((id) => ({ id, object: 'model' })) }));
      }
      if (req.url === '/v1/chat/completions') {
        if (options.redirect) return void (res.writeHead(307, { Location: options.redirect }), res.end());
        if (options.responseBody !== undefined) return void (res.writeHead(200, { 'Content-Type': 'text/html' }), res.end(options.responseBody));
        if (options.stall) return void (res.writeHead(200, { 'Content-Type': 'text/event-stream' }), res.flushHeaders());
        const failure = options.fail?.(++calls, body);
        if (failure) {
          res.writeHead(failure.status, { 'Content-Type': 'application/json' });
          return void res.end(JSON.stringify({ error: { message: failure.message } }));
        }
        if (body?.stream !== true) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return void res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }));
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const text = options.reply ?? '';
        for (let i = 0; i < text.length; i += 23) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + 23) }, finish_reason: null }] })}\n\n`);
        if (options.unfinished) return void res.end();
        if (options.eventError) res.write(`data: ${JSON.stringify({ error: { message: options.eventError } })}\n\n`);
        if (!options.doneOnly) res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: options.finishReason ?? 'stop' }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 1200, completion_tokens: 80 } })}\n\n`);
        res.write('data: [DONE]\n\n');
        return void res.end();
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    sent,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
