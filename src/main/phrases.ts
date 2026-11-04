// What a spoken question may ask of the app itself, before it is taken as a question for the model.
// Only the start of the sentence counts, so a question that merely mentions the backend is still a question.

export type Spoken =
  /** "Ask the backend (...)": hand the question over; `rest` is the question after the phrase, or empty for "again, deeper". */
  | { kind: 'backend'; rest: string };

const LEAD = String.raw`^\s*(?:(?:hey|ok|okay|please|now)[,\s]+)*`;
const BACKEND = new RegExp(String.raw`${LEAD}(?:ask|send (?:this|that|it) to|pass (?:this|that|it) (?:on )?to|hand (?:this|that|it) (?:over )?to|take (?:this|that|it) to)\s+(?:the\s+)?(?:deeper\s+)?back\s?end\b[\s,.:;-]*(.*)$`, 'is');

/** Recognises a spoken instruction to the app; null for an ordinary question. */
export function parseSpoken(text: string): Spoken | null {
  const backend = BACKEND.exec(text);
  if (backend) return { kind: 'backend', rest: (backend[1] ?? '').trim().replace(/^(?:about|:|,)\s+/i, '') };
  return null;
}
