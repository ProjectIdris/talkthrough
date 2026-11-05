// Reading and saving the settings the settings window edits. A save goes through the same checks as the settings file (settingsFromRaw):
// the new values are put into the file's own contents (anything else in it is left as it was), checked as if the app were starting
// with them, and written only if they pass without a new complaint. Nothing is changed in the running app: the window says so.

import { copyFileSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { FORM_KEYS } from '../shared/settings-form.ts';
import type { SaveResult, SettingsForm } from '../shared/settings-form.ts';
import { cleanSkipList } from './skip-list.ts';
import { DEFAULT_SETTINGS, readRawSettings, settingsFromRaw } from './settings.ts';
import type { Settings } from './settings.ts';

export function formFromSettings(s: Settings): SettingsForm {
  return {
    model: s.model,
    codexModel: s.codexModel,
    claudeModel: s.claudeModel,
    openaiModel: s.openaiModel,
    codexFast: s.codexFast,
    detailRoute: s.detailRoute ?? '',
    detailModel: s.detailModel ?? '',
    voiceServerUrl: s.voiceServerUrl ?? '',
    voiceServerVoice: s.voiceServerVoice ?? '',
    speechServerUrl: s.speechServerUrl ?? '',
    hotkey: s.hotkey,
    captureBlocklist: [...s.captureBlocklist],
    guideNavigation: s.guideNavigation,
    controlSnap: s.controlSnap,
    splitAnswer: s.splitAnswer,
    captions: s.captions,
    keepRecord: s.keepRecord,
    recordFolder: s.recordFolder ?? '',
  };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The submitted form read strictly: every field present and of its own type, strings trimmed, the list cleaned. Anything else is a message. */
function readForm(input: unknown, complain: (message: string) => void): SettingsForm | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    complain('Nothing was saved: the form was not understood.');
    return null;
  }
  const raw = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let ok = true;
  for (const key of FORM_KEYS) {
    const v = raw[key];
    const want = key === 'codexFast' || key === 'guideNavigation' || key === 'controlSnap' || key === 'keepRecord' ? 'boolean' : key === 'captureBlocklist' ? 'list' : 'string';
    const right = want === 'list' ? Array.isArray(v) && v.every((x) => typeof x === 'string') : typeof v === want;
    if (!right) {
      complain(`Nothing was saved: "${key}" was missing or of the wrong kind.`);
      ok = false;
      continue;
    }
    out[key] = typeof v === 'string' ? v.trim() : v;
  }
  if (!ok) return null;
  const form = out as unknown as SettingsForm;
  form.captureBlocklist = cleanSkipList(form.captureBlocklist, (m) => complain(`The list of windows to skip: ${m}.`));
  form.hotkey = form.hotkey.toLowerCase();
  return form;
}

/** The loader's complaint (written for someone editing the file) in words for the window. */
function plain(message: string): string {
  if (message.startsWith('voiceServerUrl')) return 'The voice server address must start with https://, or be an address on this computer (http://127.0.0.1...).';
  if (message.startsWith('hotkey')) return 'Choose two different keys.';
  if (message.startsWith('captureBlocklist: ')) return `The list of windows to skip: ${message.slice('captureBlocklist: '.length)}.`;
  if (message.startsWith('recordFolder')) return 'Choose a full folder path for the record (such as C:\Users\you\Documents\questions), or leave it empty.';
  if (message.startsWith('detailRoute')) return 'Choose a route for the richer version, or turn it off.';
  const first = message.split(';')[0]!;
  return `${first[0]!.toUpperCase()}${first.slice(1)}.`;
}

export type SettingsService = {
  /** What the file says now (after the same checks the app starts with). */
  read(): SettingsForm;
  save(input: unknown): SaveResult;
};

export function createSettingsService(options: { path: string; warn?: (message: string) => void }): SettingsService {
  const warn = options.warn ?? (() => undefined);
  const current = (): Settings => settingsFromRaw(readRawSettings(options.path));
  return {
    read: () => formFromSettings(current()),
    save(input) {
      const messages: string[] = [];
      const form = readForm(input, (m) => messages.push(m));
      if (!form || messages.length > 0) return { ok: false, messages };
      // What the file already complains about is not this save's to fix: only a complaint that the new values bring stops it.
      const before = new Set<string>();
      const fileWarn = (m: string): void => void before.add(m);
      let broken = false;
      const raw = readRawSettings(options.path, (m) => {
        broken = true;
        fileWarn(m);
      });
      settingsFromRaw(raw, fileWarn);
      const next: Record<string, unknown> = { ...raw };
      delete next.twoStepAnswer; // the older form of splitAnswer: 'two'; the form's value replaces it
      const wanted = formToRaw(form);
      for (const key of FORM_KEYS) {
        if (key in wanted) next[key] = wanted[key];
        else delete next[key];
      }
      const added: string[] = [];
      const loaded = settingsFromRaw(next, (m) => {
        if (!before.has(m)) added.push(m);
      });
      if (added.length > 0) return { ok: false, messages: added.map(plain) };
      // A value the checks quietly changed (a bad word replaced by the default) is not what was asked for: say so instead.
      const echoed = formFromSettings(loaded);
      const different = FORM_KEYS.filter((k) => !same(echoed[k], form[k]));
      if (different.length > 0) return { ok: false, messages: different.map((k) => `"${k}" was not accepted as typed.`) };
      const changed = !same(formFromSettings(settingsFromRaw(raw)), echoed);
      const temp = `${options.path}.saving`;
      try {
        mkdirSync(dirname(options.path), { recursive: true });
        if (broken) {
          try {
            copyFileSync(options.path, `${options.path}.unreadable`);
          } catch {
            // nothing there to keep
          }
        }
        writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
        renameSync(temp, options.path);
      } catch (error) {
        try {
          unlinkSync(temp); // a half-finished save leaves nothing behind
        } catch {
          // there was none to remove
        }
        warn(`could not write the settings file: ${error instanceof Error ? error.message : String(error)}`);
        return { ok: false, messages: ['The settings file could not be written.'] };
      }
      return { ok: true, form: echoed, changed };
    },
  };
}

/** The keys to write for a form: a value that is the default (or empty, where there is none) is left out, so the file only says what was chosen. */
function formToRaw(form: SettingsForm): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const d = DEFAULT_SETTINGS;
  const put = (key: keyof SettingsForm, value: unknown, fallback: unknown): void => {
    if (value !== '' && !same(value, fallback)) out[key] = value;
  };
  put('model', form.model, d.model);
  put('codexModel', form.codexModel, d.codexModel);
  put('claudeModel', form.claudeModel, d.claudeModel);
  put('openaiModel', form.openaiModel, d.openaiModel);
  put('codexFast', form.codexFast, d.codexFast);
  put('detailRoute', form.detailRoute, undefined);
  put('detailModel', form.detailModel, undefined);
  put('voiceServerUrl', form.voiceServerUrl, undefined);
  put('voiceServerVoice', form.voiceServerVoice, undefined);
  put('speechServerUrl', form.speechServerUrl, undefined);
  put('hotkey', form.hotkey, d.hotkey);
  put('captureBlocklist', form.captureBlocklist, d.captureBlocklist);
  put('guideNavigation', form.guideNavigation, d.guideNavigation);
  put('controlSnap', form.controlSnap, d.controlSnap);
  put('splitAnswer', form.splitAnswer, d.splitAnswer);
  put('captions', form.captions, d.captions);
  put('keepRecord', form.keepRecord, d.keepRecord);
  put('recordFolder', form.recordFolder, undefined);
  return out;
}
