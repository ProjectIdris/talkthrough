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

export const DEFAULT_SETTINGS: Settings = {
  model: 'codex',
  codexModel: 'gpt-6-luna',
  codexFast: false,
  claudeModel: 'claude-haiku-5-5',
  openaiModel: 'gpt-6-luna',
  micWindowMs: 1000,
  screenshotEdge: 1280,
  effort: 'low',
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
  const codex = str(raw.codexCommand);
  if (codex) settings.codexCommand = codex;
  const claude = str(raw.claudeCommand);
  if (claude) settings.claudeCommand = claude;
  if (typeof raw.micWindowMs === 'number' && raw.micWindowMs >= 200 && raw.micWindowMs <= 5000) settings.micWindowMs = raw.micWindowMs;
  if (typeof raw.screenshotEdge === 'number' && raw.screenshotEdge >= 640 && raw.screenshotEdge <= 2560) settings.screenshotEdge = Math.round(raw.screenshotEdge);
  settings.effort = str(raw.effort) ?? settings.effort;
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
