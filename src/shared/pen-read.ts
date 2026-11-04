// What the person pointed at with the pen: their strokes grouped into the marks they made (up to three, in the order drawn), each read for
// what kind it is (a circle, an underline, an arrow), what it is on, and the box of the screen to show the model closer. The page's own
// ink grid, when there is one, grows a rough circle to the whole block it is mostly on, and an underline to the words above it.
//
// Pure: pen-shape.ts reads the stroke, pen-blocks.ts reads the page, pen.ts has the boxes.

import { blockAround, textAbove } from './pen-blocks.ts';
import type { InkGrid } from './pen-blocks.ts';
import { cropAround, groupStrokes, strokeBounds, unionOf } from './pen.ts';
import type { Box, Point } from './pen.ts';
import { readShape } from './pen-shape.ts';
import type { PenKind } from './pen-shape.ts';

export type PenMark = {
  kind: PenKind;
  /** The strokes of this mark, in the order drawn. */
  strokes: Point[][];
  /** What the mark is on, as far as the stroke and the page say (a box on the 0..1000 scale). */
  subject: Box;
  /** The box to crop for the model (padded, at least a minimum, inside the screen). */
  crop: Box;
  /** Where an arrow points. */
  tip?: Point;
  loops?: number;
  open?: boolean;
};

/** The marks of one press, in the order drawn. `grid` is the page's ink (null: the stroke's own shape only); `aspect` is the screen's width over its height. */
export function readPen(strokes: ReadonlyArray<ReadonlyArray<Point>>, grid: InkGrid | null, aspect = 16 / 9): PenMark[] {
  return groupStrokes(strokes).map((group): PenMark => {
    const shape = readShape(group, aspect);
    const own = strokeBounds(group) as Box;
    let subject = shape.subject;
    let crop: Box;
    if (shape.kind === 'underline') {
      const words = grid ? textAbove(grid, own.x, own.x + own.w, own.y + own.h / 2) : null;
      subject = words ?? subject;
      crop = cropAround(unionOf(subject, own));
    } else if (shape.kind === 'arrow') {
      const block = grid ? blockAround(grid, subject) : null;
      subject = block ?? subject;
      crop = cropAround(subject);
    } else {
      const block = grid ? blockAround(grid, subject) : null;
      subject = block ? unionOf(subject, block) : subject;
      crop = cropAround(subject);
    }
    return { kind: shape.kind, strokes: group.map((s) => [...s]), subject, crop, ...(shape.tip ? { tip: shape.tip } : {}), ...(shape.loops !== undefined ? { loops: shape.loops } : {}), ...(shape.open ? { open: true } : {}) };
  });
}
