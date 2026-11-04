/** Why an utterance ended. */
export type SpeechEnd = { reason: 'finished' | 'cancelled' | 'error'; error?: string };

export type SpeechListener = {
  /**
   * The voice started speaking. The renderer starts the step's tweens here.
   * `estimatedMs` is a guess at the utterance length when the voice can give one; tweens may stretch to it.
   */
  start?(event: { estimatedMs?: number }): void;
  /** Optional word progress; `charIndex` is an offset into the spoken text. */
  boundary?(event: { charIndex: number }): void;
  /** The utterance is over (finished, cancelled or failed). Called once. */
  end?(event: SpeechEnd): void;
};

export interface SpeechHandle {
  /** Settles when the utterance ends, for any reason. Never rejects. */
  readonly finished: Promise<SpeechEnd>;
  /**
   * Stops this utterance; `end` fires with reason 'cancelled' unless it had already ended.
   * Voices that share one queue (the browser's) also drop everything queued behind it.
   */
  cancel(): void;
}

/**
 * Speaks a step's text. speak() while another utterance is running queues behind it, in order;
 * cancel() stops the current one and drops the queue.
 */
export interface Voice {
  readonly id: string;
  speak(text: string, listener?: SpeechListener): SpeechHandle;
  /** Stops the current utterance and drops any queued. */
  cancel(): void;
}
