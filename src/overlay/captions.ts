// The captions on the overlay page: the words of the step being spoken (or read), shown as text. What is shown, how much of it, and where.
//
// The driver follows what the voice tells it (a step starts to be heard, a word begins, the voice ends) and keeps the state the page draws.
// With the voice and the text together a word is shown only when the voice has come to it: from the system voice's word boundaries, or, for a
// server's voice, from the sound that has really been heard (adapters/streamed-voice.ts). A voice that gives neither is followed by the
// clock, slower than it speaks, so the words are late rather than early. With text only the whole step is shown at once and stays as long as
// it takes to read. Pure: the page owns the element and the timers.

import { createSpokenClock, wordSpans } from '../shared/captions.ts';
import type { CaptionMode } from '../shared/captions.ts';

export type CaptionState = {
  /** The whole sentence of the step (the pill is sized for all of it, so it does not jump as words come). */
  text: string;
  /** How many characters from the start are shown now. */
  upTo: number;
  /** Set once the step has been said (or its reading time is over): the words stay a moment, then go. */
  endedAt: number | undefined;
};

export type CaptionDriverOptions = {
  mode: CaptionMode;
  /** Told whenever what is shown changes; null when nothing is. */
  onChange(state: CaptionState | null): void;
  now?(): number;
  /** Runs `run` after `ms`; gives back the cancel. */
  after?(ms: number, run: () => void): () => void;
  /** Runs `run` every `ms`; gives back the stop. */
  every?(ms: number, run: () => void): () => void;
};

/** When no word boundary has come this long after the voice started, the voice does not give them and the words follow the clock instead. */
export const NO_BOUNDARY_MS = 1500;
/** The clock is slower than the voice by this much, so that it never runs ahead of it. */
export const CLOCK_LAG = 1.25;

export type CaptionDriver = ReturnType<typeof createCaptionDriver>;

export function createCaptionDriver(options: CaptionDriverOptions) {
  const now = options.now ?? (() => performance.now());
  const after = options.after ?? ((ms, run) => {
    const id = setTimeout(run, ms);
    return () => clearTimeout(id);
  });
  const every = options.every ?? ((ms, run) => {
    const id = setInterval(run, ms);
    return () => clearInterval(id);
  });
  let state: CaptionState | null = null;
  let generation = 0;
  let stops: Array<() => void> = [];
  let sawBoundary = false;

  const publish = (next: CaptionState | null): void => {
    state = next;
    options.onChange(next);
  };
  const stopAll = (): void => {
    for (const s of stops) s();
    stops = [];
  };
  const endOfWord = (text: string, charIndex: number): number => {
    const span = wordSpans(text).find((w) => charIndex >= w.start && charIndex < w.end) ?? wordSpans(text).find((w) => w.start >= charIndex);
    return span ? span.end : text.length;
  };

  const reveal = (upTo: number): void => {
    if (!state || upTo <= state.upTo) return;
    publish({ ...state, upTo: Math.min(state.text.length, upTo) });
  };

  return {
    /** A step with these words begins (before its voice has started: nothing is shown yet with the voice, the whole text with text only). */
    stepStart(say: string): void {
      stopAll();
      generation++;
      sawBoundary = false;
      const text = say.trim();
      if (options.mode === 'voice' || !text) return publish(null);
      publish({ text, upTo: options.mode === 'text' ? text.length : 0, endedAt: undefined });
    },
    /** The voice began to be heard (`estimatedMs`: how long it will take, as far as it knows). */
    voiceStart(estimatedMs: number | undefined): void {
      if (options.mode !== 'both' || !state) return;
      const text = state.text;
      const mine = generation;
      // A voice that gives no word boundaries is followed by the clock, slowly.
      const total = Math.max(1, (estimatedMs ?? text.length * 70) * CLOCK_LAG);
      const startedAt = now();
      const stopWait = after(NO_BOUNDARY_MS, () => {
        if (mine !== generation || sawBoundary || !state) return;
        const clock = createSpokenClock(text, total);
        const stopTick = every(60, () => {
          if (mine !== generation || sawBoundary || !state) return stopTick();
          for (const w of clock.due(now() - startedAt)) reveal(w.end);
        });
        stops.push(stopTick);
      });
      stops.push(stopWait);
    },
    /** The voice came to the word at this character. */
    boundary(charIndex: number): void {
      if (options.mode !== 'both' || !state) return;
      sawBoundary = true;
      reveal(endOfWord(state.text, charIndex));
    },
    /** Shows up to this many characters (never fewer than are shown already). */
    reveal,
    /** The step has been said (or its reading time is over): all the words are shown, and the end is noted. */
    voiceEnd(): void {
      if (!state) return;
      stopAll();
      publish({ ...state, upTo: state.text.length, endedAt: now() });
    },
    /** The answer is cleared or a new question begins: nothing is shown. */
    clear(): void {
      stopAll();
      generation++;
      if (state) publish(null);
    },
    get current(): CaptionState | null {
      return state;
    },
  };
}

// ---- Where the caption sits -------------------------------------------------------------------------------------------------------

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Where a caption of this size goes in a view: the bottom middle, unless something is there (a mark, the stage, a card), then the top
 * middle, then the corners, whichever leaves the most clear. `keepOut` is what to keep clear of, in pixels. The first candidate wins a tie.
 */
export function captionSpot(view: { width: number; height: number }, size: { w: number; h: number }, keepOut: readonly Rect[], prefer?: { x: number; y: number }): { x: number; y: number } {
  const edge = Math.round(Math.min(view.width, view.height) * 0.04);
  const midX = Math.round((view.width - size.w) / 2);
  const bottom = view.height - size.h - edge;
  const candidates = [
    { x: midX, y: bottom },
    { x: midX, y: edge },
    { x: edge, y: bottom },
    { x: view.width - size.w - edge, y: bottom },
    { x: edge, y: edge },
    { x: view.width - size.w - edge, y: edge },
  ];
  const clear = (c: { x: number; y: number }): number => {
    const box = { x: c.x - 12, y: c.y - 12, w: size.w + 24, h: size.h + 24 };
    let overlap = 0;
    for (const k of keepOut) overlap += Math.max(0, Math.min(box.x + box.w, k.x + k.w) - Math.max(box.x, k.x)) * Math.max(0, Math.min(box.y + box.h, k.y + k.h) - Math.max(box.y, k.y));
    return overlap;
  };
  // Where it was, while that is still clear: a caption does not hop about.
  if (prefer && clear(prefer) === 0) return prefer;
  let best = candidates[0] as { x: number; y: number };
  let bestOverlap = Infinity;
  for (const c of candidates) {
    const overlap = clear(c);
    if (overlap < bestOverlap) {
      bestOverlap = overlap;
      best = c;
      if (overlap === 0) break;
    }
  }
  return best;
}
