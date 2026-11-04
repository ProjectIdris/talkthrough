import { desktopCapturer, screen } from 'electron';
import type { Display } from 'electron';
import type { Screenshot } from '../adapters/types.ts';

export type Capture = {
  screenshot: Screenshot;
  display: Display;
  /** Size of the display in physical pixels, before scaling down for the model. */
  nativeWidth: number;
  nativeHeight: number;
  /** How long the capture took, in milliseconds. */
  ms: number;
};

/** The display the pointer is on now. */
export function displayUnderPointer(): Display {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

/**
 * The id of the capture source for one display. Only the list is built here (no thumbnails), which is
 * quick; the hidden media page does the actual grabbing and scaling, away from the main process.
 * Matched by display id; when the system leaves ids empty, by position in the display list; never
 * guessed, because the marks are mapped to this display and the wrong screen would put them on the wrong picture.
 */
export async function screenSourceId(display: Display): Promise<string> {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
  const byId = sources.find((s) => s.display_id === String(display.id));
  const index = screen.getAllDisplays().findIndex((d) => d.id === display.id);
  const source = byId ?? (sources.every((s) => s.display_id === '') ? sources[index] : undefined);
  if (!source) throw new Error('could not tell which captured screen is the display under the pointer');
  return source.id;
}
