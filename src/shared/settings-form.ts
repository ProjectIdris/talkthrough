// What the settings window shows and sends: the settings a person may change there, as plain values. The same shape goes both
// ways; main checks it with the very checks the settings file goes through (main/settings.ts) before anything is written.

export type Route = 'codex' | 'claude' | 'openai';

export type SettingsForm = {
  /** Which route runs the model. */
  model: Route;
  codexModel: string;
  claudeModel: string;
  openaiModel: string;
  codexFast: boolean;
  /** The route that writes the richer "more detail" version; empty: there is no detail pass. */
  detailRoute: '' | Route;
  /** Empty: that route's own default. */
  detailModel: string;
  /** Empty: the system voice. */
  voiceServerUrl: string;
  voiceServerVoice: string;
  /** Empty: the app cannot hear questions yet. */
  speechServerUrl: string;
  /** "first+second", see CHORD_KEYS. */
  hotkey: string;
  /** One word or name per entry. */
  captureBlocklist: string[];
  guideNavigation: boolean;
  controlSnap: boolean;
};

export const FORM_KEYS: ReadonlyArray<keyof SettingsForm> = [
  'model', 'codexModel', 'claudeModel', 'openaiModel', 'codexFast', 'detailRoute', 'detailModel',
  'voiceServerUrl', 'voiceServerVoice', 'speechServerUrl', 'hotkey', 'captureBlocklist', 'guideNavigation', 'controlSnap',
];

/** What main answers a save with. */
export type SaveResult =
  | { ok: true; form: SettingsForm; changed: boolean }
  | { ok: false; messages: string[] };

/** The words a person is shown for each switch: one plain line each, written once so the page and the docs say the same. */
export const SWITCH_WARNINGS = {
  guideNavigation: 'When a guide asks for it, Talkthrough may open a tab, open a menu or scroll for you in desktop apps (never in a browser). It asks first and you can stop it at any time.',
  controlSnap: 'Reads the buttons and tabs of the window in front (only where they are, never their text) to place marks exactly. Never in a browser.',
} as const;
