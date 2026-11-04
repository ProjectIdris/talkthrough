// Captions: the words of a step shown as text. What a person may choose (voice only, text only, or both), how the words of a spoken step
// are shown only as they are said, and how long a step lasts when it is only read.
//
// Pure: the voices (adapters/), the page (overlay/captions.ts) and the settings (main/settings.ts) all use these.

export const CAPTION_MODES = ['voice', 'text', 'both'] as const;
export type CaptionMode = (typeof CAPTION_MODES)[number];
export const DEFAULT_CAPTION_MODE: CaptionMode = 'both';

export const isCaptionMode = (v: unknown): v is CaptionMode => typeof v === 'string' && (CAPTION_MODES as readonly string[]).includes(v);

/** Where each word of the text is: its first character and the one after its last. */
export function wordSpans(text: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (const m of text.matchAll(/\S+/g)) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

/**
 * How much time a word takes to say, in characters' worth: its letters, and a pause for the mark that follows it (a voice stops at a
 * comma, longer at a full stop), so words after a pause are not shown too early.
 */
export function speechWeight(word: string): number {
  const letters = word.replace(/[^\p{L}\p{N}]/gu, '').length;
  const tail = /[.!?…]+["')\]]*$/.test(word) ? 5 : /[;:—–]["')\]]*$/.test(word) ? 3 : /,["')\]]*$/.test(word) ? 2 : 0;
  return Math.max(1, letters) + tail;
}

/**
 * When, in a spoken text that lasts `totalMs`, each word is being said: the middle of the word's share of the time (a word is shown while
 * it is being said, never before it starts, and a voice that is a little uneven only makes the words a little late).
 */
export function spokenTimes(text: string, totalMs: number): Array<{ charIndex: number; end: number; atMs: number }> {
  const spans = wordSpans(text);
  const weights = spans.map((s) => speechWeight(text.slice(s.start, s.end)));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  let before = 0;
  return spans.map((s, i) => {
    const w = weights[i] as number;
    const atMs = (totalMs * (before + w * 0.5)) / sum;
    before += w;
    return { charIndex: s.start, end: s.end, atMs };
  });
}

/**
 * Follows the sound being heard through a spoken text: `due(heardMs)` gives the words that have now begun to be said, once each, in order.
 * `totalMs` is how long the voice will take; it may be told a better figure later (`retime`), and the words not yet shown move with it.
 */
export function createSpokenClock(text: string, totalMs: number) {
  let times = spokenTimes(text, totalMs);
  let next = 0;
  return {
    /** The words (their first character and the end of the word) newly due when `heardMs` of the sound has been heard. */
    due(heardMs: number): Array<{ charIndex: number; end: number }> {
      const out: Array<{ charIndex: number; end: number }> = [];
      while (next < times.length && (times[next] as { atMs: number }).atMs <= heardMs) {
        const t = times[next] as { charIndex: number; end: number };
        out.push({ charIndex: t.charIndex, end: t.end });
        next++;
      }
      return out;
    },
    retime(newTotalMs: number): void {
      times = spokenTimes(text, newTotalMs);
    },
    /** Every word not yet given (the sound has ended). */
    rest(): Array<{ charIndex: number; end: number }> {
      const out = times.slice(next).map((t) => ({ charIndex: t.charIndex, end: t.end }));
      next = times.length;
      return out;
    },
    get shown(): number {
      return next;
    },
  };
}

/** Reading speed for a step that is only read: words a second, and a moment at the start to take the page in. */
export const READING_WORDS_PER_SECOND = 3;
export const READING_LEAD_SECONDS = 1.5;
export const READING_MIN_SECONDS = 3.5;

/** How long a step that is only read lasts: its words at a reading pace (not a speaking one), never less than a few seconds. */
export function readingSeconds(text: string): number {
  const words = wordSpans(text).length;
  return Math.max(READING_MIN_SECONDS, READING_LEAD_SECONDS + words / READING_WORDS_PER_SECOND);
}
