import type { Scene } from '../../src/scene/types.ts';
import type { CaptureMetadata } from '../../src/shared/ipc.ts';
export type View = { az: number; el: number; zoom: number };
export type Seek = (scene: Scene, view?: View) => Promise<CaptureMetadata | undefined>;
export async function prepareVisualFrame(scene: Scene, view: View, seek: Seek): Promise<CaptureMetadata | undefined> {
  // Every seek starts object keys at one. A completed empty draw releases prior geometry
  // before another fixture can reuse those keys; a fire-and-forget clear can race RAF.
  await seek({ steps: [{ say: '', actions: [] }] });
  await seek(scene, view);
  return seek(scene, view);
}
export function cameraMatchesView(metadata: CaptureMetadata | undefined, view: View): boolean {
  const camera = metadata?.camera;
  return Boolean(camera && (['az', 'el', 'zoom'] as const).every(key => Number.isFinite(camera[key]) && Math.abs(camera[key] - view[key]) < 1e-6));
}
