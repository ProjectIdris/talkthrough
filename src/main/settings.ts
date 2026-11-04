import { readFileSync } from 'node:fs';

/**
 * The user's local settings (a JSON file in the app's data folder, or the path given with
 * --settings). Nothing here has a built-in address: a speech server is used only if the user names it.
 */
export type Settings = {
  /** Base URL of a local speech recogniser (see the SpeechToText adapter). Unset: no speech input. */
  speechServerUrl?: string;
  /** Which model answers: the user's ChatGPT plan through Codex, or their Claude plan. */
  model: 'codex' | 'claude';
  codexModel: string;
  /** Fast mode for the Codex process this app starts (not the user's own Codex settings). */
  codexFast: boolean;
  claudeModel: string;
  /** Explicit paths of the command-line tools; unset: found on PATH. */
  codexCommand?: string;
  claudeCommand?: string;
  /** How long Right Ctrl may be held alone before the early microphone and screen grab are dropped. */
  micWindowMs: number;
  /** Longer side of the screenshot sent to the model, in pixels. */
  screenshotEdge: number;
  /** Reasoning effort asked of the model. */
  effort: string;
};

export const DEFAULT_SETTINGS: Settings = {
  model: 'codex',
  codexModel: 'gpt-6-luna',
  codexFast: false,
  claudeModel: 'claude-haiku-5-5',
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
  if (raw.model === 'codex' || raw.model === 'claude') settings.model = raw.model;
  settings.codexModel = str(raw.codexModel) ?? settings.codexModel;
  if (typeof raw.codexFast === 'boolean') settings.codexFast = raw.codexFast;
  settings.claudeModel = str(raw.claudeModel) ?? settings.claudeModel;
  const codex = str(raw.codexCommand);
  if (codex) settings.codexCommand = codex;
  const claude = str(raw.claudeCommand);
  if (claude) settings.claudeCommand = claude;
  if (typeof raw.micWindowMs === 'number' && raw.micWindowMs >= 200 && raw.micWindowMs <= 5000) settings.micWindowMs = raw.micWindowMs;
  if (typeof raw.screenshotEdge === 'number' && raw.screenshotEdge >= 640 && raw.screenshotEdge <= 2560) settings.screenshotEdge = Math.round(raw.screenshotEdge);
  settings.effort = str(raw.effort) ?? settings.effort;
  return settings;
}
