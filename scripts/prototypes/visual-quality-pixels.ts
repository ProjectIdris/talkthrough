/** Conservative diagnostics for Electron's premultiplied BGRA bitmaps, not aesthetic acceptance. */
export const thresholds = Object.freeze({ difference: 18, minimumCoverage: 0.005, maximumCoverage: 0.7, darkLuma: 55, maximumDarkFraction: 0.85, edgeBandFraction: 0.01, maximumEdgeFraction: 0.02, maximumBoundaryFraction: 0.02, maximumCentreOffset: 0.3 });
export type FrameAnalysis = {
  status: 'pass' | 'fail'; failures: string[];
  metrics: { changedPixels: number; coverage: number; darkFraction: number; meanLuma: number; edgeFraction: number; boundaryFraction: number; bounds: { x: number; y: number; width: number; height: number } | null; centroid: { x: number; y: number } | null };
};
const background = [247, 242, 238]; // BGRA for the harness's #eef2f7 inspection backdrop.
function visible(bitmap: Uint8Array, offset: number): number[] {
  const alpha = bitmap[offset + 3]! / 255;
  return background.map((channel, index) => (alpha === 0 ? 0 : Math.min(bitmap[offset + index]!, 255 * alpha)) + channel * (1 - alpha));
}
export function analyseFrame(current: Uint8Array, baseline: Uint8Array, width: number, height: number): FrameAnalysis {
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 8192) || current.length !== width * height * 4 || baseline.length !== current.length) throw new Error('Expected complete BGRA bitmaps with matching positive integer dimensions, at most 8192 per edge');
  let count = 0, dark = 0, edge = 0, lumaTotal = 0, sx = 0, sy = 0, minX = width, minY = height, maxX = -1, maxY = -1;
  const boundary = [0, 0, 0, 0];
  const bandX = Math.max(1, Math.ceil(width * thresholds.edgeBandFraction)), bandY = Math.max(1, Math.ceil(height * thresholds.edgeBandFraction));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    const color = visible(current, offset), before = visible(baseline, offset);
    if (Math.max(...color.map((v, i) => Math.abs(v - before[i]!))) <= thresholds.difference) continue;
    count++; sx += x; sy += y;
    const luma = color[2]! * 0.2126 + color[1]! * 0.7152 + color[0]! * 0.0722;
    lumaTotal += luma; if (luma < thresholds.darkLuma) dark++;
    if (x < bandX || x >= width - bandX || y < bandY || y >= height - bandY) edge++;
    if (x === 0) boundary[0]!++; if (x === width - 1) boundary[1]!++;
    if (y === 0) boundary[2]!++; if (y === height - 1) boundary[3]!++;
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const coverage = count / (width * height), darkFraction = count ? dark / count : 0, edgeFraction = count ? edge / count : 0;
  const boundaryFraction = Math.max(boundary[0]! / height, boundary[1]! / height, boundary[2]! / width, boundary[3]! / width);
  const centroid = count ? { x: sx / count / width, y: sy / count / height } : null;
  const failures: string[] = [];
  if (!count) failures.push('blank');
  else {
    if (coverage < thresholds.minimumCoverage) failures.push('too-small');
    if (coverage > thresholds.maximumCoverage) failures.push('too-large');
    if (darkFraction > thresholds.maximumDarkFraction) failures.push('dark');
    if (edgeFraction > thresholds.maximumEdgeFraction || boundaryFraction > thresholds.maximumBoundaryFraction) failures.push('edge-clipping');
    if (centroid && Math.max(Math.abs(centroid.x - 0.5), Math.abs(centroid.y - 0.5)) > thresholds.maximumCentreOffset) failures.push('off-centre');
  }
  return { status: failures.length ? 'fail' : 'pass', failures, metrics: { changedPixels: count, coverage, darkFraction, meanLuma: count ? lumaTotal / count : 0, edgeFraction, boundaryFraction, bounds: count ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null, centroid } };
}
