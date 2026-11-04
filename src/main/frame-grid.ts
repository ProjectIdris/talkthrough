// Turns a screenshot into the coarse brightness grid that guide mode compares (see ../shared/screen-diff.ts).
// Electron's image decoder does the work; the picture is first shrunk so a look at the screen stays cheap.

import { nativeImage } from 'electron';
import type { Screenshot } from '../adapters/types.ts';
import { GRID_COLS, GRID_ROWS, gridFromPixels } from '../shared/screen-diff.ts';
import type { Grid } from '../shared/screen-diff.ts';

export function gridOf(shot: Screenshot): Grid {
  const image = nativeImage.createFromBuffer(Buffer.from(shot.base64, 'base64'));
  if (image.isEmpty()) throw new Error('the screenshot could not be decoded');
  const small = image.resize({ width: GRID_COLS * 2, height: GRID_ROWS * 2, quality: 'good' });
  const { width, height } = small.getSize();
  return gridFromPixels(small.toBitmap(), width, height, 'bgra');
}
