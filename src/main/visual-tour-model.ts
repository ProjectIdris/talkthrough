import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateScene } from '../scene/index.ts';
import type { Scene } from '../scene/index.ts';
import type { TourCommand, TourExample, TourState } from '../shared/visual-tour.ts';

// Only these bundled files can be loaded. The UI receives IDs and captions, not paths.
const EXAMPLES = [
  { id: 'web-request', title: 'Opening a web page', description: 'Follow a request from browser to database and back.', file: 'diagram-flow.json' },
  { id: 'recipe', title: 'Banana bread', description: 'Walk through a recipe with a checklist that fills in as you go.', file: 'diagram-steps.json' },
  { id: 'supply-demand', title: 'Supply and demand', description: 'See where buyers and sellers meet on a chart.', file: 'diagram-chart.json' },
  { id: 'timeline', title: 'Autumn 1066', description: 'Explore the events leading to the Battle of Hastings.', file: 'diagram-timeline.json' },
] as const satisfies readonly (TourExample & { file: string })[];

/** IPC accepts only the documented data fields, never a file name or an arbitrary step. */
function readCommand(value: unknown): TourCommand | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const kind = Object.getOwnPropertyDescriptor(value, 'kind')?.value;
    const keys = Reflect.ownKeys(value);
    if (kind === 'select') {
      const id = Object.getOwnPropertyDescriptor(value, 'id')?.value;
      return keys.length === 2 && keys.includes('kind') && keys.includes('id') && typeof id === 'string'
        ? { kind, id } : null;
    }
    if (keys.length !== 1 || keys[0] !== 'kind') return null;
    return kind === 'next' || kind === 'back' || kind === 'restart' ? { kind } : null;
  } catch {
    return null;
  }
}

/** Overlay examples use part of the screen; a lone diagram can fill this dedicated gallery. */
function frameGalleryScene(scene: Scene): Scene {
  const preview = structuredClone(scene);
  const diagrams = preview.steps.flatMap((step) => step.actions).filter((action) => action.op === 'diagram');
  // Multiple diagrams may have a deliberate arrangement, including across different steps.
  if (diagrams.length === 1) Object.assign(diagrams[0]!, { x: 80, y: 80, w: 840, h: 840 });
  return preview;
}

export function createVisualTourModel(samplesDir: string) {
  let selected: (typeof EXAMPLES)[number] = EXAMPLES[0];
  let currentScene: Scene | null = null;
  let step = 0;
  let busy = false;
  let loadError: string | null = null;
  let renderError: string | null = null;

  function load(): void {
    currentScene = null;
    loadError = null;
    try {
      const raw: unknown = JSON.parse(readFileSync(join(samplesDir, selected.file), 'utf8'));
      const result = validateScene(raw);
      // Bundled examples must be intact, not silently repaired or escalated to a model.
      if (!result.ok || !result.scene || result.issues.length > 0) {
        throw new Error(result.issues.slice(0, 3).map((issue) => `${issue.path}: ${issue.message}`).join('; ') || 'Scene validation failed.');
      }
      if (result.scene.steps.length === 0) throw new Error('The scene has no steps.');
      if (result.scene.escalate !== undefined) throw new Error('Offline examples cannot request a model.');
      currentScene = frameGalleryScene(result.scene);
    } catch (error) {
      loadError = `Could not load ${selected.file}: ${error instanceof Error ? error.message : 'Unknown scene error.'}`;
    }
  }

  load();

  return {
    state(): TourState {
      return {
        examples: EXAMPLES.map(({ id, title, description }) => ({ id, title, description })),
        selected: selected.id,
        title: selected.title,
        step,
        steps: currentScene?.steps.length ?? 0,
        say: currentScene?.steps[step]?.say ?? '',
        busy,
        error: loadError ?? renderError,
      };
    },
    /** The validated scene for the renderer; callers must not mutate it. */
    scene(): Scene | null { return currentScene; },
    /** True asks the host to seek and publish state; false leaves everything unchanged. */
    command(value: unknown): boolean {
      if (busy) return false;
      const command = readCommand(value);
      if (!command) return false;
      if (command.kind === 'select') {
        const example = EXAMPLES.find((entry) => entry.id === command.id);
        if (!example || (example.id === selected.id && step === 0)) return false;
        selected = example;
        step = 0;
        renderError = null;
        load();
        return true;
      }
      if (!currentScene) return false;
      const next = command.kind === 'restart' ? 0 : step + (command.kind === 'next' ? 1 : -1);
      if (next < 0 || next >= currentScene.steps.length) return false;
      step = next;
      renderError = null;
      return true;
    },
    status(value: boolean, error: string | null = null): void {
      busy = value;
      renderError = error;
    },
  };
}
