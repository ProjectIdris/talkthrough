// The window in front, for the list of windows to skip (skip-list.ts). Read by name, program file and title only, on demand, and
// not kept. The reader is loaded when the app starts; if it will not load, nothing can be matched and the app goes on.

import type { FrontWindow } from './skip-list.ts';

export async function loadFrontWindow(log: (line: string) => void): Promise<() => FrontWindow | null> {
  try {
    const { activeWindowSync } = await import('get-windows');
    activeWindowSync(); // the first read is the slow one; do it now, not at the first press
    return () => {
      const w = activeWindowSync();
      if (!w) return null;
      return { title: w.title, appName: w.owner?.name, path: w.owner?.path };
    };
  } catch (error) {
    log(`the list of windows to skip cannot be used: ${error instanceof Error ? error.message : String(error)}`);
    return () => null;
  }
}
