// The person's say-so before the app acts for them (see Guide Mode Navigation). The first move in a session waits for a "yes":
// spoken through the recogniser (the session offers every short utterance to `answer` while an ask is open), or a click on Yes
// in the tray or on the overlay. After a yes, moves carry on for the rest of the session (until the app quits). Separately a
// pause (a tray item) stops every move at once, and a move being prepared when it is turned on is dropped. Nothing is written
// anywhere: a yes is a flag in memory.

export type ConsentAnswer = 'yes' | 'no' | 'timeout' | 'cancelled';

export type NavConsent = {
  /** The person has said yes to the app acting for them, this session. */
  given(): boolean;
  /** All moves are paused (the tray item). */
  paused(): boolean;
  setPaused(on: boolean): void;
  /** A question is open and waiting for a yes. */
  pending(): boolean;
  /** Opens the question and waits for the answer; a second call while one is open shares it. Already given: yes at once. */
  ask(): Promise<ConsentAnswer>;
  /** The person's answer, from the tray, the overlay or their voice. False when nothing was being asked. */
  answer(yes: boolean): boolean;
  /** Closes an open question without an answer (the walk ended, they pressed Escape or clicked something else). */
  cancel(): void;
  /** Called whenever the state changes (so the tray can redraw). */
  onChange(listener: () => void): void;
};

export type ConsentOptions = {
  /** How long a question waits before it counts as no answer. */
  timeoutMs?: number;
  after?(ms: number, run: () => void): () => void;
};

export function createNavConsent(options: ConsentOptions = {}): NavConsent {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const after = options.after ?? ((ms, run) => {
    const t = setTimeout(run, ms);
    return () => clearTimeout(t);
  });
  let given = false;
  let paused = false;
  let open: { promise: Promise<ConsentAnswer>; settle(a: ConsentAnswer): void } | null = null;
  const listeners: Array<() => void> = [];
  const changed = (): void => listeners.forEach((l) => l());

  function settle(a: ConsentAnswer): void {
    const o = open;
    if (!o) return;
    open = null;
    o.settle(a);
    changed();
  }

  return {
    given: () => given,
    paused: () => paused,
    setPaused(on) {
      if (paused === on) return;
      paused = on;
      if (on) settle('no'); // a question waiting when everything is paused is a no
      changed();
    },
    pending: () => open !== null,
    ask() {
      if (paused) return Promise.resolve('no');
      if (given) return Promise.resolve('yes');
      if (open) return open.promise;
      let resolve!: (a: ConsentAnswer) => void;
      const promise = new Promise<ConsentAnswer>((r) => (resolve = r));
      const stop = after(timeoutMs, () => settle('timeout'));
      open = { promise, settle: (a) => { stop(); resolve(a); } };
      changed();
      return promise;
    },
    answer(yes) {
      if (!open) return false;
      if (yes) given = true;
      settle(yes ? 'yes' : 'no');
      return true;
    },
    cancel: () => settle('cancelled'),
    onChange: (listener) => void listeners.push(listener),
  };
}

const YES = /^(?:(?:ok|okay|yes|yeah|yep|yup|sure|please|alright|all right)[\s,.!]*)+(?:go ahead|do it|go on|that's fine|that is fine|that's ok|that's okay)?[\s,.!]*$|^(?:go ahead|do it|go on|please do|sure thing|that's fine|that is fine|you can|yes you can|yes please|that works)[\s,.!]*$/i;
const NO = /^(?:no|nope|nah|don't|do not|stop|cancel|not now|no thanks|no thank you|never mind|leave it|i'll do it|i will do it)[\s,.!]*(?:i'll do it myself|i will do it myself|myself|please)?[\s,.!]*$/i;

/** A short utterance as an answer to "may I do this for you?": yes, no, or null when it is something else (an ordinary question). */
export function parseConsent(text: string): 'yes' | 'no' | null {
  const t = text.trim();
  if (!t || t.length > 40) return null;
  if (NO.test(t)) return 'no';
  if (YES.test(t)) return 'yes';
  return null;
}
