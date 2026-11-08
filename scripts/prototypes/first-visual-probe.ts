import type { SceneMessage } from '../../src/shared/ipc.ts';
import { createStepStream } from '../../src/scene/stream.ts';
import { beginLiveStep, createSceneState } from '../../src/scene/validate.ts';
import type { LiveStep } from '../../src/scene/validate.ts';

export const MARKER = { op: 'box', id: 'latency-marker', x: 300, y: 300, w: 400, h: 400, color: '#ff00ff' } as const;
export type ProbeReport = { firstPieceMs: number | null; firstActionMs: number | null; firstValidatedActionMs: number | null; firstSentActionMs: number | null; firstStepMs: number | null; acceptedActions: number; completeSteps: number; validationIssues: number };
/** Offline fixture bridge, using the same parser and live validator as model adapters/session. */
export function createVisualProbe(send: (message: SceneMessage) => void, elapsed: () => number): { push(chunk: string): void; end(): ProbeReport; snapshot(): ProbeReport } {
  const result: ProbeReport = { firstPieceMs: null, firstActionMs: null, firstValidatedActionMs: null, firstSentActionMs: null, firstStepMs: null, acceptedActions: 0, completeSteps: 0, validationIssues: 0 };
  const state = createSceneState();
  let live: LiveStep | undefined;
  let begun = false;
  const open = () => {
    if (!begun) { send({ kind: 'begin', turn: 1 }); begun = true; }
    return live ??= beginLiveStep(state, {
      open: say => send({ kind: 'step-open', say }),
      // An action the validator derives (the shaft it puts through a gear) is not one the fixture wrote.
      action: (action, derived) => {
        result.firstValidatedActionMs ??= elapsed();
        if (!derived) result.acceptedActions++;
        send({ kind: 'action', action });
        result.firstSentActionMs ??= elapsed();
      },
    });
  };
  const stream = createStepStream({ onPiece(piece) {
    result.firstPieceMs ??= elapsed();
    if (piece.type === 'say') open().say(piece.say);
    else if (piece.type === 'action') {
      result.firstActionMs ??= elapsed();
      open().action(piece.action);
    } else {
      result.firstStepMs ??= elapsed();
      result.completeSteps++;
      result.validationIssues += open().finish().issues.length;
      send({ kind: 'step-close' });
      live = undefined;
    }
  } });
  return {
    push: chunk => { stream.push(chunk); },
    end: () => { stream.end(); send({ kind: 'end' }); return { ...result }; },
    snapshot: () => ({ ...result }),
  };
}

/** Count the fixture's bright magenta pixels, not DOM/scene state or arbitrary paint activity.
 * Electron NativeImage.toBitmap is premultiplied BGRA. This fixed region avoids UI controls.
 * This oracle is intentionally specific to the 640x480 hand-written fixture, not general visibility.
 */
export function countMarkerPixels(bgra: Uint8Array, width: number, height: number): number {
  if (width !== 640 || height !== 480 || bgra.length !== width * height * 4) throw new Error('unexpected fixture bitmap dimensions');
  let pixels = 0;
  for (let y = 130; y < 350; y++) for (let x = 180; x < 460; x++) {
    const offset = (y * width + x) * 4;
    const b = bgra[offset]!, g = bgra[offset + 1]!, r = bgra[offset + 2]!, a = bgra[offset + 3]!;
    if (a >= 80 && r >= 80 && b >= 80 && g < Math.min(r, b) / 2) pixels++;
  }
  return pixels;
}
