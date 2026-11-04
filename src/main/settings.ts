import { readFileSync } from 'node:fs';

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
  model: 'codex' | 'claude' | 'openai';
  codexModel: string;
  /** Fast mode for the Codex process this app starts (not the user's own Codex settings). */
  codexFast: boolean;
  claudeModel: string;
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
  /** How long the server has to make its first sound before the system voice speaks instead, in milliseconds. */
  voiceFirstAudioMs: number;
  /** How long the server is then left alone, in milliseconds. */
  voiceCooldownMs: number;
  /** How long one utterance may take in all, in milliseconds. */
  voiceTimeoutMs: number;
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
   * The detail pass: which route writes a much richer version of the scene on screen when the person asks for more
   * detail (a button beside the model, or "show me in detail"). Unset: there is no detail pass and nothing offers it.
   * It is never started by itself.
   */
  detailRoute?: 'codex' | 'claude' | 'openai';
  /** The model the detail route uses; unset: DETAIL_MODELS has a stronger default for each route. */
  detailModel?: string;
  /** Reasoning effort for the detail pass (default: DETAIL_EFFORT). */
  detailEffort?: string;
};

/** What each route uses for the detail pass when the settings name no model: a stronger one than the quick answers use. */
export const DETAIL_MODELS: Record<'codex' | 'claude' | 'openai', string> = {
  codex: 'gpt-6.1-sol',
  claude: 'claude-sonnet-5-5',
  openai: 'gpt-6.1-sol',
};
export const DETAIL_EFFORT = 'medium';
/** How long a detail answer may take (a stronger model writing a richer scene is slower than a quick answer's 60 s). */
export const DETAIL_TIMEOUT_MS = 240_000;

export const DEFAULT_SETTINGS: Settings = {
  model: 'codex',
  codexModel: 'gpt-6-luna',
  codexFast: false,
  claudeModel: 'claude-haiku-5-5',
  openaiModel: 'gpt-6-luna',
  micWindowMs: 1000,
  screenshotEdge: 1280,
  effort: 'low',
  controlSnap: false,
  guideNavigation: false,
  voiceFirstAudioMs: 2000,
  voiceCooldownMs: 20_000,
  voiceTimeoutMs: 30_000,
};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Reads the settings file; a missing or broken file gives the defaults (and says why). */
export function loadSettings(path: string, warn: (message: string) => void = () => undefined): Settings {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
    else warn('the settings file is not an object; using defaults');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warn(`could not read the settings file: ${error instanceof Error ? error.message : String(error)}`);
  }
  const settings: Settings = { ...DEFAULT_SETTINGS };
  const url = str(raw.speechServerUrl);
  if (url) settings.speechServerUrl = url;
  if (typeof raw.speechLimitMs === 'number' && raw.speechLimitMs >= 200 && raw.speechLimitMs <= 15000) settings.speechLimitMs = Math.round(raw.speechLimitMs);
  if (raw.model === 'codex' || raw.model === 'claude' || raw.model === 'openai') settings.model = raw.model;
  settings.codexModel = str(raw.codexModel) ?? settings.codexModel;
  if (typeof raw.codexFast === 'boolean') settings.codexFast = raw.codexFast;
  settings.claudeModel = str(raw.claudeModel) ?? settings.claudeModel;
  settings.openaiModel = str(raw.openaiModel) ?? settings.openaiModel;
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
  // The first sound has to come within the player's own patience (2.5 s), or the step has moved on without it.
  if (typeof raw.voiceFirstAudioMs === 'number' && raw.voiceFirstAudioMs >= 300 && raw.voiceFirstAudioMs <= 2400) settings.voiceFirstAudioMs = Math.round(raw.voiceFirstAudioMs);
  if (typeof raw.voiceCooldownMs === 'number' && raw.voiceCooldownMs >= 2000 && raw.voiceCooldownMs <= 600_000) settings.voiceCooldownMs = Math.round(raw.voiceCooldownMs);
  if (typeof raw.voiceTimeoutMs === 'number' && raw.voiceTimeoutMs >= 5000 && raw.voiceTimeoutMs <= 120_000) settings.voiceTimeoutMs = Math.round(raw.voiceTimeoutMs);
  const codex = str(raw.codexCommand);
  if (codex) settings.codexCommand = codex;
  const claude = str(raw.claudeCommand);
  if (claude) settings.claudeCommand = claude;
  if (typeof raw.micWindowMs === 'number' && raw.micWindowMs >= 200 && raw.micWindowMs <= 5000) settings.micWindowMs = raw.micWindowMs;
  if (typeof raw.screenshotEdge === 'number' && raw.screenshotEdge >= 640 && raw.screenshotEdge <= 2560) settings.screenshotEdge = Math.round(raw.screenshotEdge);
  settings.effort = str(raw.effort) ?? settings.effort;
  if (typeof raw.controlSnap === 'boolean') settings.controlSnap = raw.controlSnap;
  if (typeof raw.guideNavigation === 'boolean') settings.guideNavigation = raw.guideNavigation;
  if (raw.detailRoute === 'codex' || raw.detailRoute === 'claude' || raw.detailRoute === 'openai') settings.detailRoute = raw.detailRoute;
  else if (raw.detailRoute !== undefined) warn('detailRoute must be codex, claude or openai; there is no detail pass');
  const detailModel = str(raw.detailModel);
  if (detailModel) settings.detailModel = detailModel;
  const detailEffort = str(raw.detailEffort);
  if (detailEffort) settings.detailEffort = detailEffort;
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
