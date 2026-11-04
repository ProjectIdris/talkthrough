// The look of the overlay's 2D drawings (marks, labels, diagram cards, arrows, tags), in one place so they read as one system:
// thin lines, a soft shadow in place of a hard dark halo, and a calmer palette. The 3D models do not use any of this: their
// colours are the scene's own. Every colour still has to read on a light page and on a dark one, so each is a mid tone.

import { PALETTE_RGB } from '../scene/colors.ts';
import type { Rgb } from '../scene/colors.ts';

/** The calmer 2D versions of the palette's named colours (the scene language still names them red, blue and so on). */
export const REFINED: Readonly<Record<string, Rgb>> = {
  red: [226, 84, 90], orange: [235, 148, 64], yellow: [240, 190, 64], green: [54, 168, 114], teal: [30, 164, 152],
  blue: [66, 108, 224], purple: [142, 94, 206], pink: [212, 78, 160], gray: [140, 147, 162],
};

/** A palette colour as its refined version; any other colour (a hex the model chose, white, black) stays as it was. */
export function refine(c: Rgb): Rgb {
  for (const name of Object.keys(REFINED)) {
    const p = PALETTE_RGB[name];
    if (p && p[0] === c[0] && p[1] === c[1] && p[2] === c[2]) return [...(REFINED[name] as Rgb)];
  }
  return c;
}

/** The soft shadow under a line or a card: a little blur and a one-pixel drop, never a hard dark outline. */
export const SOFT = { color: 'rgba(14,20,36,0.30)', blur: 5, dy: 1.4 } as const;

type Ctx = CanvasRenderingContext2D;

/** Puts the soft shadow on the context (the caller saves and restores). `scale` widens it for something larger than a line. */
export function softShadow(ctx: Ctx, scale = 1): void {
  ctx.shadowColor = SOFT.color;
  ctx.shadowBlur = SOFT.blur * scale;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = SOFT.dy * scale;
}

/** Clears any shadow from the context. */
export function noShadow(ctx: Ctx): void {
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}
