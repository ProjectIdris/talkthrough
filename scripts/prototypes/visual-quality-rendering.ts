export type VisualRenderingMode = 'default' | 'software';

/** Select the same supported software route as the app, before Electron is ready. */
export function applyVisualRenderingMode(app: { disableHardwareAcceleration(): void }, mode: string | undefined): VisualRenderingMode {
  if (mode !== 'default' && mode !== 'software') throw new Error('Invalid native visual rendering mode');
  if (mode === 'software') app.disableHardwareAcceleration();
  return mode;
}
