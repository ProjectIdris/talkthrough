// Puts the built model files and the credits next to the app: dist/models/*.glb and dist/CREDITS.md. A file is copied only if it is the one the manifest
// pins (by hash). Without the files (a fresh clone that has not run `npm run assets`) the app still builds, and a scene that asks for such a model shows
// the stage without it and says so; `strict` (the installer) refuses to go on without the files of the models it carries.
// `release` leaves out every model held back (`release.blocked`): its file is not copied (a copy from an earlier build is removed), and the credits
// file lists only what is carried, or is not written when nothing is.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { creditsSource } from './index.mjs';
import { BUILT_DIR, ROOT, readManifests, sha256 } from './manifest.mjs';
import { droppedNote } from './release.mjs';

export function shipModels({ strict = false, release = false, out = join(ROOT, 'dist') } = {}) {
  const all = readManifests().map((x) => x.manifest);
  const dropped = release ? all.filter((m) => m.release?.blocked === true) : [];
  const carried = all.filter((m) => !dropped.includes(m));
  for (const m of dropped) if (m.built) rmSync(join(out, 'models', m.built.file), { force: true });
  const missing = [];
  const shipped = [];
  for (const m of carried) {
    const file = join(BUILT_DIR, m.built?.file ?? `${m.id}.glb`);
    if (!m.built || !existsSync(file) || sha256(readFileSync(file)) !== m.built.sha256) { missing.push(m.id); continue; }
    mkdirSync(join(out, 'models'), { recursive: true });
    copyFileSync(file, join(out, 'models', m.built.file));
    shipped.push(m.id);
  }
  if (release && carried.length === 0) {
    rmSync(join(out, 'models'), { recursive: true, force: true });
    rmSync(join(out, 'CREDITS.md'), { force: true });
  } else if (release) writeFileSync(join(out, 'CREDITS.md'), creditsSource(carried));
  else if (existsSync(join(ROOT, 'assets', 'CREDITS.md'))) copyFileSync(join(ROOT, 'assets', 'CREDITS.md'), join(out, 'CREDITS.md'));
  if (dropped.length) console.warn(`talkthrough: ${droppedNote(dropped)}`);
  if (missing.length) {
    const why = `real models not built (${missing.join(', ')}): run npm run assets to fetch and build them; until then a scene that uses one shows the stage without it and says so`;
    if (strict) throw new Error(why);
    console.warn(`talkthrough: ${why}`);
  }
  return { shipped, missing, dropped: dropped.map((m) => m.id) };
}
