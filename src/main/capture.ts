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
 * Captures one display into memory, scaled so its longer side is at most `maxEdge` pixels.
 * The image exists only as the returned base64 string; nothing is written anywhere.
 */
export async function captureDisplay(display: Display, maxEdge = 1280): Promise<Capture> {
  const started = performance.now();
  const nativeWidth = Math.round(display.size.width * display.scaleFactor);
  const nativeHeight = Math.round(display.size.height * display.scaleFactor);
  // Ask the capturer for the final size directly: scaling the full-size frame on the main thread
  // costs seconds on a large display, and a busy main thread delays the key hook's release event.
  const scale = Math.min(1, maxEdge / Math.max(nativeWidth, nativeHeight));
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(nativeWidth * scale), height: Math.round(nativeHeight * scale) },
  });
  // Match by display id; when the system leaves it empty, by position in the display list, never by
  // guessing: the marks are mapped to this display, so the wrong screen would put them on the wrong picture.
  const byId = sources.find((s) => s.display_id === String(display.id));
  const index = screen.getAllDisplays().findIndex((d) => d.id === display.id);
  const source = byId ?? (sources.every((s) => s.display_id === '') ? sources[index] : undefined);
  if (!source) throw new Error('could not tell which captured screen is the display under the pointer');
  const image = source.thumbnail;
  const final = image.getSize();
  return {
    screenshot: { mime: 'image/png', base64: image.toPNG().toString('base64'), width: final.width, height: final.height },
    display,
    nativeWidth,
    nativeHeight,
    ms: Math.round(performance.now() - started),
  };
}
