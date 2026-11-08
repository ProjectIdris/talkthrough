// Pixel reading for scripts/capture-check.cjs, kept apart so it can be tested without a screen (test/capture-check-pixels.test.ts).

/**
 * The share (0 to 1) of the pixels in the middle of `rect` (the central 80 %, so antialiased edges and a shadow do not count) that are within `tol`
 * of the colour `rgb` on every channel. `bitmap` is { data, width, height } with data in BGRA order, as Electron's nativeImage.toBitmap() gives.
 * `rect` is in the bitmap's own pixels.
 */
function share(bitmap, rect, rgb, tol = 24) {
  const { data, width, height } = bitmap;
  const x0 = Math.max(0, Math.round(rect.x + rect.w * 0.1)), x1 = Math.min(width, Math.round(rect.x + rect.w * 0.9));
  const y0 = Math.max(0, Math.round(rect.y + rect.h * 0.1)), y1 = Math.min(height, Math.round(rect.y + rect.h * 0.9));
  let hit = 0, total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      total++;
      if (Math.abs(data[i + 2] - rgb[0]) <= tol && Math.abs(data[i + 1] - rgb[1]) <= tol && Math.abs(data[i] - rgb[2]) <= tol) hit++;
    }
  }
  return total === 0 ? 0 : hit / total;
}

/** A window's rectangle on its display (device-independent pixels, display-relative) as pixels of a picture of that display, whatever size the picture is. */
function toPicture(rect, display, picture) {
  const sx = picture.width / display.bounds.width, sy = picture.height / display.bounds.height;
  return { x: (rect.x - display.bounds.x) * sx, y: (rect.y - display.bounds.y) * sy, w: rect.w * sx, h: rect.h * sy };
}

/**
 * The smallest wait after which this and every longer wait lost no trial, from { settleMs: failures } counts; null when even the longest failed.
 * Waits are taken in ascending order of settleMs.
 */
function leastSafeWait(failuresBySettle) {
  const waits = Object.keys(failuresBySettle).map(Number).sort((a, b) => a - b);
  let best = null;
  for (let i = waits.length - 1; i >= 0; i--) {
    if (failuresBySettle[waits[i]] === 0) best = waits[i];
    else break;
  }
  return best;
}

module.exports = { share, toPicture, leastSafeWait };
