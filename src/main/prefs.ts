import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** What the app itself remembers about choices made in its menu (the settings file is the person's own). */
export type Prefs = {
  /** Keep a picture of the screen with each pin. Off until the person ticks it. */
  pinScreenshot: boolean;
};

export function createPrefs(file: string) {
  let prefs: Prefs = { pinScreenshot: false };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Prefs>;
    if (raw && typeof raw.pinScreenshot === 'boolean') prefs = { pinScreenshot: raw.pinScreenshot };
  } catch {
    // none yet, or unreadable: the defaults
  }
  return {
    get(): Readonly<Prefs> {
      return prefs;
    },
    set(next: Partial<Prefs>): void {
      prefs = { ...prefs, ...next };
      mkdirSync(dirname(file), { recursive: true });
      const temporary = `${file}.tmp`;
      writeFileSync(temporary, JSON.stringify(prefs, null, 1));
      renameSync(temporary, file);
    },
  };
}
