// A gray picture of the screenshot at a size marks can be snapped against (about a thousand cells across).
// The only DOM part of snapping: snap.ts itself takes the numbers this makes.

import { Snapper } from './snap.ts';

const SNAP_COLS = 960;

/** The picture shrunk in halves (so thin lines and text blur into tones, as they would to the eye) to `cols` wide, as gray levels. */
export function grayOf(image: CanvasImageSource, width: number, height: number, cols = SNAP_COLS): { gray: Uint8Array; cols: number; rows: number } | undefined {
  const outCols = Math.min(cols, width);
  const outRows = Math.max(1, Math.round((height * outCols) / width));
  let from: CanvasImageSource = image;
  let fw = width, fh = height;
  while (fw > outCols * 2 && fh > outRows * 2) {
    const step = document.createElement('canvas');
    step.width = Math.max(outCols, Math.ceil(fw / 2));
    step.height = Math.max(outRows, Math.ceil(fh / 2));
    const sc = step.getContext('2d');
    if (!sc) return undefined;
    sc.imageSmoothingQuality = 'high';
    sc.drawImage(from, 0, 0, step.width, step.height);
    from = step;
    fw = step.width;
    fh = step.height;
  }
  const canvas = document.createElement('canvas');
  canvas.width = outCols;
  canvas.height = outRows;
  const c = canvas.getContext('2d', { willReadFrequently: true });
  if (!c) return undefined;
  c.imageSmoothingQuality = 'high';
  c.drawImage(from, 0, 0, outCols, outRows);
  const data = c.getImageData(0, 0, outCols, outRows).data;
  const gray = new Uint8Array(outCols * outRows);
  for (let i = 0; i < gray.length; i++) gray[i] = (data[i * 4] as number) * 0.3 + (data[i * 4 + 1] as number) * 0.59 + (data[i * 4 + 2] as number) * 0.11;
  return { gray, cols: outCols, rows: outRows };
}

/** A snapper for the picture, or nothing when it cannot be read. */
export function snapperFor(image: CanvasImageSource, width: number, height: number): Snapper | undefined {
  const g = grayOf(image, width, height);
  return g ? new Snapper(g.gray, g.cols, g.rows) : undefined;
}
