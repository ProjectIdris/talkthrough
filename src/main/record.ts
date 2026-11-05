// The record of each question (an opt-in setting, off by default): a dated folder for every question, holding what was sent, what was
// heard, what each model call wrote and when, what was drawn, what the checks repaired or refused, how the voice went and what broke.
// It is for the person who asked for it, on their own computer: nothing here is sent anywhere, and nothing is kept past the newest
// `keep` folders. Writing it must never get in the way of a question: every failure is swallowed (and said once in the log).

import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** How many question folders are kept; older ones are deleted when a new one begins. */
export const RECORD_KEEP = 50;

/** The name of a question's folder: local date and time, so the folders sort in the order they were asked. Nothing else in a folder is ever deleted. */
const FOLDER = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(-\d+)?$/;

export type RecordedCall = {
  /** Which call of this question it was (1, 2, ...). */
  n: number;
  /** The model's name, and the part it was asked for (the quick answer, a step, the detail pass). */
  model: string;
  role: string;
  /** The stage asked of it when the answer is written in pieces (`first`, `rest`, `next 3`). */
  stage?: string;
  startedAt: string;
  /** Milliseconds from the start of the call to its first output and to its end. */
  firstOutputMs?: number;
  endMs?: number;
  outputs: { steps: number; says: number; actions: number; escalate: boolean };
  usage?: unknown;
  error?: string;
};

export type QuestionRecord = {
  /** A question (or a detail pass, or an offer to the backend) begins: a new folder, and the oldest ones beyond the newest 50 go. */
  begin(kind: 'question' | 'detail' | 'offer'): void;
  /** One line of the app's log, while a folder is open (it holds the validator's notes, the voice, errors, timings). */
  line(text: string): void;
  /** What the person said, as heard. */
  transcript(text: string, speech?: string): void;
  /** A picture: the screenshot sent to the model (with any pen strokes drawn on it), the clean one, a crop. */
  picture(name: string, picture: { mime: string; base64: string }): void;
  /** The pen strokes of the question, on the 0..1000 scale. */
  strokes(strokes: ReadonlyArray<ReadonlyArray<readonly [number, number]>>): void;
  /** The number of the next model call of this question (1, then 2, ...). */
  nextCall(): number;
  /** One model call: its meta and its raw text. */
  call(call: RecordedCall, raw: string | undefined): void;
  /** What the page was told to draw, in order, as the checks passed it (a step whole, or a step's words and then each action). */
  message(message: { kind: string; [key: string]: unknown }): void;
  /** Everything the checks changed or dropped in one step of the answer: every note, whole. */
  issues(stepNumber: number, issues: ReadonlyArray<{ path: string; message: string }>): void;
  /** Which voice spoke and why: a line from the voice (the server, or the system voice and the reason). */
  voice(text: string): void;
  /** Something broke. */
  error(text: string): void;
  /** The figures of the question (written again each time they grow: first word, end). */
  report(report: Record<string, unknown>): void;
  /** The folder the open question is in; undefined when none is. */
  folder(): string | undefined;
};

type Options = {
  dir: string;
  keep?: number;
  now?: () => Date;
  /** Said once if the record cannot be written (the question goes on regardless). */
  warn?: (message: string) => void;
};

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** `2026-11-05_16-31-07`: the local date and time. */
export function folderName(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}_${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`;
}

/** Deletes the folders of the record beyond the newest `keep`; only folders named by `folderName` are looked at. Returns how many it removed. */
export function pruneRecord(dir: string, keep: number): number {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => FOLDER.test(name) && statSync(join(dir, name)).isDirectory());
  } catch {
    return 0;
  }
  names.sort();
  const old = names.slice(0, Math.max(0, names.length - keep));
  for (const name of old) rmSync(join(dir, name), { recursive: true, force: true });
  return old.length;
}

const EXTENSION: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export function createQuestionRecord(options: Options): QuestionRecord {
  const keep = options.keep ?? RECORD_KEEP;
  const clock = options.now ?? (() => new Date());
  let warned = false;
  let current: { dir: string; startedAt: Date; kind: string; calls: number; steps: unknown[]; open?: { say: string; actions: unknown[] }; report: Record<string, unknown>; voice: string[]; errors: string[] } | undefined;

  /** Runs a write; whatever goes wrong is said once and never reaches the question. */
  const safely = (what: () => void): void => {
    try {
      what();
    } catch (error) {
      if (warned) return;
      warned = true;
      options.warn?.(`the record of questions could not be written (${error instanceof Error ? error.message : String(error)}); questions go on as usual`);
    }
  };
  const write = (name: string, data: string | Buffer): void => safely(() => current && writeFileSync(join(current.dir, name), data));
  const json = (name: string, value: unknown): void => write(name, `${JSON.stringify(value, null, 2)}\n`);
  const append = (name: string, text: string): void => safely(() => current && appendFileSync(join(current.dir, name), text));

  function writeSteps(): void {
    if (!current) return;
    json('steps.json', [...current.steps, ...(current.open ? [current.open] : [])]);
  }
  function writeReport(): void {
    if (!current) return;
    json('report.json', { startedAt: current.startedAt.toISOString(), kind: current.kind, ...current.report });
  }

  return {
    begin(kind) {
      safely(() => {
        mkdirSync(options.dir, { recursive: true });
        const at = clock();
        const base = folderName(at);
        let name = base;
        for (let i = 2; existsSync(join(options.dir, name)); i++) name = `${base}-${i}`;
        const dir = join(options.dir, name);
        mkdirSync(dir);
        current = { dir, startedAt: at, kind, calls: 0, steps: [], report: {}, voice: [], errors: [] };
        writeReport();
        pruneRecord(options.dir, keep);
      });
    },
    line(text) {
      if (!current) return;
      append('log.txt', `${clock().toISOString().slice(11, 23)} ${text}\n`);
    },
    transcript(text, speech) {
      if (!current) return;
      write('transcript.txt', `${text}\n`);
      if (speech) current.report.speech = speech;
    },
    picture(name, picture) {
      if (!current) return;
      write(`${name}.${EXTENSION[picture.mime] ?? 'img'}`, Buffer.from(picture.base64, 'base64'));
    },
    strokes(strokes) {
      if (!current || strokes.length === 0) return;
      json('pen-strokes.json', { scale: '0..1000 across the screenshot', strokes });
    },
    nextCall: () => (current ? ++current.calls : 0),
    call(call, raw) {
      if (!current) return;
      json(`call-${call.n}.json`, call);
      if (raw !== undefined) write(`call-${call.n}-raw.txt`, raw);
    },
    message(message) {
      if (!current) return;
      const c = current;
      if (message.kind === 'step' && typeof message.step === 'object' && message.step) {
        c.steps.push(message.step);
        writeSteps();
      } else if (message.kind === 'step-open') {
        c.open = { say: String(message.say ?? ''), actions: [] };
      } else if (message.kind === 'action' && c.open) {
        c.open.actions.push(message.action);
      } else if (message.kind === 'step-close' && c.open) {
        c.steps.push(c.open);
        c.open = undefined;
        writeSteps();
      }
    },
    issues(stepNumber, issues) {
      if (!current || issues.length === 0) return;
      append('repairs.txt', `step ${stepNumber}: ${issues.length} note${issues.length === 1 ? '' : 's'}\n${issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}\n`);
    },
    voice(text) {
      if (!current) return;
      current.voice.push(text);
      append('voice.txt', `${clock().toISOString().slice(11, 23)} ${text}\n`);
    },
    error(text) {
      if (!current) return;
      current.errors.push(text);
      append('errors.txt', `${clock().toISOString().slice(11, 23)} ${text}\n`);
    },
    report(report) {
      if (!current) return;
      Object.assign(current.report, report);
      writeReport();
      writeSteps();
    },
    folder: () => current?.dir,
  };
}

/**
 * The folder the record goes in: the one the person chose, else a folder of the app's own data. A chosen folder is taken as typed
 * (an absolute path); only folders named like a question's are ever deleted from it.
 */
export function recordDir(chosen: string | undefined, dataDir: string): string {
  return chosen && chosen.trim() ? chosen.trim() : join(dataDir, 'questions');
}
