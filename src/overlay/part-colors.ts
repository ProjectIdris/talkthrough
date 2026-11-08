// The colour each mechanism part has until a scene gives one. No three.js here: the timeline needs it too.

import { KIT_PRESETS } from '../scene/kit-presets.ts';
import type { Rgb } from './timeline.ts';

/** The colour a mechanism part has until the scene gives one: bare metal, a little different for each (the colour is a field of the part's row in the kit table). */
export function mechanismColor(part: string): Rgb | undefined {
  const c = KIT_PRESETS[part]?.color;
  return c ? [c[0], c[1], c[2]] : undefined;
}
