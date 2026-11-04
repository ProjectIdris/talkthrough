/** A recorded question: mono PCM samples in -1..1. */
export type SpeechClip = {
  samples: Float32Array;
  sampleRate: number;
};

export type Transcript = {
  text: string;
  /** Which recogniser produced it, when the implementation knows. */
  engine?: string;
  /** How long recognition took, in seconds, when the implementation knows. */
  seconds?: number;
};

export type SpeechToTextErrorCode = 'unavailable' | 'failed' | 'aborted' | 'empty';

export class SpeechToTextError extends Error {
  readonly code: SpeechToTextErrorCode;
  constructor(code: SpeechToTextErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SpeechToTextError';
    this.code = code;
  }
}

/**
 * Turns the recorded question into text, after the key is released. Implementations that call
 * out to a process or a server must say so in `id`, and must not log the recognised text.
 */
export interface SpeechToText {
  readonly id: string;
  transcribe(clip: SpeechClip, options?: { signal?: AbortSignal }): Promise<Transcript>;
  /** Optional: start whatever is slow to start (a model load) before the first question. */
  warm?(): Promise<void>;
  /** Optional: told that a question is about to be asked (the keys went down), so a server that sleeps can be woken. Best effort; never throws. */
  wake?(): Promise<void>;
  close?(): Promise<void>;
}
