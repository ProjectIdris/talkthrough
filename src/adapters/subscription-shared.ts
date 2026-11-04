// Pieces shared by the two models that run on a person's own subscription by starting that
// vendor's command-line tool as a child process (see codex-model.ts and claude-model.ts).

import { existsSync, readdirSync, rmSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { sceneGuide } from '../scene/guide.ts';
import { createStepStream } from '../scene/stream.ts';
import type { StepPiece } from '../scene/stream.ts';
import type { ModelOutput, ModelRequest } from './model.ts';

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
    try {
      proc.kill();
    } catch {
      // it never started (the command was not found): nothing to stop
    }
    await Promise.race([gone, new Promise<void>((resolve) => setTimeout(resolve, 2000).unref())]);
  }
  if (!dir) return;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
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
  if (request.focus) {
    const b = request.focus.box;
    const r = (n: number) => Math.round(n);
    parts.push(`The person drew a red pen stroke on the screenshot to circle or point at something. The circled area is what "this", "that" or "here" in the question means. A second, closer picture follows the first: it is the same screen, without the stroke, cropped to the area around the stroke (from x ${r(b.x)} to ${r(b.x + b.w)}, y ${r(b.y)} to ${r(b.y + b.h)} on the 0 to 1000 scale of the whole screenshot), for reading small details. Marks still use the 0 to 1000 scale of the whole screenshot, never of the crop. The red stroke is the person's, not part of the page; do not describe it.`);
  }
  parts.push(`The user's question, transcribed from speech (it may contain recognition errors): ${JSON.stringify(request.question)}`);
  if (request.detail) parts.push(detailText(request.detail.steps));
  return parts.join('\n\n');
}

/** The most of the scene on screen a detail pass is shown; a longer one is cut at a step, with a note. */
const DETAIL_SCENE_CHARS = 24000;

/** What a detail pass is asked: the same scene, much richer, in the same language and the same ids. */
export function detailText(steps: readonly unknown[]): string {
  const kept: unknown[] = [];
  let size = 0;
  for (const step of steps) {
    const text = JSON.stringify(step);
    if (size + text.length > DETAIL_SCENE_CHARS && kept.length > 0) break;
    kept.push(step);
    size += text.length;
  }
  const cut = kept.length < steps.length ? ` (the first ${kept.length} of ${steps.length} steps; the rest follow the same style)` : '';
  return [
    `THIS IS A DETAIL PASS, not a new question. The person asked for more detail about what is already on screen. The scene below is what was drawn for the question above${cut}:`,
    JSON.stringify({ steps: kept }),
    'Write a much richer version of that same scene, in the same scene language. Keep every id that exists and keep it where it is (an object you write again with an id from the scene replaces it in place, so give it the better shape and keep its position), and add what a careful illustration would have: ready-made kit parts instead of plain boxes (the `part` kit in the language above), the linkages and connections between parts (shafts, belts, pipes, cables, gears meeting), the smaller parts and fixings, and a pin for each part worth naming. Keep the same overall size, centre and orientation, so it grows into the picture it replaces instead of jumping. Build base first, then what rests on it, then moving parts, then small details, one sub-assembly per step.',
    'Nothing you write in `say` is spoken in this pass: keep each one to a short phrase naming what the step adds. The rule that step 1 is short does not apply. Do not repeat marks on the screenshot that are already drawn unless you improve them. Set "escalate" to null.',
  ].join('\n\n');
}

/** A step stream whose results are model outputs: the steps, and when `pieces` is on, each say and action before its step. */
export type OutputStream = {
  /** Feed the next chunk of text; returns what that chunk completed, in order. Throws on text that is not a scene. */
  push(chunk: string): ModelOutput[];
  /** Whether each say and action is returned as it closes (default off: only steps). */
  pieces: boolean;
  readonly escalate: string | undefined;
  readonly complete: boolean;
  end(): void;
};

export function createOutputStream(pieces = false): OutputStream {
  const seen: StepPiece[] = [];
  const stream = createStepStream({ onPiece: (p) => seen.push(p) });
  const out: OutputStream = {
    pieces,
    push(chunk) {
      try {
        stream.push(chunk);
      } finally {
        // What closed before an error is dropped with it: the error ends the answer.
      }
      const got = seen.splice(0);
      return out.pieces ? got : got.filter((p) => p.type === 'step');
    },
    get escalate() {
      return stream.escalate;
    },
    get complete() {
      return stream.complete;
    },
    end: () => stream.end(),
  };
  return out;
}
