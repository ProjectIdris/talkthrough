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

/** The size of a tag's letters (CSS pixels): by the screen, a little smaller beside a stage much smaller than a usual one (never under 11). Text in the scene is drawn with the same. */
export function tagTextPx(viewHeight: number, stage?: { w: number; h: number }): number {
  const beside = stage ? Math.max(0.7, Math.min(1, Math.min(stage.w, stage.h) / (viewHeight * 0.5))) : 1;
  return Math.max(11, Math.max(13, viewHeight * 0.0195) * beside);
}
/** A tag is this many times its letters tall (the padding above and below them). */
export const TAG_HEIGHT_FACTOR = 2.1;

// ---- Frost: the look of the flat diagrams (flow, timeline, steps, chart) and the note cards -----------------------------------------
// Soft frosted glass that follows the page: a light card on a light page, a dark one on a dark page. Items are tinted capsules, each
// its own accent in turn, so the order reads at a glance. The tags pinned to 3D parts keep the dark glass above; this is only the panels.

/** Which face a panel wears: the page under it decides (the scene never chooses it). */
export type Face = 'dark' | 'light';

/** Colours of one face, as CSS strings (the panels are translucent, so a page shows faintly through). */
export type FrostFace = {
  ink: string; muted: string;
  /** A hairline rule (a chart's grid, the divider of a card). */
  faint: string;
  /** A small label's own surface (an edge's label, a chart annotation) and the line round it. */
  chip: string; chipLine: string;
  /** The panel: top and foot of its gradient, the line round it, the thin outer ring and the soft shadow under it. */
  panelTop: string; panelFoot: string; border: string; ring: string; shadow: string;
  /** How strongly an item's accent tints its capsule (fill and line, 0..1), and the neutral fill of a row that is not lit. */
  tint: number; tintLine: number; row: string;
  /** The inside of a marker (the hollow of a timeline dot, the core of a chart point). */
  core: string;
};

export const FROST: Readonly<Record<Face, FrostFace>> = {
  light: {
    ink: '#16202e', muted: '#5b6b82', faint: 'rgba(30,50,90,0.10)', chip: 'rgba(255,255,255,0.94)', chipLine: 'rgba(30,50,90,0.14)',
    panelTop: 'rgba(255,255,255,0.93)', panelFoot: 'rgba(243,247,255,0.88)', border: 'rgba(255,255,255,0.95)', ring: 'rgba(30,50,90,0.09)', shadow: 'rgba(50,70,120,0.22)',
    tint: 0.13, tintLine: 0.46, row: 'rgba(30,58,120,0.045)', core: '#ffffff',
  },
  dark: {
    ink: '#f2f6fc', muted: '#a3b4cc', faint: 'rgba(255,255,255,0.09)', chip: 'rgba(14,20,34,0.90)', chipLine: 'rgba(255,255,255,0.15)',
    panelTop: 'rgba(30,40,64,0.92)', panelFoot: 'rgba(17,24,41,0.88)', border: 'rgba(255,255,255,0.14)', ring: 'rgba(0,0,0,0.28)', shadow: 'rgba(2,6,16,0.52)',
    tint: 0.18, tintLine: 0.46, row: 'rgba(255,255,255,0.055)', core: '#0e1424',
  },
};

/** The accents items take in turn when the scene names none: blue, teal, violet, amber, rose, then sky, leaf and slate for a long list (a chart of many series). They read on both faces. */
export const FROST_ACCENTS: readonly Rgb[] = [[77, 134, 255], [37, 181, 154], [141, 109, 240], [242, 163, 58], [240, 101, 127], [56, 172, 232], [118, 186, 64], [124, 138, 170]];
export const frostAccent = (index: number): Rgb => FROST_ACCENTS[((index % FROST_ACCENTS.length) + FROST_ACCENTS.length) % FROST_ACCENTS.length] as Rgb;

/** The mean gray level (0..255) of the page under a panel above which it wears the light face, and below which a light one goes dark again: between the two it keeps the face it had, so it never flickers over a mid-tone page. */
export const FACE_LIGHT_ABOVE = 150;
export const FACE_DARK_BELOW = 125;

/** The face for a panel over a page of this mean gray level; `had` is the face it wore (a mid-tone page keeps it), none when it is new (a mid-tone page is dark, as the tags are). Unknown tone: dark. */
export function faceFor(luma: number | undefined, had?: Face): Face {
  if (luma === undefined || !Number.isFinite(luma)) return had ?? 'dark';
  if (luma > FACE_LIGHT_ABOVE) return 'light';
  if (luma < FACE_DARK_BELOW) return 'dark';
  return had ?? 'dark';
}

/** Remembers the face each panel wears. `lumaUnder` is the page's mean gray level under a rectangle (pixels in the window), when the page is known. */
export class FaceBook {
  private faces = new Map<string, Face>();
  private readonly lumaUnder: (r: { x: number; y: number; w: number; h: number }) => number | undefined;
  constructor(lumaUnder: (r: { x: number; y: number; w: number; h: number }) => number | undefined = () => undefined) {
    this.lumaUnder = lumaUnder;
  }
  /** The face of the panel named `key` over the rectangle `r`. */
  of(key: string, r: { x: number; y: number; w: number; h: number }): Face {
    const face = faceFor(this.lumaUnder(r), this.faces.get(key));
    this.faces.delete(key);
    this.faces.set(key, face);
    // A long session makes many panels; the oldest are forgotten (a forgotten panel simply starts fresh).
    if (this.faces.size > 96) this.faces.delete(this.faces.keys().next().value as string);
    return face;
  }
}

/** Text drawn on an accent: white, or near-black when that reads better (amber, leaf). */
export function onAccent(color: Rgb): string {
  const lin = (v: number): number => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = 0.2126 * lin(color[0]) + 0.7152 * lin(color[1]) + 0.0722 * lin(color[2]);
  return 1.05 / (lum + 0.05) >= (lum + 0.05) / 0.058 ? '#ffffff' : '#1b1405';
}

/** A filled disc of an accent with a short bold label in it (a node's number, a step's number, a row's number). */
export function discWithNumber(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: Rgb, label: string): void {
  ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = fontAt(THEME.titleFont, r * 0.95);
  ctx.fillStyle = onAccent(color);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(label, cx, cy + r * 0.05);
  ctx.textAlign = 'left';
}
