import { mkdirSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { threadEntry } from '../adapters/backend.ts';
import type { ThreadTurn } from '../adapters/model.ts';
import type { Screenshot } from '../adapters/types.ts';

/** What a pin keeps. */
export type PinInput = {
  /** The question the pinned answer belongs to. */
  question: string;
  /** The conversation so far. Only the questions, lines spoken and incomplete status are written down. */
  thread: readonly ThreadTurn[];
  /** The scene on screen: every step drawn in this thread, oldest first. */
  steps: readonly unknown[];
  /** The clean screenshot. Given only when the user chose to keep it with pins. */
  screenshot?: Screenshot;
};

/** The file a pin is written to (`talkthrough: "pin"`). The scene is a scene-language document as it is. */
export type PinFile = {
  talkthrough: 'pin';
  v: 1;
  pinnedAt: string;
  question: string;
  thread: Array<ReturnType<typeof threadEntry>>;
  scene: { v: 1; steps: readonly unknown[] };
  /** The name of the picture saved beside it, when there is one. */
  screenshot?: string;
};

/** A short file-name piece from a question: lower-case letters and digits, hyphens between. */
export function slug(text: string): string {
  const s = text.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  return s || 'pin';
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/**
 * Saves pinned answers to one folder, a JSON file each (and, only when asked, a PNG of the screen).
 * This is all the app ever keeps: nothing else about a question or an answer is written to disk.
 */
export function createPins(options: { dir: string; now?: () => Date }) {
  const now = options.now ?? (() => new Date());

  function free(base: string, extension: string): string {
    for (let n = 1; ; n++) {
      const name = n === 1 ? `${base}.${extension}` : `${base}-${n}.${extension}`;
      if (!existsSync(join(options.dir, name))) return name;
    }
  }

  function write(name: string, data: string | Buffer): void {
    const target = join(options.dir, name);
    const temporary = `${target}.tmp`;
    writeFileSync(temporary, data);
    renameSync(temporary, target);
  }

  return {
    dir: options.dir,

    /** Writes the pin; returns the file name (inside `dir`). Throws if the folder cannot be written. */
    save(input: PinInput): { file: string; screenshot?: string } {
      mkdirSync(options.dir, { recursive: true });
      const at = now();
      const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
      const base = `${stamp}-${slug(input.question)}`;
      const file = free(base, 'json');
      const stem = file.slice(0, -'.json'.length);
      let picture: string | undefined;
      if (input.screenshot) {
        picture = `${stem}.png`;
        write(picture, Buffer.from(input.screenshot.base64, 'base64'));
      }
      const pin: PinFile = {
        talkthrough: 'pin',
        v: 1,
        pinnedAt: at.toISOString(),
        question: input.question,
        thread: input.thread.map(threadEntry),
        scene: { v: 1, steps: input.steps },
        ...(picture ? { screenshot: picture } : {}),
      };
      write(file, JSON.stringify(pin, null, 1));
      return { file, ...(picture ? { screenshot: picture } : {}) };
    },
  };
}
