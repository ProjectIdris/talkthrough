// The card that asks "may I open that for you?" with a Yes and a No. It is a small window of its own, not a part of the
// click-through overlay: the overlay learns that the pointer is over one of its buttons only from a mouse move, so a tap, or a
// click that arrives with no move before it, went through to the application underneath. A window that is never click-through
// takes the click whatever came before it (and never takes focus, so what the person is working in keeps it).
// This file is the part that needs no Electron (the controller and the page); consent-window.ts is the window itself.

export type Rect = { x: number; y: number; width: number; height: number };

export const CARD_SIZE = { width: 500, height: 104 };
export const CARD_MARGIN = 22;

/** Bottom right of the display's usable area, where the app's other cards are. */
export function cardBounds(area: Rect): Rect {
  return {
    x: Math.round(area.x + area.width - CARD_SIZE.width - CARD_MARGIN),
    y: Math.round(area.y + area.height - CARD_SIZE.height - CARD_MARGIN - 90),
    width: CARD_SIZE.width,
    height: CARD_SIZE.height,
  };
}

/** How the window is made (given to BrowserWindow as it is). Never click-through, which is the point; never focused; always on top. */
export const CARD_WINDOW_OPTIONS = {
  frame: false,
  focusable: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: false,
  movable: false,
  minimizable: false,
  maximizable: false,
  fullscreenable: false,
  show: false,
  hasShadow: true,
  backgroundColor: '#111622',
  title: 'Talkthrough',
} as const;

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** The scheme the buttons navigate to; the window never really goes there, main reads the address and stops it. */
export const ANSWER_SCHEME = 'tt-answer:';

/** The page: the question, and a Yes and a No that are links to an address main reads. */
export function cardHtml(text: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Talkthrough</title><style>
html,body{margin:0;height:100%;background:#111622;color:#eef3fb;font:14px/1.35 "Segoe UI",system-ui,sans-serif;overflow:hidden;user-select:none}
body{display:flex;align-items:center;gap:12px;padding:0 16px;box-sizing:border-box;border:1px solid rgba(255,255,255,.22);border-radius:12px}
p{flex:1;margin:0}
a{flex:none;text-decoration:none;font-weight:650;color:#0d1320;background:#7cc4ff;border-radius:9px;padding:8px 16px;cursor:pointer}
a:hover{background:#a3d6ff}
a.no{color:#eef3fb;background:rgba(255,255,255,.14)}
a.no:hover{background:rgba(255,255,255,.24)}
</style><p>${escapeHtml(text)}</p><a href="${ANSWER_SCHEME}//yes">Yes</a><a class="no" href="${ANSWER_SCHEME}//no">No</a>`;
}

/** The answer a navigation address stands for; null for any other address. */
export function answerOf(url: string): boolean | null {
  if (url === `${ANSWER_SCHEME}//yes` || url === `${ANSWER_SCHEME}//yes/`) return true;
  if (url === `${ANSWER_SCHEME}//no` || url === `${ANSWER_SCHEME}//no/`) return false;
  return null;
}

export type CardWindow = {
  /** Shows this page at these bounds, without taking focus. */
  show(html: string, bounds: Rect): void;
  hide(): void;
  destroy(): void;
  /** Called with the answer when a button is clicked. */
  onAnswer(listener: (yes: boolean) => void): void;
};

export type ConsentCardDeps = {
  makeWindow(): CardWindow;
  /** The usable area of a display, or null when it is not known. */
  areaOf(displayId: number): Rect | null;
  /** The person clicked Yes or No. */
  onAnswer(yes: boolean): void;
};

export type ConsentCard = {
  /** Shows the question on this display (or moves it there, with this text). */
  show(displayId: number, text: string): void;
  /** Takes the card away; nothing when it is not showing. */
  hide(): void;
  dispose(): void;
};

export function createConsentCard(deps: ConsentCardDeps): ConsentCard {
  let window: CardWindow | null = null;
  let showing = false;
  return {
    show(displayId, text) {
      const area = deps.areaOf(displayId);
      if (!area) return;
      if (!window) {
        window = deps.makeWindow();
        window.onAnswer((yes) => {
          showing = false;
          window?.hide();
          deps.onAnswer(yes);
        });
      }
      showing = true;
      window.show(cardHtml(text), cardBounds(area));
    },
    hide() {
      if (!showing) return;
      showing = false;
      window?.hide();
    },
    dispose() {
      showing = false;
      window?.destroy();
      window = null;
    },
  };
}
