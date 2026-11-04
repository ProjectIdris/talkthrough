// A lettered and numbered grid on the closer picture of what an answer enlarged, and the way back from a cell the model names to a point.
// Vision models place a point better by saying which cell a part is in than by estimating a coordinate: the picture is cut into columns A, B, C...
// across and rows 1, 2, 3... down, a cell may be named more finely with a letter for its quarter (a top left, b top right, c bottom left, d
// bottom right), and the point is the middle of what was named, on the card the picture is drawn on.

import type { Box } from './pen.ts';

export type Grid = { cols: number; rows: number };

/** Cells along the longer side of the picture. */
export const GRID_CELLS = 8;

/** The grid for a picture of this size in pixels: GRID_CELLS along the longer side, as many square-ish cells along the other (at least 2). */
export function gridFor(width: number, height: number): Grid {
  const longer = Math.max(width, height, 1);
  const cols = Math.max(2, Math.round((GRID_CELLS * width) / longer));
  const rows = Math.max(2, Math.round((GRID_CELLS * height) / longer));
  return { cols, rows };
}

/** The column letters of a grid ("A".."F"), for the prompt. */
export const lastColumn = (g: Grid): string => String.fromCharCode(64 + g.cols);

/**
 * The point (0..1000, on `card`, where the picture is drawn) for a cell name such as "C4" or "C4b" (case does not matter), or null when the
 * name is not a cell of the grid.
 */
export function cellPoint(name: unknown, grid: Grid, card: Box): [number, number] | null {
  if (typeof name !== 'string') return null;
  const m = /^\s*([A-Za-z])\s*(\d{1,2})\s*([a-dA-D])?\s*$/.exec(name);
  if (!m) return null;
  const col = (m[1] as string).toUpperCase().charCodeAt(0) - 65;
  const row = Number(m[2]) - 1;
  if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) return null;
  let u = (col + 0.5) / grid.cols, v = (row + 0.5) / grid.rows;
  if (m[3]) {
    const q = (m[3] as string).toLowerCase().charCodeAt(0) - 97; // 0 a, 1 b, 2 c, 3 d
    u += (q % 2 === 0 ? -0.25 : 0.25) / grid.cols;
    v += (q < 2 ? -0.25 : 0.25) / grid.rows;
  }
  return [Math.round((card.x + u * card.w) * 10) / 10, Math.round((card.y + v * card.h) * 10) / 10];
}
