// The look of what the overlay draws on the screen itself: the tags pinned to 3D parts, the note
// cards and the image cards. One look ships: dark glass, a coloured dot or bar per item, thin light
// lines. The scene never chooses it. Fonts are ones Windows already ships.

import type { Rgb } from './timeline.ts';

export type Theme = {
  /** Text face for tags and card rows, and for card titles ({px} is replaced by the size). */
  font: string;
  titleFont: string;
  /** Tag and card surface, text, and the thin line round them. */
  surface: string;
  ink: string;
  muted: string;
  line: string;
  /** Colours given to untinted pins and cards in turn, so neighbours are told apart. */
  accents: Rgb[];
  radius: number;
  leaderWidth: number;
};

export const THEME: Theme = {
  font: '600 {px}px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
  titleFont: '700 {px}px "Segoe UI Variable Display", "Segoe UI Semibold", "Segoe UI", sans-serif',
  surface: 'rgba(17,22,34,0.90)', ink: '#f4f7fb', muted: 'rgba(214,224,240,0.72)', line: 'rgba(255,255,255,0.16)',
  accents: [[104, 156, 255], [238, 170, 84], [160, 136, 232], [82, 196, 150], [232, 118, 150]],
  radius: 14, leaderWidth: 1.4,
};

/** A font shorthand for a size in pixels. */
export function fontAt(face: string, px: number): string {
  return face.replace('{px}', String(Math.round(px * 10) / 10));
}
