// What the settings window shows and sends: the settings a person may change there, as plain values. The same shape goes both
// ways; main checks it with the very checks the settings file goes through (main/settings.ts) before anything is written.

export type Route = 'codex' | 'claude' | 'openai';
export type SplitMode = 'off' | 'two' | 'steps';

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
  /** 'off', 'two' (step 1, then the rest) or 'steps' (one step to a call); Claude route only. */
  splitAnswer: SplitMode;
};

export const FORM_KEYS: ReadonlyArray<keyof SettingsForm> = [
  'model', 'codexModel', 'claudeModel', 'openaiModel', 'codexFast', 'detailRoute', 'detailModel',
  'voiceServerUrl', 'voiceServerVoice', 'speechServerUrl', 'hotkey', 'captureBlocklist', 'guideNavigation', 'controlSnap', 'splitAnswer',
];

/** What main answers a save with. */
export type SaveResult =
  | { ok: true; form: SettingsForm; changed: boolean }
  | { ok: false; messages: string[] };

/** The settings that differ between two forms. */
export function changedKeys(before: SettingsForm, after: SettingsForm): Array<keyof SettingsForm> {
  return FORM_KEYS.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

/** What a save says, given what it changed: the list of windows to skip is in force at once, everything else when Talkthrough is restarted. */
export function savedMessage(changed: ReadonlyArray<keyof SettingsForm>): { text: string; restart: boolean } {
  if (changed.length === 0) return { text: 'Nothing was changed.', restart: false };
  const others = changed.filter((k) => k !== 'captureBlocklist');
  if (others.length === 0) return { text: 'Saved. The list of windows to skip is in force now.', restart: false };
  return { text: changed.includes('captureBlocklist') ? 'Saved. The list of windows to skip is in force now; restart Talkthrough for the other changes.' : 'Saved. Restart Talkthrough to use the changes.', restart: true };
}

/** The words a person is shown for each switch: one plain line each, written once so the page and the docs say the same. */
export const SWITCH_WARNINGS = {
  guideNavigation: 'When a guide asks for it, Talkthrough may open a tab, open a menu or scroll for you in desktop apps (never in a browser). It asks first and you can stop it at any time.',
  controlSnap: 'Reads the buttons and tabs of the window in front (only where they are, never their text) to place marks exactly. Never in a browser.',
  splitAnswer: 'On the Claude route, the first words come sooner. "In two calls" writes the first step alone, then the rest while you hear it; "One step at a time" writes each step in a call of its own. Each question then uses two or more calls of your Claude allowance.',
} as const;
