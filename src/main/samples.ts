// Hand-written sample scenes, played in turn by the chord until a model is connected.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSceneState, startTurn, validateScene } from '../scene/index.ts';
import type { Scene, SceneState } from '../scene/index.ts';

export type SamplePlay = {
  name: string;
  scene: Scene;
  /** 1 starts a fresh scene; higher continues the one on screen. */
  turn: number;
  issues: number;
};

/** Files named *-followup.json continue the scene of the file before them. */
export function listSamples(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
}

export function createSamplePlayer(dir: string) {
  const files = listSamples(dir).filter((f) => {
    // Escalation samples hand over to a deeper backend, which M1 does not have: skip them.
    const raw = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { steps?: unknown[]; escalate?: unknown };
    return Array.isArray(raw.steps) && raw.steps.length > 0 && raw.escalate === undefined;
  });
  // Put each follow-up straight after its base scene so the sequence reads naturally.
  const ordered = [...files.filter((f) => !f.endsWith('-followup.json'))];
  for (const f of files.filter((f) => f.endsWith('-followup.json'))) {
    const base = ordered.indexOf(f.replace('-followup', ''));
    ordered.splice(base >= 0 ? base + 1 : ordered.length, 0, f);
  }
  let next = 0;
  let state: SceneState = createSceneState();
  let turn = 0;

  return {
    files: ordered,
    /** Validates and returns the next sample; null when the folder has none. */
    next(): SamplePlay | null {
      if (ordered.length === 0) return null;
      const name = ordered[next % ordered.length]!;
      next++;
      if (name.endsWith('-followup.json') && turn > 0) {
        turn++;
      } else {
        state = createSceneState();
        turn = 1;
      }
      startTurn(state);
      const result = validateScene(JSON.parse(readFileSync(join(dir, name), 'utf8')), state);
      if (!result.ok || !result.scene) throw new Error(`sample ${name} was refused by the validator`);
      return { name, scene: result.scene, turn, issues: result.issues.length };
    },
  };
}
