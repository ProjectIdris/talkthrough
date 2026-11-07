/** The offline explorer exposes catalog IDs, never scene paths or model/voice controls. */
export interface TourExample {
  id: string;
  title: string;
  description: string;
}

export interface TourState {
  examples: TourExample[];
  selected: string;
  title: string;
  /** Zero-based position in the selected scene. */
  step: number;
  steps: number;
  say: string;
  busy: boolean;
  error: string | null;
}

export type TourCommand =
  | { kind: 'select'; id: string }
  | { kind: 'next' }
  | { kind: 'back' }
  | { kind: 'restart' };

export const TOUR_CHANNEL = {
  state: 'tt:tour-state',
  get: 'tt:tour-get',
  command: 'tt:tour-command',
} as const;

export interface TourApi {
  state(): Promise<TourState | null>;
  command(command: TourCommand): void;
  onState(listener: (state: TourState) => void): void;
}

declare global {
  interface Window {
    talkthroughTour: TourApi;
  }
}
