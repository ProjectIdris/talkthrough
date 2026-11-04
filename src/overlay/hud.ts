// The small things the overlay says about the app itself, apart from the drawing: that it is
// listening, that it is working, a short notice, and an offer to ask a deeper helper. This is the
// state only; overlay.ts shows it. Times are given by the caller.

export type Status = 'listening' | 'working' | 'idle';
export type NoticeLevel = 'info' | 'error';

/** How long a notice stays before it fades, and how long the fade takes. */
export const NOTICE_MS: Record<NoticeLevel, number> = { info: 4000, error: 6500 };
export const NOTICE_FADE_MS = 500;

export type HudView = {
  status: Status;
  /** The reason text of the offer, or null when there is none. */
  offer: string | null;
  notice: { text: string; level: NoticeLevel; alpha: number } | null;
};

export class HudState {
  private status: Status = 'idle';
  private offerReason: string | null = null;
  private notice: { text: string; level: NoticeLevel; at: number } | undefined;

  setStatus(status: Status): void {
    this.status = status;
  }

  /** The offer card; it stays until the next question starts, a click on it, or `dismissOffer`. */
  offer(reason: string): void {
    this.offerReason = reason;
  }

  dismissOffer(): void {
    this.offerReason = null;
  }

  showNotice(text: string, level: NoticeLevel, now: number): void {
    this.notice = { text, level, at: now };
  }

  dismissNotice(): void {
    this.notice = undefined;
  }

  /** The first step has arrived or the turn is over: the thinking indicator has done its job. */
  stopWorking(): void {
    if (this.status === 'working') this.status = 'idle';
  }

  /** A new question begins: the offer, the notice and the listening cue belong to the last one. The thinking indicator stays until the first step. */
  newTurn(): void {
    this.offerReason = null;
    this.notice = undefined;
    if (this.status === 'listening') this.status = 'idle';
  }

  /** Clear: everything goes. */
  reset(): void {
    this.status = 'idle';
    this.offerReason = null;
    this.notice = undefined;
  }

  view(now: number): HudView {
    let notice: HudView['notice'] = null;
    if (this.notice) {
      const age = now - this.notice.at;
      const life = NOTICE_MS[this.notice.level];
      if (age >= life + NOTICE_FADE_MS) this.notice = undefined;
      else notice = { text: this.notice.text, level: this.notice.level, alpha: age <= life ? 1 : 1 - (age - life) / NOTICE_FADE_MS };
    }
    return { status: this.status, offer: this.offerReason, notice };
  }

  /** Milliseconds until the view changes by itself (a notice starting to fade or going), or undefined. */
  untilChange(now: number): number | undefined {
    if (!this.notice) return undefined;
    const age = now - this.notice.at;
    const life = NOTICE_MS[this.notice.level];
    if (age < life) return life - age;
    return age < life + NOTICE_FADE_MS ? 0 : undefined;
  }
}
