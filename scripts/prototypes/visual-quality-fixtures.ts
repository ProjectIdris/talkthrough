import type { Action, Scene } from '../../src/scene/types.ts';
export type VisualFixture = { id: string; description: string; inspect: string; scene: Scene };
const scene = (actions: Action[]): Scene => ({ steps: [{ say: '', actions: [{ op: 'panel', x: 100, y: 100, w: 800, h: 800, frame: false }, ...actions] }] });
/** Hand-written public scene data. No model, catalogue, external assets or unreleased geometry. */
export const visualFixtures: VisualFixture[] = [
  { id: 'solids', description: 'Box, sphere and torus', inspect: 'All three bodies should be visible, centred and lit. Inspect the torus hole, curved shading and box corners.', scene: scene([
    { op: 'add', id: 'box', shape: 'box', size: [2, 2, 2], pos: [-2.8, 0, 0], color: '#ef6b54', material: 'plastic' },
    { op: 'add', id: 'sphere', shape: 'sphere', size: [2.2, 2.2, 2.2], color: '#4e9fe5', material: 'plastic' },
    { op: 'add', id: 'torus', shape: 'torus', size: [2.4, 2.4, 0.6], pos: [2.8, 0, 0], color: '#61c28b', material: 'plastic' },
  ]) },
  { id: 'profiles', description: 'Extrusion, lathe and open tube', inspect: 'Inspect the extruded notch, continuous lathe surface, tube ends and bends. Watch for dark seams, missing faces or faceting.', scene: scene([
    { op: 'add', id: 'extrusion', shape: 'extrude', outline: [[-1,-1],[1,-1],[1,0],[0,0],[0,1],[-1,1]], depth: 0.8, pos: [-3,0,0], color: '#ef6b54' },
    { op: 'add', id: 'lathe', shape: 'lathe', profile: [[0,-1],[0.7,-1],[1,-0.3],[0.65,0.3],[0.7,1],[0,1]], color: '#4e9fe5' },
    { op: 'add', id: 'tube', shape: 'tube', pts: [[2,-1,0],[3,-0.4,0],[2.4,0.4,0.4],[3.2,1.2,0]], radius: 0.25, color: '#61c28b' },
  ]) },
  { id: 'builtins', description: 'Wheel, gear and port', inspect: 'Inspect the wheel silhouette and hub, complete gear teeth and port opening. These are the current branch implementations, not acceptance of separate geometry PRs.', scene: scene([
    { op: 'add', id: 'wheel', shape: 'part', part: 'wheel', size: [2.2,2.2,0.8], pos: [-3,0,0], color: '#ef6b54' },
    { op: 'add', id: 'gear', shape: 'part', part: 'gear', size: [2.2,2.2,0.5], color: '#4e9fe5', n: 12 },
    { op: 'add', id: 'port', shape: 'part', part: 'port', variant: 'usbc', size: [2,1.2,1.4], pos: [3,0,0], color: '#61c28b' },
  ]) },
];
export const visualViews = [{ id: 'front', az: 0, el: 10, zoom: 1 }, { id: 'oblique', az: 35, el: 25, zoom: 1 }] as const;
