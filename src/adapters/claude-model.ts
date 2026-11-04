import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sceneSchemaLean } from '../scene/schema.ts';
import { ModelError } from './model.ts';
import type { Model, ModelOutput, ModelRequest } from './model.ts';
import { AsyncQueue, childEnv, createLineSplitter, createOutputStream, questionText, resolveCommand, stopAndRemove, systemPrompt } from './subscription-shared.ts';

/**
 * A model that runs on the person's own Claude plan by starting their own, unmodified `claude`
 * command in print mode as a child process. The model is given no tools: no built-in tools, no MCP,
 * no slash commands, no settings files (so no hooks or plugins), and the session's first message,
 * which lists what is available, is checked: if it names anything but the one structured-output
 * channel the question is refused and the process killed.
 *
 * One process is kept ready (spawned ahead, waiting for its question); a question uses it once and a
 * fresh one is started for the next, so the model never carries an earlier screenshot along.
 */
export type ClaudeModelOptions = {
  /** Default claude-haiku-5-5. */
  model?: string;
  /** Default low. */
  effort?: string;
  /** Path of the claude executable; default: found on PATH. */
  command?: string;
  /** Arguments put before the flags (for tests). */
  prefixArgs?: string[];
  /**
   * The schema the answer is held to. Default: the lean scene schema (the guide in the prompt carries the
   * descriptions). It goes on the command line, which Windows limits to about 32,000 characters in all.
   */
  schema?: unknown;
  /** Give up on one answer after this long. Default 60000. */
  timeoutMs?: number;
};

type Json = Record<string, unknown>;

export function claudeArgs(model: string, effort: string, schema: unknown, promptFile: string): string[] {
  return [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--model', model,
    '--effort', effort,
    // No tools of any kind: the answer is data.
    '--tools', '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--setting-sources', '',
    '--permission-mode', 'dontAsk',
    '--no-session-persistence',
    // In a file, not on the command line: the scene guide is long and the command line is not.
    '--system-prompt-file', promptFile,
    '--json-schema', JSON.stringify(schema),
  ];
}

/** Null when the session lists nothing but the structured-output channel; otherwise what was found. */
export function initProblem(init: Json): string | null {
  const tools = Array.isArray(init.tools) ? init.tools : [];
  const odd = tools.filter((t) => t !== 'StructuredOutput');
  if (odd.length > 0) return `the session offers tools: ${odd.map(String).join(', ')}`;
  if (Array.isArray(init.mcp_servers) && init.mcp_servers.length > 0) return 'the session started MCP servers';
  if (Array.isArray(init.slash_commands) && init.slash_commands.length > 0) return 'the session offers slash commands';
  return null;
}

type Ready = { proc: ChildProcessWithoutNullStreams; key: string };

export function createClaudeModel(options: ClaudeModelOptions = {}): Model {
  const modelName = options.model ?? 'claude-haiku-5-5';
  const effort = options.effort ?? 'low';
  const schema = options.schema ?? sceneSchemaLean;
  const schemaKey = JSON.stringify(schema);
  const timeoutMs = options.timeoutMs ?? 60_000;
  let workDir: string | null = null;
  let ready: Ready | null = null;
  let closed = false;

  function launch(): Ready {
    workDir ??= mkdtempSync(join(tmpdir(), 'talkthrough-model-'));
    const promptFile = join(workDir, 'instructions.txt');
    writeFileSync(promptFile, systemPrompt());
    const proc = spawn(resolveCommand('claude', options.command), [...(options.prefixArgs ?? []), ...claudeArgs(modelName, effort, schema, promptFile)], {
      cwd: workDir,
      env: childEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    proc.stdin.on('error', () => undefined);
    proc.on('error', () => undefined); // reported by whoever uses it
    return { proc, key: schemaKey };
  }

  function take(): Ready {
    const r = ready && ready.proc.exitCode === null && !ready.proc.killed && ready.key === schemaKey ? ready : launch();
    ready = null;
    return r;
  }

  return {
    id: modelName,

    async warm() {
      if (closed) return;
      ready ??= launch();
    },

    async close() {
      closed = true;
      const proc = ready?.proc ?? null;
      const dir = workDir;
      ready = null;
      workDir = null;
      await stopAndRemove(proc, dir);
    },

    async *ask(req: ModelRequest): AsyncGenerator<ModelOutput> {
      if (req.signal?.aborted) throw new ModelError('aborted', 'request aborted');
      const { proc } = take();
      const queue = new AsyncQueue<ModelOutput>();
      const stream = createOutputStream(req.pieces === true, req.onRaw);
      let finished = false;
      let stderrTail = '';
      let streamingTool = false;
      // The API call being streamed, for the figures when the answer is taken before the command-line tool ends its own.
      let call: Json | undefined;
      let settle: ReturnType<typeof setTimeout> | undefined;

      const fail = (error: ModelError) => {
        if (finished) return;
        finished = true;
        queue.fail(error);
        proc.kill();
      };
      const feed = (text: string) => {
        try {
          for (const piece of stream.push(text)) queue.push(piece);
        } catch (error) {
          fail(new ModelError('bad-output', error instanceof Error ? error.message : String(error), { cause: error }));
        }
      };

      const usageOf = (u: Json | undefined): ModelOutput | undefined => {
        if (!u || typeof u.input_tokens !== 'number') return undefined;
        const read = typeof u.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : 0;
        const wrote = typeof u.cache_creation_input_tokens === 'number' ? u.cache_creation_input_tokens : 0;
        return { type: 'usage', usage: { input: u.input_tokens + read + wrote, cached: read, ...(wrote > 0 ? { cacheWrite: wrote } : {}), output: typeof u.output_tokens === 'number' ? u.output_tokens : 0 } };
      };
      /** The answer is whole: end the stream, offer the escalation, report the figures. */
      const complete = (u: Json | undefined): void => {
        try {
          stream.end();
        } catch (error) {
          fail(new ModelError('bad-output', error instanceof Error ? error.message : String(error), { cause: error }));
          return;
        }
        const escalate = stream.escalate;
        if (escalate && escalate.trim()) queue.push({ type: 'escalate', reason: escalate });
        const usage = usageOf(u);
        if (usage) queue.push(usage);
        finished = true;
        if (settle) clearTimeout(settle);
        queue.close();
      };

      const onEvent = (event: Json) => {
        if (finished) return;
        if (event.type === 'system' && event.subtype === 'init') {
          const problem = initProblem(event);
          if (problem) fail(new ModelError('refused', `refusing to continue: ${problem}`));
          return;
        }
        if (event.type === 'stream_event') {
          const inner = (event.event ?? {}) as Json;
          if (inner.type === 'message_start') {
            call = { ...((inner.message as Json | undefined)?.usage as Json | undefined) };
          } else if (inner.type === 'message_delta') {
            call = { ...call, ...(inner.usage as Json | undefined) };
            // The scene is whole: the command-line tool checks it against the schema and, when it does not match
            // to the letter, asks the model to write all of it again (twice more, in the runs measured), each time
            // reading the whole prompt again. Nothing of that changes what is drawn, so the answer ends here.
            if (stream.complete) complete(call);
          } else if (inner.type === 'content_block_start') {
            const block = (inner.content_block ?? {}) as Json;
            if (block.type === 'tool_use') {
              if (block.name !== 'StructuredOutput') fail(new ModelError('refused', `the model tried to use a tool (${String(block.name)})`));
              else streamingTool = true;
            }
          } else if (inner.type === 'content_block_delta') {
            const delta = (inner.delta ?? {}) as Json;
            if (delta.type === 'input_json_delta' && streamingTool && typeof delta.partial_json === 'string') {
              feed(delta.partial_json);
              // The call's closing figures come with the next event; if they do not, the answer ends anyway.
              if (stream.complete && !finished && !settle) settle = setTimeout(() => { if (!finished) complete(call); }, 400);
            }
          }
          return;
        }
        if (event.type === 'assistant') {
          const message = (event.message ?? {}) as Json;
          const content = Array.isArray(message.content) ? (message.content as Json[]) : [];
          for (const block of content) {
            if (block.type === 'tool_use' && block.name !== 'StructuredOutput') {
              fail(new ModelError('refused', `the model tried to use a tool (${String(block.name)})`));
              return;
            }
          }
          return;
        }
        if (event.type === 'result') {
          if (event.is_error === true || (typeof event.subtype === 'string' && event.subtype !== 'success')) {
            const text = typeof event.result === 'string' && event.result ? event.result : String(event.subtype ?? 'the answer failed');
            fail(errorFrom(text));
            return;
          }
          if (!stream.complete && event.structured_output !== undefined && event.structured_output !== null) feed(JSON.stringify(event.structured_output));
          if (finished) return;
          complete(event.usage as Json | undefined);
        }
      };

      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', createLineSplitter((line) => {
        try {
          onEvent(JSON.parse(line) as Json);
        } catch {
          // not JSON: ignored
        }
      }));
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (chunk: string) => {
        stderrTail = (stderrTail + chunk).slice(-2000);
      });
      proc.once('error', (error: NodeJS.ErrnoException) => {
        fail(new ModelError('unavailable', error.code === 'ENOENT' ? 'the claude command was not found' : `claude could not start: ${error.message}`, { cause: error }));
      });
      proc.once('exit', () => {
        fail(new ModelError('unavailable', `claude stopped before answering${stderrTail ? `: ${stderrTail.trim().slice(-300)}` : ''}`));
      });
      const timer = setTimeout(() => fail(new ModelError('failed', `no answer within ${(timeoutMs / 1000).toFixed(timeoutMs < 10_000 ? 1 : 0)} s`)), timeoutMs);
      const onAbort = () => fail(new ModelError('aborted', 'request aborted'));
      req.signal?.addEventListener('abort', onAbort, { once: true });

      proc.stdin.write(JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: req.screenshot.mime, data: req.screenshot.base64 } },
            ...(req.focus ? [{ type: 'image', source: { type: 'base64', media_type: req.focus.crop.mime, data: req.focus.crop.base64 } }] : []),
            { type: 'text', text: questionText(req) },
          ],
        },
      }) + '\n');

      try {
        yield* queue;
      } finally {
        clearTimeout(timer);
        if (settle) clearTimeout(settle);
        req.signal?.removeEventListener('abort', onAbort);
        finished = true;
        proc.stdin.end();
        proc.kill();
        if (!closed) ready ??= launch(); // the next question's process starts while this one is being spoken (one is enough when two calls end close together)
      }
    },
  };
}

/** Sorts a failure message from the tool into one of the error codes. */
function errorFrom(message: string): ModelError {
  const m = message.toLowerCase();
  if (m.includes('log in') || m.includes('login') || m.includes('not logged') || m.includes('authentication') || m.includes('unauthorized')) return new ModelError('auth', message);
  if (m.includes('rate limit') || m.includes('usage limit') || m.includes('limit reached') || m.includes('overloaded')) return new ModelError('rate-limited', message);
  return new ModelError('failed', message);
}
