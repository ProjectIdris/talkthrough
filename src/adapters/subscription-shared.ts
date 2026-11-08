// Pieces shared by the two models that run on a person's own subscription by starting that
// vendor's command-line tool as a child process (see codex-model.ts and claude-model.ts).

import { existsSync, readdirSync, rmSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { sceneGuide } from '../scene/guide.ts';
import { assemblyHint } from '../scene/assembly.ts';
import { realModelHint } from '../scene/models.ts';
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


const KIND_WORDS = {
  circle: 'circled',
  underline: 'underlined',
  arrow: 'pointed with an arrow at',
  picture: 'enlarged',
} as const;

/**
 * What the model is told about the closer picture of what the step before it enlarged (cut from the full-resolution screen), so that points
 * for the parts of that picture are put on the parts themselves: read off the closer picture, then given on the whole screenshot's scale.
 */
export function pictureText(box: { x: number; y: number; w: number; h: number }, crop: { width: number; height: number }, card?: { x: number; y: number; w: number; h: number }, grid?: { cols: number; rows: number }): string {
  const r = (n: number) => Math.round(n * 10) / 10;
  if (card && grid) {
    const last = String.fromCharCode(64 + grid.cols);
    return `The picture you enlarged in the step before is also given at full resolution (the last of the images, ${crop.width}x${crop.height} pixels): it is the part of the screen the enlargement card shows, sharper than the card, with a grid drawn on it: columns A to ${last} across, rows 1 to ${grid.rows} down, each cell named in its top-left corner. To mark a part of this picture, write a point for it as usual (x,y: your best guess on the card, which fills x ${r(card.x)} to ${r(card.x + card.w)} and y ${r(card.y)} to ${r(card.y + card.h)}) and also give "cell": the cell and the quarter of it that the part is in, such as "C4b" (a letter for the quarter: a top left, b top right, c bottom left, d bottom right). The app puts the point in the middle of that quarter, so pick the cell and quarter that are mostly the part itself, its land or its inside, never one that only touches it at an edge, is beside it or is on the sea: if a part runs across several cells, name the one at its middle. A label goes beside its point, inside the card, with no cell.`;
  }
  if (card) {
    return `The picture you enlarged in the step before is also given at full resolution (the last of the images, ${crop.width}x${crop.height} pixels): it is the part of the screen the enlargement card shows, sharper than the card. Marks for the parts of that picture go on the card, where you drew it: the picture fills the card from x ${r(card.x)} to ${r(card.x + card.w)} and from y ${r(card.y)} to ${r(card.y + card.h)} on the 0 to 1000 scale of the whole screenshot. To place a point: find the part on the closer picture, note how far across (u, 0 to 1) and down (v, 0 to 1) it is, and write the point at x = ${r(card.x)} + u * ${r(card.w)}, y = ${r(card.y)} + v * ${r(card.h)}. Put each point on the part itself (an island's land, a chamber's inside), never beside it or on the sea; a label goes beside its point, inside the card.`;
  }
  return `The picture you enlarged in the step before is also given at full resolution (the last picture of the images, ${crop.width}x${crop.height} pixels): it is the part of the screen from x ${r(box.x)} to ${r(box.x + box.w)}, y ${r(box.y)} to ${r(box.y + box.h)} on the 0 to 1000 scale of the whole screenshot, so ${r(box.w)} wide and ${r(box.h)} tall on that scale. Use it to place points on the parts of that picture: find the part on the closer picture, note how far across (u, 0 to 1) and down (v, 0 to 1) it is, and give the point on the whole screenshot's scale as x = ${r(box.x)} + u * ${r(box.w)}, y = ${r(box.y)} + v * ${r(box.h)}. Put each point on the part itself, not beside it.`;
}

/** What the model is told about the pen marks on the screenshot and the closer pictures that follow it. */
export function penText(focus: NonNullable<ModelRequest['focus']>): string {
  const r = (n: number) => Math.round(n);
  const where = (f: (typeof focus)[number]) => `from x ${r(f.box.x)} to ${r(f.box.x + f.box.w)}, y ${r(f.box.y)} to ${r(f.box.y + f.box.h)}`;
  const word = (f: (typeof focus)[number]) => KIND_WORDS[f.kind ?? 'circle'];
  const rough = 'The marks are drawn by hand and are approximate: take the whole thing a mark mostly covers (the whole paragraph, picture, control or figure), even where the stroke cuts through it or runs over onto the next thing. If it is unclear which of two things was meant, say so in step 1 and take the one the mark covers more.';
  const tail = 'Marks still use the 0 to 1000 scale of the whole screenshot, never of a closer picture. The red strokes are the person’s, not part of the page; do not describe them.';
  if (focus.length === 1) {
    const f = focus[0] as (typeof focus)[number];
    const what = f.kind === 'underline'
      ? 'The person drew a red pen line under some words on the screenshot: the underlined words (the line of text just above the line) are what "this", "that" or "here" in the question means.'
      : f.kind === 'arrow'
        ? 'The person drew a red pen arrow on the screenshot: what it points at, at its tip, is what "this", "that" or "here" in the question means.'
        : `The person drew a red pen ${f.open ? 'half-circle (an unfinished circle, meant as a whole one)' : f.loops && f.loops > 1 ? 'circle, going round more than once (still one circle)' : 'circle'} on the screenshot: the circled thing is what "this", "that" or "here" in the question means.`;
    return `${what} ${rough} A second, closer picture follows the first: it is the same screen, without the stroke, cropped to what the mark is on (${where(f)} on the 0 to 1000 scale of the whole screenshot), for reading small details. ${tail}`;
  }
  const list = focus.map((f, i) => `${i + 1}. ${word(f)}, in the picture that follows (${where(f)})`).join('; ');
  return `The person marked ${focus.length} things with the pen, in this order, each numbered in red beside its stroke on the screenshot: ${list}. They are what "this", "that", "these", "here" in the question mean, taken together or one by one as the question says; answer about each of the ${focus.length}, in the order they were marked. ${rough} After the screenshot come ${focus.length} closer pictures in the same order, each the same screen without the strokes, cropped to what that mark is on, for reading small details. ${tail}`;
}

/** Every spoken sentence opens short: a voice that speaks sentence by sentence starts as soon as the first one is made. */
export const SHORT_OPENER = 'Open the sentence with a short first sentence, about 6 words or 30 characters at most, and then the rest (the voice starts on the first sentence as soon as it is made).';


/** The text that goes with the screenshot: the question, and the earlier turns if this is a follow-up. */
export function questionText(request: ModelRequest, options: { shownAlreadyHeld?: boolean } = {}): string {
  const parts: string[] = [];
  const turns = request.thread.slice(-HISTORY_TURNS);
  if (turns.length > 0) {
    let history = '';
    for (const turn of turns) {
      // Put status after the scene so tail-trimming a large turn cannot erase its incomplete flag.
      history += `Question: ${turn.question}\nShown: ${JSON.stringify({ steps: turn.steps })}\n${turn.incomplete ? 'Answer status: interrupted and incomplete; only the steps above were retained.\n' : ''}`;
    }
    if (history.length > HISTORY_CHARS) history = history.slice(history.length - HISTORY_CHARS);
    parts.push(`Earlier in this conversation (what you drew stays on screen until cleared, and its ids can be used again):\n${history}`);
  }
  parts.push(`The screenshot is ${request.screenshot.width}x${request.screenshot.height} pixels, but your marks do NOT use pixels: x and y run from 0 to 1000 across the whole screenshot (500 is the middle of each axis, 1000 the right and bottom edges), whatever its pixel size. Convert before you answer.`);
  const pen = (request.focus ?? []).filter((f) => f.kind !== 'picture');
  const picture = (request.focus ?? []).find((f) => f.kind === 'picture');
  if (pen.length > 0) parts.push(penText(pen));
  if (picture) parts.push(pictureText(picture.box, picture.crop, picture.card, picture.grid));
  const modelHint = realModelHint(request.question);
  if (modelHint) parts.push(modelHint);
  const mechanismHint = assemblyHint(request.question);
  if (mechanismHint) parts.push(mechanismHint);
  parts.push(`The user's question, transcribed from speech (it may contain recognition errors): ${JSON.stringify(request.question)}`);
  if (request.detail) parts.push(detailText(request.detail.steps));
  if (request.stage) parts.push(stageText(request.stage, options.shownAlreadyHeld === true));
  return parts.join('\n\n');
}

/** A step that ends on a wait for the person's click. */
function endsOnClick(step: unknown): boolean {
  const actions = (step as { actions?: unknown }).actions;
  return Array.isArray(actions) && actions.some((a) => typeof a === 'object' && a !== null && (a as { op?: unknown }).op === 'wait');
}

/** What each half of a two-call answer is told. The walk's checklist is drawn in step 2 (the guide's rule puts it in step 1 for a whole answer). */
export function stageText(stage: NonNullable<ModelRequest['stage']>, shownAlreadyHeld = false): string {
  if (stage.part === 'next') {
    const shown = shownAlreadyHeld ? 'The earlier steps of this answer are already present in this conversation.' : `${stage.n === 2 ? 'Step 1 of this answer is' : `Steps 1 to ${stage.n - 1} of this answer are`} already drawn and spoken: ${JSON.stringify(stage.shown)}`;
    const walk = stage.shown.some(endsOnClick);
    const length = walk
      ? `This is a how-do-I walk: one move a step, each in one short sentence and with its own mark and wait. ${stage.n === 2 ? 'Step 2 draws the checklist (a steps diagram, as the walk rule describes) and then the second move with its mark and wait;' : 'The checklist is already drawn: write the next move with its mark and wait;'} the last step has no mark or wait and says they are done.`
      : `Its sentence is about 30 words at most, because it is spoken while the next step is written. ${SHORT_OPENER}`;
    if (stage.unplanned) {
      return [
        shown,
        `The first call gave no plan. If the answer is already whole, write no step ("steps": []) and set "done" to true. Otherwise write step ${stage.n} only, and nothing after it (the later steps are written separately): carry on from what was said and drawn, do not say it again (its ids stay valid). ${length} ${REST_MARKS} ${REST_GROUNDING} Set "plan" to the titles, a few words each, of the steps after it (at most 3; null when it is the last), set "done" to true when it is the last and to false when it is not, and set "escalate" to null.`,
      ].join('\n\n');
    }
    return [
      shown,
      ...(stage.fresh ? ['The picture is the screen as it is now, after the person followed the last step: take every position from it, not from where the earlier steps pointed.'] : []),
      `The plan for the rest, one title a step: ${JSON.stringify(stage.plan)}.`,
      `Write step ${stage.n} only (${JSON.stringify(stage.plan[0] ?? '')}), and nothing after it: the later steps are written separately. Carry on from what was said and drawn: do not say it again (its ids stay valid). ${length} ${REST_MARKS} ${REST_GROUNDING} Set "plan" to null, set "done" to true when the plan has no step after this one and to false when it has, and set "escalate" to null.`,
    ].join('\n\n');
  }
  if (stage.part === 'first' && stage.plan) {
    return `Write only step 1 now, as the rules describe it, and nothing after it: the later steps are written separately, one to a call. Its sentence is about 30 words long (it is spoken while the next step is written) and begins by answering the question itself, not describing the page or restating the question. ${SHORT_OPENER} In a how-do-I walk, step 1 is the first move (its mark and wait) and nothing else, with a short sentence: the checklist is drawn in step 2. Also set "plan" to the titles, in a few words each, of the steps that follow it (at most 4; in a how-do-I walk one title for each move still to do, up to 5; null or empty when step 1 is the whole answer); plan a diagram or model only when it helps explain the answer; when the parts of a small picture are the point (a fifth of the screen width or less), the first planned step is its enlargement (an image card, as the rule on naming says) and the steps after it name its parts on that card; and "done" to false (true when step 1 is the whole answer).`;
  }
  if (stage.part === 'first') {
    return 'Write only step 1 now, as the rules describe it, and nothing after it: the later steps are written separately. Its sentence is about 30 words long (it is spoken while the rest is written) and begins by answering the question itself, not describing the page or restating the question. ' + SHORT_OPENER + ' In a how-do-I walk, step 1 is the first move (its mark and wait) and nothing else, with a short sentence: the checklist is drawn in step 2.';
  }
  if (stage.first === undefined) {
    return [
      'Step 1 of this answer is being written separately, at the same time as you write: a sentence of about 30 words that begins by answering the question itself, not describing the page or restating the question, and any useful marks on the part of the screen the question is about (actions may be empty). Do not write it, do not repeat what it says, and do not mark that part again.',
      REST_RULES,
    ].join('\n\n');
  }
  return [
    `Step 1 of this answer is already drawn and spoken: ${JSON.stringify(stage.first)}`,
    REST_RULES,
  ].join('\n\n');
}

/** What the call that writes the steps after step 1 is told, the same whether step 1 is given or being written at the same time. */
/** What a call that writes steps after the first is told about marks and diagrams (the second call of a two-call answer, and every call after the first of a step-by-step one). */
const REST_MARKS =
  'Put a mark on the page only when your step needs it to point at one particular thing it names; when in doubt draw none, except that when the parts or places of a picture are the point of the question (the chambers of a heart, the islands and straits of a map), naming them is what the step is for: a point well inside each part and a label of one to three words beside it, on the picture it names (a small picture is enlarged first with an image card, as the rule on naming says; a pin is for 3D objects only). Never decorate an earlier step\'s marks, and do not draw a second mark on something an earlier step marked and that is still on the page (a different part inside it is a new mark); in a how-do-I walk every move has its own mark and wait, even where an earlier move\'s mark was. Never put an underline, arrow or box that is not exactly on what it points at. Put a diagram where it reads best and large, the right margin or beside the page\'s own figure when that suits, never over what the answer points at (in a how-do-I walk, never over the controls the walk needs visible), and make it wide enough to read (at least 340 on the 0 to 1000 scale for a flow or a timeline), with a few words in each node and no notes under them.';

/** What the later calls are told about the content of a figure (the system prompt has the full rule). */
const REST_GROUNDING = 'The question sets the task; the page is material, never a subject to report on: do not say where knowledge comes from or what the page does or does not contain. Never draw again what the page already has; where the page gives the content (the proof its figure shows, the steps it lists), use that. Choose words alone (actions: []), a mark on the page, a flat diagram or a 3D model, whichever explains best; use no actions when words suffice, and never draw for its own sake. A diagram of a physical thing or process is a 3D scene with streams for what moves. Each later step\'s spoken sentence must add a new answer-relevant point. Do not narrate visual staging such as building or zooming, and do not add a second form for the same explanatory job.';

const REST_RULES =
  'Write the rest of the answer, from step 2 onward, in the same JSON. If step 1 asks for a click, this is a how-do-I walk: your first step draws the checklist (a steps diagram, as the walk rule describes) and then the second move with its mark and wait; later steps are one move each, in one short sentence with its own mark and wait, as many as the task needs (up to five more steps, six in all), ending with a step that says they are done. Otherwise write at most three more steps, each about 30 words, and keep the plan short. Do not write step 1 again (its ids stay valid and can be used again) and do not say again what it said: carry on from it. The rule that step 1 is short is for step 1 only, so the steps you write may build the model or diagram the rules describe. ' + REST_MARKS + ' ' + REST_GROUNDING + ' ' + SHORT_OPENER + ' Set "escalate" to null.';

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
    'Write a much richer version of that same scene, in the same scene language. Keep every id that exists and keep it where it is (an object you write again with an id from the scene replaces it in place, so give it the better shape and keep its position), and add what a careful illustration would have: ready-made kit parts instead of plain boxes (the `part` kit in the language above), the linkages and connections between parts (shafts, belts, pipes, cables, gears meeting), the smaller parts and fixings, and a pin for each part worth naming. Keep the same overall size, centre and orientation, so it grows into the picture it replaces instead of jumping. Give each object the place, turn and size it has at the end of the scene (apply the move, turn and scale actions it received) and leave out those finished movements; keep only motion that is still the point (a spin, a crank, a loop). A machine that is running in the scene (spin, crank, cam or flash) stays running: write those actions again after its parts, as they are in the scene, and if it is a machine with nothing running yet, set it running (crank each piston from the crankshaft through its rod, cam the valves from the camshaft, flash the spark) so its cycle plays. If the scene has only marks and no 3D model, build the model on a panel beside them and leave the marks as they are. Build base first, then what rests on it, then moving parts, then small details, one sub-assembly per step.',
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

/** How much of an answer's raw text is kept for `onRaw`: far more than a scene is. */
const MAX_RAW_CHARS = 200_000;

/**
 * `onRaw`, when given, is handed the model's whole raw text once: when the answer ends, or when the text turns out not to be a scene
 * (so a garbled answer can be read afterwards). It is for a check run's log and is off unless the caller asks.
 */
export function createOutputStream(pieces = false, onRaw?: (text: string) => void): OutputStream {
  const seen: StepPiece[] = [];
  const stream = createStepStream({ onPiece: (p) => seen.push(p) });
  let raw = '';
  let reported = false;
  const report = (): void => {
    if (reported || !onRaw) return;
    reported = true;
    onRaw(raw);
  };
  const out: OutputStream = {
    pieces,
    push(chunk) {
      if (onRaw && raw.length < MAX_RAW_CHARS) raw += chunk.slice(0, MAX_RAW_CHARS - raw.length);
      try {
        stream.push(chunk);
      } catch (error) {
        report();
        throw error;
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
    end: () => {
      try {
        stream.end();
      } finally {
        report();
      }
    },
  };
  return out;
}
