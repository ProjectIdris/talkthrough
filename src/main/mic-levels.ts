// How loud a recording was, in fifths of a second, for the level bars of the microphone test. Pure.

/** The loudness (0..1) of each `windowMs` of the clip: the root mean square, scaled so that ordinary speech at a normal distance reaches about 0.6. */
export function micLevels(samples: Float32Array, sampleRate: number, windowMs = 200, gain = 4): number[] {
  const size = Math.max(1, Math.round((sampleRate * windowMs) / 1000));
  const out: number[] = [];
  for (let start = 0; start < samples.length; start += size) {
    const end = Math.min(samples.length, start + size);
    let sum = 0;
    for (let i = start; i < end; i++) sum += (samples[i] as number) * (samples[i] as number);
    out.push(Math.min(1, Math.sqrt(sum / (end - start)) * gain));
  }
  return out;
}
