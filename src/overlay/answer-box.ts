// The box for an answer that does not draw: its words, with the question over them. An answer that draws nothing (every step has no actions) is shown
// as words in a box, not as a caption pill under a drawing that is not there; the person can copy the words, pin the answer or close the box.
// This is the state only (what is said, what is shown, whether the box is up); overlay.ts draws it. Pure, so it is tested without a page.

import type { CaptionState } from './captions.ts';

/** The question is shown as a small heading; a long one is cut. */
export const QUESTION_CHARS = 160;

export type AnswerView = { question: string; /** The words said so far (all of them with text only). */ said: string; /** The words still to come: they keep their place in the box, unseen. */ rest: string };

export function answerBox() {
  let question = '';
  /** The steps already said, in order. */
  let done: string[] = [];
  /** The step being said, as the captions give it. */
  let current: CaptionState | null = null;
  let drawing = false;
  let closed = false;
  let stepsClosed = 0;

  return {
    /** A new answer begins: nothing of the last one stays. */
    reset(newQuestion: string): void {
      question = newQuestion.trim().slice(0, QUESTION_CHARS);
      done = [];
      current = null;
      drawing = false;
      closed = false;
      stepsClosed = 0;
    },
    /** What the captions say now (null: no step is being shown; the step that was is kept as said). */
    words(state: CaptionState | null): void {
      if (current && (!state || state.text !== current.text)) {
        done.push(current.text);
        current = null;
      }
      if (state) current = state;
    },
    /** Something is drawn in this answer: it is not a words-only answer, and the caption pill is what shows its words. */
    drew(): void {
      drawing = true;
    },
    /** A step is whole (it has all its actions, or none): only then is it known to be words only. */
    stepClosed(): void {
      stepsClosed++;
    },
    close(): void {
      closed = true;
    },
    /** Whether the box is up: a whole step with no drawing so far, some words to show, and not closed. */
    visible(): boolean {
      return !drawing && !closed && stepsClosed > 0 && (done.length > 0 || (current !== null && current.upTo > 0));
    },
    view(): AnswerView {
      const before = done.join(' ');
      const said = current ? current.text.slice(0, current.upTo) : '';
      const rest = current ? current.text.slice(current.upTo) : '';
      return { question, said: `${before}${before && said ? ' ' : ''}${said}`, rest: before && !said && rest ? ` ${rest}` : rest };
    },
    /** All the words of the answer, for Copy. */
    fullText(): string {
      return [...done, ...(current ? [current.text] : [])].join(' ').trim();
    },
  };
}
