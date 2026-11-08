// What the settings window shows and sends: the settings a person may change there, as plain values. The same shape goes both
// ways; main checks it with the very checks the settings file goes through (main/settings.ts) before anything is written.

export type Route = 'codex' | 'claude' | 'openai' | 'local';

/** Where a local model is looked for when no address is set: Ollama's own. */
export const DEFAULT_LOCAL_URL = 'http://127.0.0.1:11434/v1';

/** The models each connector is known to offer, for the pick lists; any other name can still be typed. A local model is whatever the user's server holds, so it has no list. */
export const KNOWN_MODELS: Record<Route, readonly string[]> = {
  claude: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1'],
  codex: ['gpt-6-luna', 'gpt-6.1-sol'],
  openai: ['gpt-6-luna', 'gpt-6.1-sol'],
  local: [],
};
export type SplitMode = 'off' | 'two' | 'steps';
export type { CaptionMode } from './captions.ts';
import type { CaptionMode } from './captions.ts';

export type SettingsForm = {
  /** Which route runs the model. */
  model: Route;
  codexModel: string;
  claudeModel: string;
  openaiModel: string;
  /** The local route: the model's name on a server on this computer, and that server's address (empty: not set). */
  localModel: string;
  localBaseUrl: string;
  codexFast: boolean;
  /** The route and model that write the steps after step 1; empty: the same as step 1. */
  laterRoute: '' | Route;
  laterModel: string;
  /** The microphone and the speaker, by the system's id and name; empty: the system's default. */
  microphone: string;
  microphoneName: string;
  speaker: string;
  speakerName: string;
  /** The route that writes the richer "more detail" version; empty: there is no detail pass. */
  detailRoute: '' | Route;
  /** Empty: that route's own default. */
  detailModel: string;
  /** Empty: the system voice. */
  voiceServerUrl: string;
  voiceServerVoice: string;
  /** Empty: the app cannot hear questions yet. */
  speechServerUrl: string;
  /** One key, or up to four joined by "+" ("right-ctrl+right-shift"), see src/shared/chord-keys.ts. */
  hotkey: string;
  /** One word or name per entry. */
  captureBlocklist: string[];
  guideNavigation: boolean;
  controlSnap: boolean;
  /** 'off', 'two' (step 1, then the rest) or 'steps' (one step to a call); Claude route only. */
  splitAnswer: SplitMode;
  /** What an answer's words are given as: 'voice' (spoken only), 'text' (shown only, no sound) or 'both' (spoken, with the words shown as they are said). */
  captions: CaptionMode;
  /** Keep a record of each question (a dated folder for each, the newest 50). */
  keepRecord: boolean;
  /** Where the record goes: a full folder path; empty: a folder in the app's own data folder. */
  recordFolder: string;
  /** Look for a newer version at start and once a day (nothing is downloaded without a yes). */
  checkForUpdates: boolean;
};

export const FORM_KEYS: ReadonlyArray<keyof SettingsForm> = [
  'model', 'codexModel', 'claudeModel', 'openaiModel', 'localModel', 'localBaseUrl', 'codexFast', 'laterRoute', 'laterModel', 'microphone', 'microphoneName', 'speaker', 'speakerName', 'detailRoute', 'detailModel',
  'voiceServerUrl', 'voiceServerVoice', 'speechServerUrl', 'hotkey', 'captureBlocklist', 'guideNavigation', 'controlSnap', 'splitAnswer', 'captions', 'keepRecord', 'recordFolder', 'checkForUpdates',
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
  splitAnswer: 'On the Claude route each answer is written one step to a call, so the first words come in about three to four seconds, not six to ten; it uses several calls of your Claude allowance a question. "In two calls" writes the first step alone, then the rest while you hear it; "In one call" writes it all at once, and the first words come later.',
  keepRecord: 'For each question this saves a folder with the screenshot sent, your pen marks, what you said as text, what the model wrote back and how long it took, the steps drawn, anything that had to be repaired or refused, which voice spoke and why, and any error. It stays on this computer, nothing is sent anywhere, and only the newest 50 questions are kept.',
  captions: 'With text and voice the words appear on screen as they are said, never ahead of the voice. With text only nothing is spoken: each step stays up as long as it takes to read, and the drawing keeps time with it. With voice only there are no words on screen.',
} as const;
