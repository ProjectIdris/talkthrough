// The look of what the overlay draws on the screen itself: the tags pinned to 3D parts, the note
// cards and the image cards. A theme is data (type, colours, shapes); the scene never chooses one, the
// app does, so the same answer can be drawn in any of them. Fonts are ones Windows already ships.

import type { Rgb } from './timeline.ts';

export type LeaderStyle = 'straight' | 'elbow' | 'curve';

export type Theme = {
  id: string;
  /** Text face for tags and card rows, and for card titles. */
  font: string;
  titleFont: string;
  /** Tag and card surface, text, and the thin line round them. */
  surface: string;
  surfaceSolid: Rgb;
  ink: string;
  muted: string;
  line: string;
  /** Colours given to untinted pins and cards in turn, so neighbours are told apart. */
  accents: Rgb[];
  radius: number;
  /** How a tag marks its colour: a dot, a bar down its left edge or an underline. */
  mark: 'dot' | 'bar' | 'underline';
  uppercase: boolean;
  letterSpacing: number;
  leader: LeaderStyle;
  leaderWidth: number;
  /** The dot where a leader meets the part. */
  anchor: 'ring' | 'square' | 'disc';
  shadow: boolean;
  /** Corner ticks on cards, as on a drawing. */
  ticks: boolean;
};

const STUDIO: Theme = {
  id: 'studio',
  font: '600 {px}px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
  titleFont: '650 {px}px "Segoe UI Variable Display", "Segoe UI Semibold", "Segoe UI", sans-serif',
  surface: 'rgba(17,22,34,0.90)', surfaceSolid: [17, 22, 34], ink: '#f4f7fb', muted: 'rgba(214,224,240,0.72)', line: 'rgba(255,255,255,0.16)',
  accents: [[84, 196, 255], [255, 190, 64], [166, 140, 255], [92, 224, 168], [255, 120, 150]],
  radius: 10, mark: 'dot', uppercase: false, letterSpacing: 0, leader: 'straight', leaderWidth: 1.6, anchor: 'ring', shadow: true, ticks: false,
};

const BLUEPRINT: Theme = {
  id: 'blueprint',
  font: '500 {px}px Bahnschrift, "Segoe UI", sans-serif',
  titleFont: '600 {px}px Bahnschrift, "Segoe UI", sans-serif',
  surface: 'rgba(8,24,52,0.88)', surfaceSolid: [8, 24, 52], ink: '#e8f6ff', muted: 'rgba(150,200,235,0.8)', line: 'rgba(120,226,255,0.85)',
  accents: [[120, 226, 255], [120, 226, 255], [120, 226, 255]],
  radius: 2, mark: 'bar', uppercase: true, letterSpacing: 1.1, leader: 'elbow', leaderWidth: 1.2, anchor: 'square', shadow: false, ticks: true,
};

const PAPER: Theme = {
  id: 'paper',
  font: '600 {px}px "Segoe UI", system-ui, sans-serif',
  titleFont: '700 {px}px Georgia, "Sitka Heading", serif',
  surface: 'rgba(252,250,245,0.97)', surfaceSolid: [252, 250, 245], ink: '#161a22', muted: 'rgba(60,66,80,0.72)', line: 'rgba(22,26,34,0.85)',
  accents: [[222, 66, 38], [30, 110, 214], [18, 142, 98], [196, 128, 10]],
  radius: 5, mark: 'underline', uppercase: false, letterSpacing: 0, leader: 'curve', leaderWidth: 1.4, anchor: 'disc', shadow: true, ticks: false,
};

export const THEMES: Record<string, Theme> = { studio: STUDIO, blueprint: BLUEPRINT, paper: PAPER };
export const DEFAULT_THEME = 'studio';

export function themeNamed(name: string | null | undefined): Theme {
  return THEMES[name ?? DEFAULT_THEME] ?? STUDIO;
}

/** A font shorthand for a size in pixels. */
export function fontAt(face: string, px: number): string {
  return face.replace('{px}', String(Math.round(px * 10) / 10));
}
