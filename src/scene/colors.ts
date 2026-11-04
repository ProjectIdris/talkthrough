// Colours for the scene language: the palette's own values, and a way to read a colour name the
// palette does not have (a model writes "gold" or "navy") as the nearest palette colour, so a slip in
// a name costs the exact shade and not the whole action.

export type Rgb = [number, number, number];

export const PALETTE_RGB: Record<string, Rgb> = {
  red: [255, 59, 71], orange: [255, 159, 26], yellow: [255, 214, 10], green: [46, 213, 115],
  teal: [25, 199, 184], blue: [59, 130, 246], purple: [168, 85, 247], pink: [255, 107, 181],
  white: [255, 255, 255], gray: [154, 164, 178], black: [17, 21, 28],
};

/** The CSS colour names (and a few common others) as hex, lower-case and without spaces. */
const NAMED: Record<string, string> = {
  aliceblue: 'f0f8ff', antiquewhite: 'faebd7', aqua: '00ffff', aquamarine: '7fffd4', azure: 'f0ffff', beige: 'f5f5dc',
  bisque: 'ffe4c4', black: '000000', blanchedalmond: 'ffebcd', blue: '0000ff', blueviolet: '8a2be2', brown: 'a52a2a',
  burlywood: 'deb887', cadetblue: '5f9ea0', chartreuse: '7fff00', chocolate: 'd2691e', coral: 'ff7f50', cornflowerblue: '6495ed',
  cornsilk: 'fff8dc', crimson: 'dc143c', cyan: '00ffff', darkblue: '00008b', darkcyan: '008b8b', darkgoldenrod: 'b8860b',
  darkgray: 'a9a9a9', darkgreen: '006400', darkkhaki: 'bdb76b', darkmagenta: '8b008b', darkolivegreen: '556b2f', darkorange: 'ff8c00',
  darkorchid: '9932cc', darkred: '8b0000', darksalmon: 'e9967a', darkseagreen: '8fbc8f', darkslateblue: '483d8b', darkslategray: '2f4f4f',
  darkturquoise: '00ced1', darkviolet: '9400d3', deeppink: 'ff1493', deepskyblue: '00bfff', dimgray: '696969', dodgerblue: '1e90ff',
  firebrick: 'b22222', floralwhite: 'fffaf0', forestgreen: '228b22', fuchsia: 'ff00ff', gainsboro: 'dcdcdc', ghostwhite: 'f8f8ff',
  gold: 'ffd700', goldenrod: 'daa520', gray: '808080', green: '008000', greenyellow: 'adff2f', honeydew: 'f0fff0',
  hotpink: 'ff69b4', indianred: 'cd5c5c', indigo: '4b0082', ivory: 'fffff0', khaki: 'f0e68c', lavender: 'e6e6fa',
  lavenderblush: 'fff0f5', lawngreen: '7cfc00', lemonchiffon: 'fffacd', lightblue: 'add8e6', lightcoral: 'f08080', lightcyan: 'e0ffff',
  lightgoldenrodyellow: 'fafad2', lightgray: 'd3d3d3', lightgreen: '90ee90', lightpink: 'ffb6c1', lightsalmon: 'ffa07a', lightseagreen: '20b2aa',
  lightskyblue: '87cefa', lightslategray: '778899', lightsteelblue: 'b0c4de', lightyellow: 'ffffe0', lime: '00ff00', limegreen: '32cd32',
  linen: 'faf0e6', magenta: 'ff00ff', maroon: '800000', mediumaquamarine: '66cdaa', mediumblue: '0000cd', mediumorchid: 'ba55d3',
  mediumpurple: '9370db', mediumseagreen: '3cb371', mediumslateblue: '7b68ee', mediumspringgreen: '00fa9a', mediumturquoise: '48d1cc', mediumvioletred: 'c71585',
  midnightblue: '191970', mintcream: 'f5fffa', mistyrose: 'ffe4e1', moccasin: 'ffe4b5', navajowhite: 'ffdead', navy: '000080',
  oldlace: 'fdf5e6', olive: '808000', olivedrab: '6b8e23', orange: 'ffa500', orangered: 'ff4500', orchid: 'da70d6',
  palegoldenrod: 'eee8aa', palegreen: '98fb98', paleturquoise: 'afeeee', palevioletred: 'db7093', papayawhip: 'ffefd5', peachpuff: 'ffdab9',
  peru: 'cd853f', pink: 'ffc0cb', plum: 'dda0dd', powderblue: 'b0e0e6', purple: '800080', rebeccapurple: '663399',
  red: 'ff0000', rosybrown: 'bc8f8f', royalblue: '4169e1', saddlebrown: '8b4513', salmon: 'fa8072', sandybrown: 'f4a460',
  seagreen: '2e8b57', seashell: 'fff5ee', sienna: 'a0522d', silver: 'c0c0c0', skyblue: '87ceeb', slateblue: '6a5acd',
  slategray: '708090', snow: 'fffafa', springgreen: '00ff7f', steelblue: '4682b4', tan: 'd2b48c', teal: '008080',
  thistle: 'd8bfd8', tomato: 'ff6347', turquoise: '40e0d0', violet: 'ee82ee', wheat: 'f5deb3', white: 'ffffff',
  whitesmoke: 'f5f5f5', yellow: 'ffff00', yellowgreen: '9acd32', amber: 'ffbf00', bronze: 'cd7f32', copper: 'b87333',
  brass: 'b5a642', cream: 'fffdd0', mint: '98ff98', peach: 'ffe5b4', rose: 'ff007f', ruby: 'e0115f',
  sky: '87ceeb', grey: '808080', darkgrey: 'a9a9a9', lightgrey: 'd3d3d3', silvery: 'c0c0c0', darkyellow: 'cccc00',
};

const hexToRgb = (h: string): Rgb => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];

/**
 * The palette colour nearest to a colour name, or undefined when the name is not one we know. Nearest by
 * a weighted distance in RGB (the eye is most sensitive to green, least to blue).
 */
export function nearestPaletteColor(name: string): string | undefined {
  const key = name.toLowerCase().replace(/[\s_-]+/g, '');
  // Own keys only: a name such as "constructor" must not find something on the object's prototype.
  if (!Object.hasOwn(NAMED, key)) return undefined;
  const hex = NAMED[key] as string;
  const [r, g, b] = hexToRgb(hex);
  let best: string | undefined;
  let bestD = Infinity;
  for (const [palette, [pr, pg, pb]] of Object.entries(PALETTE_RGB)) {
    const d = 2 * (r - pr) ** 2 + 4 * (g - pg) ** 2 + 3 * (b - pb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = palette;
    }
  }
  return best;
}
