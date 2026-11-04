import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sceneSchemaLean } from '../scene/schema.ts';
import { createStepStream } from '../scene/stream.ts';
import type { StepStream } from '../scene/stream.ts';
import { ModelError } from './model.ts';
import type { Model, ModelOutput, ModelRequest, Usage } from './model.ts';
import { AsyncQueue, childEnv, createLineSplitter, questionText, resolveCommand, stopAndRemove, systemPrompt } from './subscription-shared.ts';

/**
 * A model that runs on the person's own ChatGPT plan by starting their `codex app-server` as a child
 * process. The model is given no tools: the sandbox is read-only, nothing may ask for approval, the
 * tool features are switched off, the working directory is an empty folder of our own, and any tool,
 * command, file or web item that still shows up in the event stream ends the question at once.
 *
 * Fast mode, when asked for, is set only on this child process (`-c service_tier="fast"`); the shared
 * Codex configuration is never read for it or changed. One process is kept between questions; each
 * question is its own throwaway thread.
 */
export type CodexModelOptions = {
  /** Model name in the user's Codex catalog. Default gpt-6-luna. */
  model?: string;
  /** Use Fast mode (more speed, more of the plan's allowance). Default false. */
  fast?: boolean;
  /** Reasoning effort. Default low. */
  effort?: string;
  /** Path of the codex executable; default: found on PATH. */
  command?: string;
  /** Arguments put before `app-server` (for tests). */
  prefixArgs?: string[];
  /** Give up on one answer after this long. Default 60000. */
  timeoutMs?: number;
  /**
   * Keep the thread open between a question and its follow-ups: the fixed instructions then go once
   * and the provider can cache everything before the new question. A question that is not a follow-up
   * (an empty thread in the request) still starts a fresh thread, so an old screenshot is never carried.
   */
  keepThread?: boolean;
  /**
   * Allow prime(): a spare thread is started and loaded with the fixed instructions (one small turn that
   * answers with nothing) while the person is still speaking, so their first question reads the
   * instructions from the provider's cache instead of paying for them in full. Default false.
   */
  prime?: boolean;
  /** Replaces the instructions (default: the scene guide). For measuring what Codex adds on its own. */
  instructions?: string;
  /** The schema the primer uses; it must be the one questions use or the spare is not taken. Default the lean scene schema. */
  primeSchema?: unknown;
  /** How long an open thread waits for a follow-up before it is let go (and its screenshots with it). Default 20000. */
  keepThreadMs?: number;
  /** Config overrides for each thread (the same keys `-c` takes), for trying what trims the prompt. */
  threadConfig?: Record<string, unknown>;
  /** One-line facts about what the process reported (tier, model), for the app's log. */
  log?: (line: string) => void;
};

/** What the model may show in the event stream. Anything else is a tool and ends the question. */
const HARMLESS_ITEMS = new Set(['userMessage', 'agentMessage', 'reasoning', 'plan', 'hookPrompt', 'contextCompaction']);

/** Features switched off on our own child process: everything that lets the model act. */
const DISABLED_FEATURES = ['shell_tool', 'unified_exec', 'apps', 'plugins', 'multi_agent', 'view_image', 'image_generation', 'browser_use', 'computer_use'];

type Json = Record<string, unknown>;
type Waiter = { proc: ChildProcessWithoutNullStreams; resolve: (value: Json) => void; reject: (error: Error) => void };
type Turn = { proc?: ChildProcessWithoutNullStreams; queue: AsyncQueue<ModelOutput>; stream: StepStream; threadId: string; turnId?: string; done: boolean; firstDeltaAt?: number; usage?: Usage };

export function codexLockdownArgs(fast: boolean): string[] {
  const args = ['-c', 'web_search="disabled"'];
  for (const f of DISABLED_FEATURES) args.push('--disable', f);
  if (fast) args.push('-c', 'service_tier="fast"');
  return args;
}

export function createCodexModel(options: CodexModelOptions = {}): Model & { readonly serviceTier: string | undefined } {
  const modelName = options.model ?? 'gpt-6-luna';
  const fast = options.fast === true;
  const effort = options.effort ?? 'low';
  const timeoutMs = options.timeoutMs ?? 60_000;
  const log = options.log ?? (() => undefined);

  let workDir: string | null = null;
  let child: ChildProcessWithoutNullStreams | null = null;
  let starting: Promise<ChildProcessWithoutNullStreams> | null = null;
  let nextId = 1;
  /** The open thread a follow-up may continue (only with keepThread), and how many turns it holds. */
  let kept: { threadId: string; turns: number; proc: ChildProcessWithoutNullStreams } | null = null;
  let keptTimer: NodeJS.Timeout | undefined;
  const letGo = () => {
    clearTimeout(keptTimer);
    const old = kept;
    kept = null;
    if (old) void request(old.proc, 'thread/unsubscribe', { threadId: old.threadId }).catch(() => undefined);
  };
  /** A thread being loaded with the instructions for the first question (only with prime). `ready` gives its thread once the primer turn is done, or null if that failed. */
  type Primed = { proc: ChildProcessWithoutNullStreams; threadId: string };
  let spare: { ready: Promise<Primed | null>; schemaKey: string } | null = null;
  let spareTimer: NodeJS.Timeout | undefined;
  const primeCounts = { primed: 0, used: 0, late: 0, abandoned: 0 };
  const primeLine = (what: string) => log(`codex prime ${what} (${primeCounts.primed} primed, ${primeCounts.used} used, ${primeCounts.late} late, ${primeCounts.abandoned} abandoned)`);
  /** Lets go of the spare thread, counting why (null: not counted, e.g. it never got ready). */
  const dropSpare = (why: 'abandoned' | 'late' | null) => {
    clearTimeout(spareTimer);
    const old = spare;
    spare = null;
    if (!old) return;
    if (why) {
      primeCounts[why]++;
      primeLine(why);
    }
    void old.ready.then((p) => {
      if (p) void request(p.proc, 'thread/unsubscribe', { threadId: p.threadId }).catch(() => undefined);
    });
  };
  let serviceTier: string | undefined;
  const waiters = new Map<number, Waiter>();
  const turns = new Map<string, Turn>(); // by thread id
  let stderrTail = '';

  const send = (proc: ChildProcessWithoutNullStreams, message: Json) => {
    proc.stdin.write(JSON.stringify(message) + '\n');
  };

  const request = (proc: ChildProcessWithoutNullStreams, method: string, params: Json): Promise<Json> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      waiters.set(id, { proc, resolve, reject });
      send(proc, { id, method, params });
    });

  function failTurn(turn: Turn, error: ModelError): void {
    if (turn.done) return;
    turn.done = true;
    turn.queue.fail(error);
  }

  function stopTurn(proc: ChildProcessWithoutNullStreams, turn: Turn): void {
    if (turn.turnId) void request(proc, 'turn/interrupt', { threadId: turn.threadId, turnId: turn.turnId }).catch(() => undefined);
  }

  function onMessage(proc: ChildProcessWithoutNullStreams, message: Json): void {
    const id = message.id;
    const method = message.method;
    if (typeof id === 'number' && typeof method !== 'string') {
      const waiter = waiters.get(id);
      if (!waiter) return;
      waiters.delete(id);
      const error = message.error as Json | undefined;
      if (error) waiter.reject(new Error(String(error.message ?? 'request failed')));
      else waiter.resolve((message.result ?? {}) as Json);
      return;
    }
    if (typeof method !== 'string') return;
    const params = (message.params ?? {}) as Json;
    const turn = typeof params.threadId === 'string' ? turns.get(params.threadId) : undefined;

    if (id !== undefined) {
      // The server asks us for something (an approval, a tool result): this model never agrees.
      send(proc, { id, error: { code: -32601, message: 'not supported' } });
      if (turn) {
        failTurn(turn, new ModelError('refused', `the model asked for ${method}, which is not allowed`));
        stopTurn(proc, turn);
      }
      return;
    }
    if (!turn) return;

    switch (method) {
      case 'thread/tokenUsage/updated': {
        const tu = ((params.tokenUsage ?? {}) as Json).last as Json | undefined;
        if (tu && typeof tu.inputTokens === 'number') {
          turn.usage = {
            input: tu.inputTokens,
            cached: typeof tu.cachedInputTokens === 'number' ? tu.cachedInputTokens : 0,
            ...(typeof tu.cacheWriteInputTokens === 'number' && tu.cacheWriteInputTokens > 0 ? { cacheWrite: tu.cacheWriteInputTokens } : {}),
            output: typeof tu.outputTokens === 'number' ? tu.outputTokens : 0,
          };
          log(`codex tokens: ${turn.usage.input} in (${turn.usage.cached} cached), ${turn.usage.output} out`);
        }
        break;
      }
      case 'turn/started': {
        const t = params.turn as Json | undefined;
        if (t && typeof t.id === 'string') turn.turnId = t.id;
        break;
      }
      case 'item/started':
      case 'item/completed': {
        const item = params.item as Json | undefined;
        const type = item && typeof item.type === 'string' ? item.type : '';
        if (!HARMLESS_ITEMS.has(type)) {
          failTurn(turn, new ModelError('refused', `the model tried to use a tool (${type || 'unknown item'})`));
          stopTurn(proc, turn);
        }
        break;
      }
      case 'item/agentMessage/delta': {
        if (turn.done || typeof params.delta !== 'string') break;
        turn.firstDeltaAt ??= performance.now();
        try {
          for (const step of turn.stream.push(params.delta)) turn.queue.push({ type: 'step', step });
        } catch (error) {
          failTurn(turn, new ModelError('bad-output', error instanceof Error ? error.message : String(error), { cause: error }));
          stopTurn(proc, turn);
        }
        break;
      }
      case 'error': {
        if (params.willRetry === true) break;
        const e = params.error as Json | undefined;
        failTurn(turn, errorFrom(String(e?.message ?? 'the model reported an error')));
        break;
      }
      case 'turn/completed': {
        const t = (params.turn ?? {}) as Json;
        if (t.status === 'failed') {
          const e = t.error as Json | undefined;
          failTurn(turn, errorFrom(String(e?.message ?? 'the answer failed')));
          break;
        }
        if (t.status === 'interrupted') {
          failTurn(turn, new ModelError('aborted', 'the answer was interrupted'));
          break;
        }
        if (turn.done) break;
        try {
          turn.stream.end();
        } catch (error) {
          failTurn(turn, new ModelError('bad-output', error instanceof Error ? error.message : String(error), { cause: error }));
          break;
        }
        const escalate = turn.stream.escalate;
        if (escalate && escalate.trim()) turn.queue.push({ type: 'escalate', reason: escalate });
        if (turn.usage) turn.queue.push({ type: 'usage', usage: turn.usage });
        turn.done = true;
        turn.queue.close();
        break;
      }
      default:
        break;
    }
  }

  function onExit(proc: ChildProcessWithoutNullStreams): void {
    if (child === proc) {
      child = null;
      starting = null;
    }
    const error = new ModelError('unavailable', `codex stopped${stderrTail ? `: ${stderrTail.trim().slice(-300)}` : ''}`);
    for (const [id, waiter] of waiters) {
      if (waiter.proc !== proc) continue;
      waiters.delete(id);
      waiter.reject(error);
    }
    for (const turn of turns.values()) if (turn.proc === proc) failTurn(turn, error);
  }

  /** Starts one `codex app-server` process (with the given extra arguments) and finishes the handshake. */
  async function startProcess(extra: string[]): Promise<ChildProcessWithoutNullStreams> {
    workDir ??= mkdtempSync(join(tmpdir(), 'talkthrough-model-'));
    const command = resolveCommand('codex', options.command);
    const proc = spawn(command, [...(options.prefixArgs ?? []), 'app-server', ...codexLockdownArgs(fast), ...extra], {
      cwd: workDir,
      env: childEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const failed = new Promise<never>((_, reject) => {
      proc.once('error', (error: NodeJS.ErrnoException) => {
        reject(new ModelError('unavailable', error.code === 'ENOENT' ? 'the codex command was not found' : `codex could not start: ${error.message}`, { cause: error }));
      });
    });
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', createLineSplitter((line) => {
      try {
        onMessage(proc, JSON.parse(line) as Json);
      } catch {
        // a line that is not JSON is ignored
      }
    }));
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-2000);
    });
    proc.on('exit', () => onExit(proc));
    proc.stdin.on('error', () => undefined);
    child = proc;
    await Promise.race([request(proc, 'initialize', { clientInfo: { name: 'talkthrough', title: 'Talkthrough', version: '0.0.0' } }), failed]);
    send(proc, { method: 'initialized' });
    return proc;
  }

  /** The tool servers (MCP) in the person's own Codex setup, by name; only the enabled ones if asked. */
  async function toolServers(proc: ChildProcessWithoutNullStreams, enabledOnly: boolean): Promise<string[]> {
    let config: Json;
    try {
      config = await request(proc, 'config/read', { includeLayers: false });
    } catch (error) {
      throw new ModelError('unavailable', `could not check the tool servers in your Codex setup: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    const servers = ((config.config as Json | undefined)?.mcp_servers ?? {}) as Record<string, Json | null>;
    return Object.entries(servers).filter(([, v]) => !enabledOnly || v?.enabled !== false).map(([name]) => name);
  }

  /**
   * Starts the process the model runs in. A person's own Codex setup may list tool servers (which a
   * model could call); a configuration override cannot remove them, only switch each off by name. So
   * the first process only reads the list, then a second starts with every listed server switched off,
   * and the question is refused if any is still on.
   */
  async function ensure(): Promise<ChildProcessWithoutNullStreams> {
    if (child) return child;
    if (starting) return starting;
    starting = (async () => {
      let proc = await startProcess([]);
      const names = await toolServers(proc, false);
      if (names.length > 0) {
        child = null;
        proc.kill();
        proc = await startProcess(names.flatMap((name) => ['-c', `mcp_servers.${tomlKey(name)}.enabled=false`]));
        const still = await toolServers(proc, true);
        if (still.length > 0) {
          child = null;
          proc.kill();
          throw new ModelError('refused', `could not switch off the tool servers in your Codex setup (${still.join(', ')})`);
        }
      }
      return proc;
    })();
    try {
      return await starting;
    } catch (error) {
      starting = null;
      const stale = child as ChildProcessWithoutNullStreams | null;
      child = null;
      stale?.kill();
      throw error;
    }
  }

  function threadParams(): Json {
    return {
      cwd: workDir,
      model: modelName,
      sandbox: 'read-only',
      approvalPolicy: 'never',
      ephemeral: true,
      serviceName: 'talkthrough',
      baseInstructions: options.instructions ?? systemPrompt(),
      ...(options.threadConfig ? { config: options.threadConfig } : {}),
    };
  }

  /** The text of the primer turn: it loads the instructions and answers with nothing. */
  const PRIMER = 'This first message only loads your instructions. Do not draw anything: answer with an empty scene (no steps, escalate null). The real question comes next, with a screenshot.';

  /** Starts a spare thread and runs the primer turn on it. */
  function startSpare(): void {
    if (spare) return;
    const schema = options.primeSchema ?? sceneSchemaLean;
    const ready = (async (): Promise<Primed | null> => {
      const proc = await ensure();
      const started = await request(proc, 'thread/start', threadParams());
      const thread = started.thread as Json | undefined;
      const threadId = thread && typeof thread.id === 'string' ? thread.id : '';
      if (!threadId) return null;
      const turn: Turn = { proc, queue: new AsyncQueue<ModelOutput>(), stream: createStepStream(), threadId, done: false };
      turns.set(threadId, turn);
      try {
        const begun = await request(proc, 'turn/start', {
          threadId,
          input: [{ type: 'text', text: PRIMER }],
          outputSchema: schema,
          effort,
          approvalPolicy: 'never',
          sandboxPolicy: { type: 'readOnly' },
        });
        const t = begun.turn as Json | undefined;
        if (t && typeof t.id === 'string') turn.turnId = t.id;
        for await (const out of turn.queue) void out; // the primer's own answer is not used
        return { proc, threadId };
      } finally {
        turns.delete(threadId);
      }
    })().catch(() => null);
    const entry = { ready, schemaKey: JSON.stringify(schema) };
    spare = entry;
    primeCounts.primed++;
    // a spare nobody asked for is not kept for long
    clearTimeout(spareTimer);
    spareTimer = setTimeout(() => {
      if (spare === entry) dropSpare('abandoned');
    }, 30_000);
    spareTimer.unref();
  }

  return {
    id: `codex:${modelName}${fast ? ':fast' : ''}`,
    get serviceTier() {
      return serviceTier;
    },

    async warm() {
      await ensure();
    },

    prime() {
      if (options.prime) startSpare();
    },

    unprime() {
      if (spare) dropSpare('abandoned');
    },

    async close() {
      dropSpare(null);
      clearTimeout(keptTimer);
      kept = null;
      const proc = child;
      const dir = workDir;
      child = null;
      starting = null;
      workDir = null;
      proc?.stdin.end();
      await stopAndRemove(proc, dir);
    },

    async *ask(req: ModelRequest): AsyncGenerator<ModelOutput> {
      if (req.signal?.aborted) throw new ModelError('aborted', 'request aborted');
      const t0 = performance.now();
      // Every wait below, the process start and both requests included, ends at once on an abort or when
      // the time is up, so a process that is alive but silent can never hang a question.
      let bailOut!: (error: ModelError) => void;
      const bail = new Promise<never>((_, reject) => {
        bailOut = reject;
      });
      bail.catch(() => undefined);
      let turn: Turn | undefined;
      let live: ChildProcessWithoutNullStreams | null = null;
      const end = (error: ModelError, timedOut: boolean) => {
        bailOut(error);
        if (turn) {
          failTurn(turn, error);
          if (live) stopTurn(live, turn);
        }
        // A process that said nothing at all before the time ran out is of no use to the next question either.
        if (timedOut && (!turn || turn.firstDeltaAt === undefined)) {
          const stuck = child;
          child = null;
          starting = null;
          stuck?.kill();
        }
      };
      const timer = setTimeout(() => end(new ModelError('failed', `no answer within ${(timeoutMs / 1000).toFixed(timeoutMs < 10_000 ? 1 : 0)} s`), true), timeoutMs);
      const onAbort = () => end(new ModelError('aborted', 'request aborted'), false);
      req.signal?.addEventListener('abort', onAbort, { once: true });
      const within = <T>(promise: Promise<T>): Promise<T> => Promise.race([promise, bail]);

      let threadId = '';
      let finishedWell = false;
      try {
        const proc = await within(ensure());
        live = proc;
        const tReady = performance.now();
        const reuse = options.keepThread === true && req.thread.length > 0 && kept !== null && kept.proc === proc && kept.turns === req.thread.length ? kept : null;
        clearTimeout(keptTimer);
        const old = kept;
        kept = null; // it is put back only when this question ends well
        if (old && !reuse) void request(old.proc, 'thread/unsubscribe', { threadId: old.threadId }).catch(() => undefined);
        // A thread primed while the person was speaking, if it is ready in time and made for this schema.
        let primed: Primed | null = null;
        if (!reuse && spare) {
          const sp = spare;
          const got = sp.schemaKey === JSON.stringify(req.schema)
            ? await within(Promise.race([sp.ready, new Promise<null>((resolve) => setTimeout(resolve, 1500, null).unref())]))
            : null;
          if (got && got.proc === proc) {
            primed = got;
            spare = null;
            clearTimeout(spareTimer);
            primeCounts.used++;
            primeLine('used');
          } else {
            dropSpare('late');
          }
        }
        const started = reuse ? { thread: { id: reuse.threadId } } as Json : primed ? { thread: { id: primed.threadId } } as Json : await within(request(proc, 'thread/start', threadParams())).catch((error: unknown) => {
          throw error instanceof ModelError ? error : errorFrom(error instanceof Error ? error.message : String(error));
        });
        const tThread = performance.now();
        const thread = started.thread as Json | undefined;
        threadId = thread && typeof thread.id === 'string' ? thread.id : '';
        if (!threadId) throw new ModelError('failed', 'codex did not start a thread');
        if (!reuse && !primed && serviceTier !== started.serviceTier) {
          serviceTier = typeof started.serviceTier === 'string' ? started.serviceTier : undefined;
          log(`codex model ${String(started.model)}, service tier ${serviceTier ?? 'default'}`);
        }

        const mine: Turn = { proc, queue: new AsyncQueue<ModelOutput>(), stream: createStepStream(), threadId, done: false };
        turn = mine;
        turns.set(threadId, mine);
        const begun = await within(request(proc, 'turn/start', {
          threadId,
          input: [
            { type: 'image', url: `data:${req.screenshot.mime};base64,${req.screenshot.base64}` },
            ...(req.focus ? [{ type: 'image', url: `data:${req.focus.crop.mime};base64,${req.focus.crop.base64}` }] : []),
            // a continued thread already holds the earlier turns
            // a continued thread already holds the earlier turns
            { type: 'text', text: questionText(reuse ? { ...req, thread: [] } : req) },
          ],
          outputSchema: req.schema,
          effort,
          approvalPolicy: 'never',
          sandboxPolicy: { type: 'readOnly' },
        })).catch((error: unknown) => {
          throw error instanceof ModelError ? error : errorFrom(error instanceof Error ? error.message : String(error));
        });
        const t = begun.turn as Json | undefined;
        if (t && typeof t.id === 'string') mine.turnId = t.id;
        const tTurn = performance.now();
        if (req.signal?.aborted) onAbort();
        yield* mine.queue;
        finishedWell = true;
        if (finishedWell && options.keepThread) {
          kept = { threadId, turns: req.thread.length + 1, proc };
          keptTimer = setTimeout(letGo, options.keepThreadMs ?? 20_000);
          keptTimer.unref();
        }
        const ms = (x: number, y: number) => Math.round(y - x);
        log(`codex timings: process ${ms(t0, tReady)} ms, thread ${ms(tReady, tThread)} ms, turn accepted ${ms(tThread, tTurn)} ms, first text ${mine.firstDeltaAt === undefined ? '-' : ms(tTurn, mine.firstDeltaAt)} ms after that, all ${ms(tTurn, performance.now())} ms`);
      } finally {
        clearTimeout(timer);
        req.signal?.removeEventListener('abort', onAbort);
        if (threadId) turns.delete(threadId);
        if (turn && !turn.done) {
          turn.done = true;
          if (live) stopTurn(live, turn);
        }
        if (live && threadId && !(finishedWell && options.keepThread)) void request(live, 'thread/unsubscribe', { threadId }).catch(() => undefined);
      }
    },
  };
}

/** A name as a TOML key: bare when it only holds letters, digits, _ and -, quoted otherwise. */
function tomlKey(name: string): string {
  return /^[A-Za-z0-9_-]+$/.test(name) ? name : JSON.stringify(name);
}

/** Sorts a failure message from the tool into one of the error codes. */
function errorFrom(message: string): ModelError {
  const m = message.toLowerCase();
  if (m.includes('log in') || m.includes('login') || m.includes('sign in') || m.includes('unauthorized') || m.includes('auth')) return new ModelError('auth', message);
  if (m.includes('rate limit') || m.includes('usage limit') || m.includes('too many') || m.includes('quota')) return new ModelError('rate-limited', message);
  return new ModelError('failed', message);
}
