// What a button on the overlay page may ask of main, read strictly: the page is a web page, so what it sends is checked here, not trusted.

import type { PageAction } from '../shared/ipc.ts';

/** The most text one Copy puts on the clipboard. */
export const COPY_MAX_CHARS = 20_000;

export function readAction(input: unknown): PageAction | null {
  if (typeof input !== 'object' || input === null) return null;
  const { what, text } = input as { what?: unknown; text?: unknown };
  if (what === 'settings' || what === 'hearing' || what === 'pin') return { what };
  if (what === 'copy' && typeof text === 'string' && text.trim() !== '') return { what: 'copy', text: text.slice(0, COPY_MAX_CHARS) };
  return null;
}
