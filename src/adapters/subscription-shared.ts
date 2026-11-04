// Pieces shared by the two models that run on a person's own subscription by starting that
// vendor's command-line tool as a child process (see codex-model.ts and claude-model.ts).

import { existsSync, readdirSync, rmSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { sceneGuide } from '../scene/guide.ts';
import type { ModelRequest } from './model.ts';

/** A queue a producer pushes into and a consumer reads as an async iterator. */
export class AsyncQueue<T> {
  private items: T[] = [];
  private waiting: Array<{ resolve: (r: IteratorResult<T>) => void; reject: (e: unknown) => void }> = [];
  private ended = false;
  private failure: { error: unknown } | null = null;

  push(item: T): void {
    if (this.ended) return;
    const w = this.waiting.shift();
    if (w) w.resolve({ value: item, done: false });
    else this.items.push(item);
  }

  /** No more items; readers get what is queued, then the end. */
  close(): void {
    if (this.ended) return;
    this.ended = true;
    for (const w of this.waiting.splice(0)) w.resolve({ value: undefined, done: true });
  }

  /** Readers get what is queued, then the error. */
  fail(error: unknown): void {
    if (this.ended) return;
    this.failure = { error };
    this.ended = true;
    for (const w of this.waiting.splice(0)) w.reject(error);
  }

  get isEnded(): boolean {
    return this.ended;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length > 0) return Promise.resolve({ value: this.items.shift() as T, done: false });
        if (this.failure) return Promise.reject(this.failure.error);
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
      },
    };
  }
}

/**
 * Stops a child process and removes the folder it was started in. On Windows a folder cannot be removed
 * while a process still has it as its working directory, so this waits (briefly) for the process to end.
 */
export async function stopAndRemove(proc: { kill(): boolean; exitCode: number | null; once(event: 'exit', listener: () => void): unknown } | null, dir: string | null): Promise<void> {
  if (proc && proc.exitCode === null) {
    const gone = new Promise<void>((resolve) => proc.once('exit', () => resolve()));
    proc.kill();
    await Promise.race([gone, new Promise<void>((resolve) => setTimeout(resolve, 2000).unref())]);
  }
  if (!dir) return;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 200).unref());
    }
  }
}

/** Calls onLine for every complete line of a stream of text chunks. */
export function createLineSplitter(onLine: (line: string) => void): (chunk: string) => void {
  let rest = '';
  return (chunk) => {
    rest += chunk;
    let at: number;
    while ((at = rest.indexOf('\n')) >= 0) {
      const line = rest.slice(0, at).trim();
      rest = rest.slice(at + 1);
      if (line) onLine(line);
    }
  };
}

/** The environment a helper process starts with: ours, without the variable that makes Electron act as Node. */
export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

/**
 * Finds a command-line tool: an explicit path wins; otherwise the first match on PATH. A Windows
 * `.cmd` shim from npm is followed to the real executable it starts, because a shim cannot be started
 * without a shell and a shell would have to be trusted with the arguments.
 */
export function resolveCommand(name: string, explicit?: string): string {
  if (explicit) return explicit;
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? ['.exe', '.cmd'] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      if (!existsSync(candidate)) continue;
      if (ext !== '.cmd') return candidate;
      const native = nativeFromNpmShim(dir, name);
      if (native) return native;
    }
  }
  return name;
}

/** npm puts <dir>/<name>.cmd beside <dir>/node_modules/<package>/...; the native binary is inside it. */
function nativeFromNpmShim(dir: string, name: string): string | null {
  const roots: Record<string, string> = { codex: join(dir, 'node_modules', '@openai', 'codex'), claude: join(dir, 'node_modules', '@anthropic-ai', 'claude-code') };
  const root = roots[name];
  if (!root || !existsSync(root)) return null;
  const found: string[] = [];
  const walk = (folder: string, depth: number) => {
    if (depth > 8) return;
    let entries: string[];
    try {
      entries = readdirSync(folder);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(folder, entry);
      if (entry.toLowerCase() === `${name}.exe`) found.push(full);
      else if (!entry.includes('.')) walk(full, depth + 1);
    }
  };
  walk(root, 0);
  return found[0] ?? null;
}


const HISTORY_TURNS = 3;
const HISTORY_CHARS = 6000;

/** The instructions both models get: who they are, the scene language, and what the screenshot is. */
export function systemPrompt(): string {
  return [
    'You are Talkthrough: a helper that talks a person through what is on their screen, speaking and drawing on top of it as you go.',
    'The user held a key and asked a question aloud; the attached screenshot is exactly what they see. Answer helpfully and briefly: what you say is spoken to them, and your marks point at things on the screenshot.',
    'You have no tools and cannot run anything: your whole reply is the JSON scene described below, nothing else.',
    sceneGuide,
  ].join('\n\n');
}

/** The text that goes with the screenshot: the question, and the earlier turns if this is a follow-up. */
export function questionText(request: ModelRequest): string {
  const parts: string[] = [];
  const turns = request.thread.slice(-HISTORY_TURNS);
  if (turns.length > 0) {
    let history = '';
    for (const turn of turns) {
      history += `Question: ${turn.question}\nShown: ${JSON.stringify({ steps: turn.steps })}\n`;
    }
    if (history.length > HISTORY_CHARS) history = history.slice(history.length - HISTORY_CHARS);
    parts.push(`Earlier in this conversation (what you drew stays on screen until cleared, and its ids can be used again):\n${history}`);
  }
  parts.push(`The screenshot is ${request.screenshot.width}x${request.screenshot.height} pixels, but your marks do NOT use pixels: x and y run from 0 to 1000 across the whole screenshot (500 is the middle of each axis, 1000 the right and bottom edges), whatever its pixel size. Convert before you answer.`);
  parts.push(`The user's question, transcribed from speech (it may contain recognition errors): ${JSON.stringify(request.question)}`);
  return parts.join('\n\n');
}
