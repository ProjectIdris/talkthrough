// What a spoken question may ask of the app itself, before it is taken as a question for the model.
// Only the start of the sentence counts, so a question that merely mentions the backend is still a question.

export type Spoken =
  /** "Pin this": keep the answer on screen (the question, the thread, the scene) in the pins folder. */
  | { kind: 'pin' }
  /** "Ask the backend (...)": hand the question over; `rest` is the question after the phrase, or empty for "again, deeper". */
  | { kind: 'backend'; rest: string }
  /** "Show me in detail", "more detail": a richer version of the scene on screen from the detail model. */
  | { kind: 'detail' };

const LEAD = String.raw`^\s*(?:(?:hey|ok|okay|please|now)[,\s]+)*`;
const BACKEND = new RegExp(String.raw`${LEAD}(?:ask|send (?:this|that|it) to|pass (?:this|that|it) (?:on )?to|hand (?:this|that|it) (?:over )?to|take (?:this|that|it) to)\s+(?:the\s+)?(?:deeper\s+)?back\s?end\b[\s,.:;-]*(.*)$`, 'is');

/** The whole sentence has to be the request: "pin this", "pin that answer", "please pin it". */
const PIN = new RegExp(String.raw`${LEAD}pin\s+(?:this|that|it)(?:\s+(?:answer|one|down))?\s*[.!]*\s*$`, 'i');

/** The whole sentence has to be the request: "show me in detail", "more detail please", "can you add more detail", "in more detail". */
const DETAIL = new RegExp(
  String.raw`${LEAD}(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:(?:show|give|walk|take) (?:me|us)(?: through (?:it|this|that))?(?: in)?(?: much| a lot)?(?: more)?(?: detail| depth)|(?:add|give (?:me|us)|show (?:me|us)) (?:much |a lot )?more detail|(?:go|dig) (?:into|in)(?: much| a lot)? more (?:detail|depth)|(?:in|with) (?:much |a lot )?more detail|more detail|(?:much )?more detailed|in detail|in depth|zoom in on the detail)(?:\s+(?:please|on (?:this|that|it)))?\s*[.!?]*\s*$`,
  'i',
);

/** Recognises a spoken instruction to the app; null for an ordinary question. */
export function parseSpoken(text: string): Spoken | null {
  if (PIN.test(text)) return { kind: 'pin' };
  if (DETAIL.test(text)) return { kind: 'detail' };
  const backend = BACKEND.exec(text);
  if (backend) return { kind: 'backend', rest: (backend[1] ?? '').trim().replace(/^(?:about|:|,)\s+/i, '') };
  return null;
}
