// The small things the overlay says about the app itself, apart from the drawing: that it is
// listening, that it is working, a short notice, and an offer to ask a deeper helper. This is the
// state only; overlay.ts shows it. Times are given by the caller.

export type Status = 'listening' | 'working' | 'backend' | 'detail' | 'waiting' | 'checking' | 'idle';
export type NoticeLevel = 'info' | 'error' | 'warning';
/** A button on a notice that fixes what it says. */
export type NoticeAction = 'hearing' | 'settings';
/** The words on the button of each action. */
export const ACTION_LABELS: Record<NoticeAction, string> = { hearing: 'Set up hearing', settings: 'Open Settings' };

/** What the dock says for each status (the page shows a few more things beside it for listening and thinking). */
export const STATUS_LABELS: Record<Exclude<Status, 'idle'>, string> = {
  listening: 'Listening',
  working: 'Thinking',
  backend: 'With the backend',
  detail: 'Adding detail\u2026',
  waiting: 'Your turn: click',
  checking: 'Checking',
};

/** How long a notice stays before it fades, and how long the fade takes. */
export const NOTICE_MS: Record<NoticeLevel, number> = { info: 4000, error: 6500, warning: 6500 };
/** A notice with a button stays this much longer: there is something to press. */
export const ACTION_EXTRA_MS = 4000;
export const NOTICE_FADE_MS = 500;

export type HudView = {
  status: Status;
  /** The reason text of the offer, or null when there is none. */
  offer: string | null;
  notice: { text: string; level: NoticeLevel; alpha: number; action?: NoticeAction } | null;
};

type Notice = { text: string; level: NoticeLevel; at: number; action?: NoticeAction };

export class HudState {
  private status: Status = 'idle';
  private offerReason: string | null = null;
  private notice: Notice | undefined;
  /** A retained warning returns after any temporary notice has faded. */
  private persistentNotice: Notice | undefined;

  private life(n: Notice): number {
    return NOTICE_MS[n.level] + (n.action ? ACTION_EXTRA_MS : 0);
  }

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

  showNotice(text: string, level: NoticeLevel, now: number, action?: NoticeAction, persistent = false): void {
    const notice = { text, level, at: now, ...(action ? { action } : {}) };
    if (persistent) {
      this.persistentNotice = notice;
      this.notice = undefined;
    } else this.notice = notice;
  }

  dismissNotice(): void {
    if (this.notice) this.notice = undefined;
    else this.persistentNotice = undefined;
  }

  /** The first step has arrived or the turn is over: the thinking indicator has done its job. */
  stopWorking(): void {
    if (this.status === 'working' || this.status === 'backend') this.status = 'idle';
  }

  /** A new question begins: the offer, the notice and the listening cue belong to the last one. The thinking indicator stays until the first step. */
  newTurn(): void {
    this.offerReason = null;
    this.notice = undefined;
    this.persistentNotice = undefined;
    if (this.status === 'listening') this.status = 'idle';
  }

  /** Clear: everything goes. */
  reset(): void {
    this.status = 'idle';
    this.offerReason = null;
    this.notice = undefined;
    this.persistentNotice = undefined;
  }

  view(now: number): HudView {
    let notice: HudView['notice'] = null;
    if (this.notice) {
      const age = now - this.notice.at;
      const life = this.life(this.notice);
      if (age >= life + NOTICE_FADE_MS) this.notice = undefined;
      else notice = { text: this.notice.text, level: this.notice.level, alpha: age <= life ? 1 : 1 - (age - life) / NOTICE_FADE_MS, ...(this.notice.action ? { action: this.notice.action } : {}) };
    }
    if (!notice && this.persistentNotice) {
      const n = this.persistentNotice;
      notice = { text: n.text, level: n.level, alpha: 1, ...(n.action ? { action: n.action } : {}) };
    }
    return { status: this.status, offer: this.offerReason, notice };
  }

  /** Milliseconds until the view changes by itself (a notice starting to fade or going), or undefined. */
  untilChange(now: number): number | undefined {
    if (!this.notice) return undefined;
    const age = now - this.notice.at;
    const life = this.life(this.notice);
    if (age < life) return life - age;
    return age < life + NOTICE_FADE_MS ? 0 : undefined;
  }
}
