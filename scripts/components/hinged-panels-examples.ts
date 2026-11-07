import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Action, Scene } from '../../src/scene/types.ts';
import { validateScene } from '../../src/scene/validate.ts';
import { hingedPanels } from './hinged-panels.ts';
import type { HingeOptions } from './hinged-panels.ts';

/** Hand-authored fixture requests. None calls a model or changes the production vocabulary. */
export function hingeExamples(): Record<string, Scene> {
  const options: HingeOptions[] = [
    { id: 'door', width: 2.4, height: 6, knuckles: 5, fold: 55 },
    { id: 'folding', width: 3.2, height: 4.6, knuckles: 7, fold: 110 },
    { id: 'joint', width: 1.1, height: 2.4, knuckles: 3, fold: 30 },
  ];
  const examples: Record<string, Scene> = {};
  for (const option of options) {
    const component = hingedPanels(option);
    examples[`hinged-panels-${option.id}`] = { steps: [{ say: 'Two leaves share one pin. Each knuckle and leaf remains a separate part.', actions: [
      { op: 'panel', x: 100, y: 100, w: 800, h: 800 }, { op: 'orbit', az: -25, el: 20 }, ...component.actions,
    ] }] };
  }
  const inspected = hingedPanels({ id: 'inspect', width: 2.4, height: 5, knuckles: 5, fold: 60 });
  const first: Action[] = [{ op: 'panel', x: 100, y: 100, w: 800, h: 800 }, { op: 'orbit', az: -25, el: 25 }, ...inspected.actions];
  examples['hinged-panels-inspect'] = { steps: [
    { say: 'The leaves turn around the pin, while alternating hollow knuckles hold them together.', actions: first },
    { say: 'Withdraw the pin. Its end caps travel with it, revealing the real bore through the knuckles.', actions: [
      { op: 'move', id: inspected.ids.pin, to: [1.2, 3, 0], dur: 1 },
      { op: 'pin', id: 'inspect_label', on: inspected.ids.knuckles[4]!, point: [0, 0.42, 0], text: 'Open bore', off: [90, -50] },
    ] },
    { say: 'The moving leaf remains independently addressable.', actions: [
      { op: 'turn', id: inspected.ids.moving, to: [0, 120, 0], dur: 1 },
      { op: 'highlight', id: inspected.ids.movingLeaf, color: 'yellow' },
    ] },
  ] };
  return examples;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const out = resolve(process.argv[2] ?? 'samples/components');
  mkdirSync(out, { recursive: true });
  for (const [name, scene] of Object.entries(hingeExamples())) {
    const result = validateScene(scene);
    if (!result.ok || result.issues.length) throw new Error(`${name}: ${JSON.stringify(result.issues)}`);
    writeFileSync(resolve(out, `${name}.json`), `${JSON.stringify(scene, null, 2)}\n`);
  }
}
