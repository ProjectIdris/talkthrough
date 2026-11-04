// The colour each mechanism part has until a scene gives one. No three.js here: the timeline needs it too.

import type { Rgb } from './timeline.ts';

/** The colour a mechanism part has until the scene gives one: bare metal, a little different for each. */
export function mechanismColor(part: string): Rgb | undefined {
  switch (part) {
    case 'cylinder-block': return [132, 142, 158];
    case 'piston': return [200, 206, 216];
    case 'connecting-rod': return [168, 174, 186];
    case 'crankshaft': return [108, 114, 128];
    case 'valve': return [190, 196, 206];
    case 'camshaft': return [140, 146, 158];
    case 'spark-plug': return [176, 182, 194];
    case 'gear': return [190, 170, 120];
    case 'spring': return [150, 156, 168];
    case 'bearing': return [160, 166, 178];
    case 'pipe': return [150, 158, 172];
    case 'elbow': return [150, 158, 172];
    case 'housing': return [112, 124, 144];
    default: return undefined;
  }
}

