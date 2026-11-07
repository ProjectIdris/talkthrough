// Hand-written diagnostic data. This does not call a model or decide semantic usefulness.
export const USEFUL_3D_ACTIONS = [
  { op: 'panel', x: 100, y: 100, w: 800, h: 700, frame: false, dur: 0 },
  { op: 'orbit', az: -15, el: 20, dur: 0 },
  { op: 'add', shape: 'part', part: 'gear', id: 'probe-drive', pos: [-0.95, 0, 0], size: [2, 2, 0.5], n: 16, color: '#ff00ff' },
  { op: 'add', shape: 'part', part: 'gear', id: 'probe-driven', pos: [0.95, 0, 0], size: [2, 2, 0.5], n: 16, color: '#00ff00' },
] as const;

type ColourEvidence = { pixels: number; width: number; height: number; fill: number };
export type Useful3dEvidence = { magenta: ColourEvidence; green: ColourEvidence; qualifies: boolean };
/** Fixed 640x480 fixture oracle, not a general visual-quality or geometry-correctness score.
 * BGRA is premultiplied. Substantial area for both colours rejects first-stroke-only success.
 * The region excludes app chrome; extent and occupancy reject thin strokes / sparse pixels.
 */
export function inspectUseful3dPixels(bgra: Uint8Array, width: number, height: number): Useful3dEvidence {
  if (width !== 640 || height !== 480 || bgra.length !== width * height * 4) throw new Error('unexpected fixture bitmap dimensions');
  const buckets = [0, 1].map(() => ({ pixels: 0, x0: width, y0: height, x1: -1, y1: -1 }));
  for (let y = 54; y < 400; y++) for (let x = 64; x < 576; x++) {
    const offset = (y * width + x) * 4;
    const b = bgra[offset]!, g = bgra[offset + 1]!, r = bgra[offset + 2]!, a = bgra[offset + 3]!;
    if (a < 120) continue;
    const index = r >= 60 && b >= 60 && g < Math.min(r, b) / 1.8 ? 0 : g >= 60 && g > Math.max(r, b) * 1.8 ? 1 : -1;
    if (index < 0) continue;
    const bucket = buckets[index]!;
    bucket.pixels++;
    bucket.x0 = Math.min(bucket.x0, x); bucket.x1 = Math.max(bucket.x1, x);
    bucket.y0 = Math.min(bucket.y0, y); bucket.y1 = Math.max(bucket.y1, y);
  }
  const evidence = buckets.map(bucket => {
    const width = bucket.pixels ? bucket.x1 - bucket.x0 + 1 : 0;
    const height = bucket.pixels ? bucket.y1 - bucket.y0 + 1 : 0;
    return { pixels: bucket.pixels, width, height, fill: bucket.pixels ? bucket.pixels / (width * height) : 0 };
  });
  const substantial = (entry: ColourEvidence) => entry.pixels >= 600 && entry.width >= 30 && entry.height >= 30 && entry.fill >= 0.15;
  return { magenta: evidence[0]!, green: evidence[1]!, qualifies: evidence.every(substantial) };
}
