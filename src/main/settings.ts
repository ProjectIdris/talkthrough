import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { DEFAULT_HOTKEY, parseHotkey } from './chord.ts';
import { cleanSkipList, DEFAULT_SKIP_LIST } from './skip-list.ts';
import { isLoopbackUrl } from '../adapters/local-model.ts';
import { normaliseLater } from './model-plan.ts';
import type { Route, SplitMode } from '../shared/settings-form.ts';
import { DEFAULT_CAPTION_MODE, isCaptionMode } from '../shared/captions.ts';
import type { CaptionMode } from '../shared/captions.ts';

/**
 * The user's local settings (a JSON file in the app's data folder, or the path given with
 * --settings). Nothing here has a built-in address: a speech server is used only if the user names it.
 */
export type Settings = {
  /** Base URL of a local speech recogniser (see the SpeechToText adapter). Unset: no speech input. */
  speechServerUrl?: string;
  /** Asked of the speech server as limit_ms: how long its main recogniser may take before its quicker one answers. */
  speechLimitMs?: number;
  /** Which route runs the model: the user's own Codex CLI, their own Claude Code, or an API key (OpenAI). */
  model: Route;
  codexModel: string;
  /** Fast mode for the Codex process this app starts (not the user's own Codex settings). */
  codexFast: boolean;
  claudeModel: string;
  /** The older way to name a different model for the steps after step 1 (Claude route only); read as laterRoute 'claude' + laterModel. Writing the settings form removes it. */
  claudeLaterModel?: string;
  /**
   * The model that writes the steps after step 1, when it is not the one that wrote step 1 (see main/model-plan.ts): its route (unset: the first step's route)
   * and its name (unset: that route's own model). Naming a different one makes the answer be written one step to a call.
   */
  laterRoute?: Route;
  laterModel?: string;
  /** The local route: a model on this computer behind an OpenAI-compatible server (Ollama, LM Studio), by name; it must take pictures. */
  localModel: string;
  /** The address of that server's API (an address on this computer only). */
  localBaseUrl?: string;
  /** The microphone and the speaker the person chose, by the system's device id and name; unset: the system's default. A device that has gone falls back to the default. */
  microphone?: string;
  microphoneName?: string;
  speaker?: string;
  speakerName?: string;
  /** The API-key route: model name, an optional service tier (costs more), and an optional base address (https or loopback only). */
  openaiModel: string;
  openaiServiceTier?: string;
  openaiBaseUrl?: string;
  /** Where the deeper backend is reached (https or a loopback address; see docs/backend.md). Unset: no backend, nothing is ever sent there. */
  backendUrl?: string;
  /** How long to wait for the backend's answer, in milliseconds. */
  backendTimeoutMs?: number;
  /**
   * A text-to-speech server the voice is made by (https or a loopback address; see docs/setup.md for what it must do): the full
   * address a POST goes to. Unset: the system voice. The words of each step are sent there, and nothing else.
   */
  voiceServerUrl?: string;
  /** Which voice to ask the server for (sent as `voice`), if it has several. */
  voiceServerVoice?: string;
  /** How long the server has to make its first sound before the system voice speaks instead, in milliseconds (a server that makes a sentence whole and sends it takes 1 to 6 s; the step waits as long). */
  voiceFirstAudioMs: number;
  /** How long the server is then left alone, in milliseconds. */
  voiceCooldownMs: number;
  /** How long one utterance may take in all, in milliseconds. */
  voiceTimeoutMs: number;
  /**
   * The two keys held together to ask (see CHORD_KEYS in chord.ts), as "first+second"; the first, held alone, opens the
   * microphone and the screen grab early. Read once, at start.
   */
  hotkey: string;
  /**
   * Words that name windows never to look at (matched against the app name, program file and title of the window in front, whatever
   * the case): a press of the chord then does nothing. See skip-list.ts.
   */
  captureBlocklist: string[];
  /** Explicit paths of the command-line tools; unset: found on PATH. */
  codexCommand?: string;
  claudeCommand?: string;
  /** How long Right Ctrl may be held alone before the early microphone and screen grab are dropped. */
  micWindowMs: number;
  /** Longer side of the screenshot sent to the model, in pixels. */
  screenshotEdge: number;
  /** Reasoning effort asked of the model. */
  effort: string;
  /**
   * Snap marks to the real controls (buttons, tabs, menu items) of the window in front, read read-only from the
   * system's accessibility tree on Windows (nothing is clicked, no names are read, nothing leaves the machine). Off
   * until the person turns it on: marks then snap to the picture alone. Browser windows (Chromium, Electron, Firefox)
   * are never read either way, because reading one turns its accessibility on until it is restarted.
   */
  controlSnap: boolean;
  /**
   * Guide mode may open a tab, open a menu that has a submenu, or scroll for the person (see guide-nav.ts): it says so aloud
   * first, they can stop it, and the guard refuses everything else (a button, a link, a check box, a field, anything that
   * saves, sends, deletes or buys). Windows, native windows only, and off until the person turns it on.
   */
  guideNavigation: boolean;
  /**
   * Claude route only: write the quick answer in pieces so the first word comes sooner. 'two': step 1 alone first, then the steps after it
   * in a second call while step 1 is spoken (adapters/two-step.ts). 'steps': one step to a call, each asked for as the one before it ends
   * (adapters/step-by-step.ts). Either costs more calls a question. 'steps' unless the person chooses otherwise (Alex, 5 Nov); 'off' is a choice that is written to the file. The older `twoStepAnswer: true` means 'two' and `false` means 'off'.
   */
  splitAnswer: SplitMode;
  /** What an answer's words are given as: spoken ('voice'), shown ('text', no sound) or both (the words appear as they are said). Both unless the person chooses otherwise. */
  captions: CaptionMode;
  /**
   * The detail pass: which route writes a much richer version of the scene on screen when the person asks for more
   * detail (a button beside the model, or "show me in detail"). Unset: there is no detail pass and nothing offers it.
   * It is never started by itself.
   */
  detailRoute?: Route;
  /** The model the detail route uses; unset: DETAIL_MODELS has a stronger default for each route. */
  detailModel?: string;
  /** Reasoning effort for the detail pass (default: DETAIL_EFFORT). */
  detailEffort?: string;
  /**
   * Keep a record of each question: a dated folder per question (the screenshot sent, the pen marks, what was said, each model call's raw text and timings,
   * the steps drawn, what the checks repaired or refused, which voice spoke and why, any error), the newest 50 kept. Off until the person turns it on.
   * Nothing leaves the computer. It is a setting, not a check run.
   */
  keepRecord: boolean;
  /** Where the record goes (an absolute folder); unset: a folder named `questions` in the app's data folder. */
  recordFolder?: string;
};

/** What each route uses for the detail pass when the settings name no model: a stronger one than the quick answers use. */
export const DETAIL_MODELS: Record<Route, string> = {
  codex: 'gpt-6.1-sol',
  claude: 'claude-sonnet-5-5',
  openai: 'gpt-6.1-sol',
  /** The model on this computer is the one named for the local route. */
  local: '',
};
export const DETAIL_EFFORT = 'medium';
/** Where a local model is looked for when no address is set: Ollama's own. */
export const DEFAULT_LOCAL_BASE_URL = 'http://127.0.0.1:11434/v1';
/** How long a detail answer may take (a stronger model writing a richer scene is slower than a quick answer's 60 s). */
export const DETAIL_TIMEOUT_MS = 240_000;

export const DEFAULT_SETTINGS: Settings = {
  model: 'codex',
  codexModel: 'gpt-6-luna',
  codexFast: false,
  claudeModel: 'claude-haiku-5-5',
  openaiModel: 'gpt-6-luna',
  localModel: '',
  micWindowMs: 1000,
  screenshotEdge: 1280,
  effort: 'low',
  controlSnap: false,
  guideNavigation: false,
  keepRecord: false,
  splitAnswer: 'steps',
  captions: DEFAULT_CAPTION_MODE,
  voiceFirstAudioMs: 10_000,
  voiceCooldownMs: 20_000,
  voiceTimeoutMs: 30_000,
  hotkey: DEFAULT_HOTKEY,
  captureBlocklist: [...DEFAULT_SKIP_LIST],
};

const isRoute = (v: unknown): v is Route => v === 'codex' || v === 'claude' || v === 'openai' || v === 'local';
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** The settings file as an object; a missing or broken file is an empty one (and says why). */
export function readRawSettings(path: string, warn: (message: string) => void = () => undefined): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    warn('the settings file is not an object; using defaults');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warn(`could not read the settings file: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {};
}

/** Reads the settings file; a missing or broken file gives the defaults (and says why). */
export function loadSettings(path: string, warn: (message: string) => void = () => undefined): Settings {
  return settingsFromRaw(readRawSettings(path, warn), warn);
}

/** The checks every setting goes through, whether it came from the file or from the settings window. */
export function settingsFromRaw(raw: Record<string, unknown>, warn: (message: string) => void = () => undefined): Settings {
  const settings: Settings = { ...DEFAULT_SETTINGS };
  const url = str(raw.speechServerUrl);
  if (url) settings.speechServerUrl = url;
  if (typeof raw.speechLimitMs === 'number' && raw.speechLimitMs >= 200 && raw.speechLimitMs <= 15000) settings.speechLimitMs = Math.round(raw.speechLimitMs);
  if (isRoute(raw.model)) settings.model = raw.model;
  settings.codexModel = str(raw.codexModel) ?? settings.codexModel;
  if (typeof raw.codexFast === 'boolean') settings.codexFast = raw.codexFast;
  settings.claudeModel = str(raw.claudeModel) ?? settings.claudeModel;
  const later = str(raw.claudeLaterModel);
  if (later && later !== settings.claudeModel) settings.claudeLaterModel = later;
  settings.openaiModel = str(raw.openaiModel) ?? settings.openaiModel;
  settings.localModel = str(raw.localModel) ?? settings.localModel;
  const localBase = str(raw.localBaseUrl);
  if (localBase) {
    if (isLoopbackUrl(localBase)) settings.localBaseUrl = localBase;
    else warn('localBaseUrl must be an address on this computer (such as http://127.0.0.1:11434/v1); no local model address is used');
  }
  if (isRoute(raw.laterRoute)) settings.laterRoute = raw.laterRoute;
  else if (raw.laterRoute !== undefined) warn('laterRoute must be codex, claude, openai or local; the later steps use the first step\'s route');
  const laterModel = str(raw.laterModel);
  if (laterModel) settings.laterModel = laterModel;
  for (const key of ['microphone', 'microphoneName', 'speaker', 'speakerName'] as const) {
    const v = str(raw[key]);
    if (v && v.length <= 400) settings[key] = v;
  }
  const tier = str(raw.openaiServiceTier);
  if (tier) settings.openaiServiceTier = tier;
  const base = str(raw.openaiBaseUrl);
  if (base) {
    if (safeBaseUrl(base)) settings.openaiBaseUrl = base;
    else warn('openaiBaseUrl must be https (or a loopback address); using the default');
  }
  const backend = str(raw.backendUrl);
  if (backend) {
    if (safeBaseUrl(backend)) settings.backendUrl = backend;
    else warn('backendUrl must be https (or a loopback address); no backend is used');
  }
  if (typeof raw.backendTimeoutMs === 'number' && raw.backendTimeoutMs >= 5000 && raw.backendTimeoutMs <= 900_000) settings.backendTimeoutMs = Math.round(raw.backendTimeoutMs);
  const voiceUrl = str(raw.voiceServerUrl);
  if (voiceUrl) {
    if (safeBaseUrl(voiceUrl)) settings.voiceServerUrl = voiceUrl;
    else warn('voiceServerUrl must be https (or a loopback address); the system voice is used');
  }
  const voiceName = str(raw.voiceServerVoice);
  if (voiceName && voiceName.length <= 80) settings.voiceServerVoice = voiceName;
  // The step waits as long as the voice is given (the player's patience follows this), so the allowance has an upper limit of its own.
  if (typeof raw.voiceFirstAudioMs === 'number' && raw.voiceFirstAudioMs >= 300 && raw.voiceFirstAudioMs <= 30_000) settings.voiceFirstAudioMs = Math.round(raw.voiceFirstAudioMs);
  if (typeof raw.voiceCooldownMs === 'number' && raw.voiceCooldownMs >= 2000 && raw.voiceCooldownMs <= 600_000) settings.voiceCooldownMs = Math.round(raw.voiceCooldownMs);
  if (typeof raw.voiceTimeoutMs === 'number' && raw.voiceTimeoutMs >= 5000 && raw.voiceTimeoutMs <= 120_000) settings.voiceTimeoutMs = Math.round(raw.voiceTimeoutMs);
  if (raw.hotkey !== undefined) {
    if (typeof raw.hotkey === 'string' && parseHotkey(raw.hotkey)) settings.hotkey = raw.hotkey.split('+').map((p) => p.trim().toLowerCase()).join('+');
    else warn(`hotkey must be one key, or up to four different keys joined by + (such as right-ctrl+right-shift; the names are in src/shared/chord-keys.ts); using ${DEFAULT_HOTKEY}`);
  }
  if (raw.captureBlocklist !== undefined) {
    if (Array.isArray(raw.captureBlocklist)) settings.captureBlocklist = cleanSkipList(raw.captureBlocklist, (m) => warn(`captureBlocklist: ${m}`));
    else warn('captureBlocklist must be a list of words; using the default list');
  }
  const codex = str(raw.codexCommand);
  if (codex) settings.codexCommand = codex;
  const claude = str(raw.claudeCommand);
  if (claude) settings.claudeCommand = claude;
  if (typeof raw.micWindowMs === 'number' && raw.micWindowMs >= 200 && raw.micWindowMs <= 5000) settings.micWindowMs = raw.micWindowMs;
  if (typeof raw.screenshotEdge === 'number' && raw.screenshotEdge >= 640 && raw.screenshotEdge <= 2560) settings.screenshotEdge = Math.round(raw.screenshotEdge);
  settings.effort = str(raw.effort) ?? settings.effort;
  if (typeof raw.controlSnap === 'boolean') settings.controlSnap = raw.controlSnap;
  if (typeof raw.guideNavigation === 'boolean') settings.guideNavigation = raw.guideNavigation;
  if (raw.splitAnswer === 'off' || raw.splitAnswer === 'two' || raw.splitAnswer === 'steps') settings.splitAnswer = raw.splitAnswer;
  else if (raw.splitAnswer !== undefined) warn('splitAnswer must be off, two or steps; using steps');
  else if (raw.twoStepAnswer === true) settings.splitAnswer = 'two';
  else if (raw.twoStepAnswer === false) settings.splitAnswer = 'off'; // an older explicit "off" stays off
  if (isCaptionMode(raw.captions)) settings.captions = raw.captions;
  else if (raw.captions !== undefined) warn('captions must be voice, text or both; using both');
  if (isRoute(raw.detailRoute)) settings.detailRoute = raw.detailRoute;
  else if (raw.detailRoute !== undefined) warn('detailRoute must be codex, claude, openai or local; there is no detail pass');
  const detailModel = str(raw.detailModel);
  if (detailModel) settings.detailModel = detailModel;
  const detailEffort = str(raw.detailEffort);
  if (detailEffort) settings.detailEffort = detailEffort;
  if (typeof raw.keepRecord === 'boolean') settings.keepRecord = raw.keepRecord;
  const recordFolder = str(raw.recordFolder);
  if (recordFolder) {
    if (isAbsolute(recordFolder)) settings.recordFolder = recordFolder;
    else warn('recordFolder must be a full folder path (for example C:\\Users\\you\\Documents\\questions); the app data folder is used');
  }
  // Older: a different model for the later steps on the Claude route.
  if (!settings.laterRoute && !settings.laterModel && settings.claudeLaterModel && settings.model === 'claude') settings.laterModel = settings.claudeLaterModel;
  const tidy = normaliseLater({ model: settings.model, codexModel: settings.codexModel, claudeModel: settings.claudeModel, openaiModel: settings.openaiModel, localModel: settings.localModel, laterRoute: settings.laterRoute ?? '', laterModel: settings.laterModel ?? '' });
  delete settings.laterRoute;
  delete settings.laterModel;
  if (tidy.laterRoute) settings.laterRoute = tidy.laterRoute;
  if (tidy.laterModel) settings.laterModel = tidy.laterModel;
  return settings;
}

/** A key is only ever sent over https, or to a loopback address (a local server for checks). */
export function safeBaseUrl(text: string): boolean {
  try {
    const url = new URL(text);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]');
  } catch {
    return false;
  }
}
