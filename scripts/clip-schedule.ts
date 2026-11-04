// Plans the frames of a clip: which step, and how many seconds into it, each frame of a scene shows.
//   node scripts/clip-schedule.ts <scene.json> --out schedule.json [--fps 30] [--speed 1] [--gap 0.35] [--tail 3.5]
// Steps run one after another at their authored pace (no speech), each held for `gap` seconds once its
// drawing is done (`speed` plays the authored timings that much faster), and the last is followed by `tail` seconds so the slow idle turn shows. The frame
// tool (scripts/overlay-frames.cjs --schedule) renders the list; ffmpeg joins the PNGs.

import fs from 'node:fs';
import { emptyFrame, planStep, settle } from '../src/overlay/timeline.ts';
import { validateScene } from '../src/scene/validate.ts';

const args = process.argv.slice(2);
const opt = (name: string, fallback: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const scenePath = args[0];
const outIndex = args.indexOf('--out');
const out = outIndex >= 0 ? args[outIndex + 1] : undefined;
if (!scenePath || !out) {
  console.error('usage: node scripts/clip-schedule.ts <scene.json> --out schedule.json [--fps 30] [--speed 1] [--gap 0.35] [--tail 3.5]');
  process.exit(2);
}
const fps = opt('fps', 30), speed = opt('speed', 1), gap = opt('gap', 0.35), tail = opt('tail', 3.5), minStep = 0.6;

const checked = validateScene(JSON.parse(fs.readFileSync(scenePath, 'utf8')));
if (!checked.scene) throw new Error('not a scene');
const starts: number[] = [];
const spans: number[] = [];
let frame = emptyFrame();
let at = 0;
for (const step of checked.scene.steps) {
  const plan = planStep(frame, step);
  frame = settle(plan);
  starts.push(at);
  const span = Math.max(minStep, plan.duration) / speed + gap;
  spans.push(span);
  at += span;
}
const total = at + tail;
const count = Math.round(total * fps);
const frames: Array<[number, number]> = [];
for (let i = 0; i < count; i++) {
  const time = i / fps;
  let s = starts.length - 1;
  while (s > 0 && (starts[s] as number) > time) s--;
  frames.push([s, Math.round((time - (starts[s] as number)) * speed * 1000) / 1000]);
}
fs.writeFileSync(out, JSON.stringify({ fps, seconds: total, frames }));
console.log(`${count} frames, ${total.toFixed(2)} s, ${starts.length} steps`);
