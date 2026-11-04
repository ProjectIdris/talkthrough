// Windows the person does not want looked at: if the window in front matches an entry of their list, a press of the chord does
// nothing (no microphone, no screen grab, nothing sent anywhere) and the overlay says so. Only the window in front is checked,
// and only by its app name, its program file and its title, read when the chord begins; nothing is kept.

/** What is known about the window in front. */
export type FrontWindow = { title?: string; appName?: string; path?: string };

/** The most entries, and the longest one, a list may hold (the settings window and the file are both held to this). */
export const SKIP_MAX_ENTRIES = 50;
export const SKIP_MAX_LENGTH = 80;
/** Shorter than this, an entry would match nearly any window. */
export const SKIP_MIN_LENGTH = 2;

/** Programs that hold secrets, skipped unless the person changes the list. */
export const DEFAULT_SKIP_LIST: readonly string[] = ['1Password', 'Bitwarden', 'KeePass', 'LastPass', 'Dashlane', 'Proton Pass'];

/** The list as typed (one entry a line, or already split): trimmed, cleaned of blanks and repeats, and what was dropped said in words. */
export function cleanSkipList(input: unknown, warn: (message: string) => void = () => undefined): string[] {
  const items = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/\r?\n/) : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const entry = item.trim();
    if (!entry) continue;
    if (entry.length < SKIP_MIN_LENGTH) {
      warn(`"${entry}" is too short to skip a window by (it would match nearly all of them)`);
      continue;
    }
    if (entry.length > SKIP_MAX_LENGTH) {
      warn(`an entry of ${entry.length} characters is too long (at most ${SKIP_MAX_LENGTH})`);
      continue;
    }
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    if (out.length >= SKIP_MAX_ENTRIES) {
      warn(`only the first ${SKIP_MAX_ENTRIES} entries are kept`);
      break;
    }
    seen.add(key);
    out.push(entry);
  }
  return out;
}

const baseName = (path: string): string => path.replace(/^.*[\\/]/, '').replace(/\.exe$/i, '');

/** The entry that the window matches (as part of its app name, program file or title, whatever the case), or null. */
export function skipMatch(list: readonly string[], win: FrontWindow | null | undefined): string | null {
  if (!win || list.length === 0) return null;
  const hay = [win.appName, win.path ? baseName(win.path) : undefined, win.title].filter((s): s is string => typeof s === 'string' && s !== '').map((s) => s.toLowerCase());
  for (const entry of list) {
    const needle = entry.toLowerCase();
    if (hay.some((h) => h.includes(needle))) return entry;
  }
  return null;
}

/** Why a press is not allowed: the window is on the list, or the check could not tell what the window is (which counts the same). */
export type SkipVerdict = { kind: 'listed'; entry: string } | { kind: 'blind'; why: string };

/** How long the read of the window in front may take before the press is refused. */
export const SKIP_DEADLINE_MS = 300;

export type SkipCheckOptions = {
  /** The read of the window in front; it may be slow, fail, or give nothing. */
  read(): Promise<FrontWindow | null | undefined>;
  deadlineMs?: number;
  /** Told, once, the first time the read fails or is too slow (for the log). */
  log?(line: string): void;
};

/**
 * Whether a press is allowed now: null when it is, otherwise why not. The list is asked for each time, so a list saved a moment ago
 * protects at once. With no list nothing is read at all. With a list, this fails closed: a read that throws, gives nothing, gives a
 * window with no name at all, or has not answered within the deadline all mean "do not look", never "look".
 */
export function createSkipCheck(list: () => readonly string[], options: SkipCheckOptions): () => Promise<SkipVerdict | null> {
  const deadline = options.deadlineMs ?? SKIP_DEADLINE_MS;
  let told = false;
  const blind = (why: string): SkipVerdict => {
    if (!told) {
      told = true;
      options.log?.(`the window in front could not be read (${why}); while there is a list of windows to skip, nothing is looked at then`);
    }
    return { kind: 'blind', why };
  };
  return async () => {
    const entries = list();
    if (entries.length === 0) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const front = await Promise.race([
        options.read(),
        new Promise<'late'>((resolve) => {
          timer = setTimeout(() => resolve('late'), deadline);
        }),
      ]);
      if (front === 'late') return blind(`no answer within ${deadline} ms`);
      if (!front || (!front.title && !front.appName && !front.path)) return blind('no window came back');
      const entry = skipMatch(entries, front);
      return entry ? { kind: 'listed', entry } : null;
    } catch (error) {
      return blind(error instanceof Error ? error.message : 'the read failed');
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
