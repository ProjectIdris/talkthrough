// Puts the built model files and the credits next to the app: dist/models/*.glb and dist/CREDITS.md. A file is copied only if it is the one the manifest
// pins (by hash). Without the files (a fresh clone that has not run `npm run assets`) the app still builds and the models fall back to shapes;
// `strict` (the installer) refuses to go on without them.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILT_DIR, ROOT, readManifests, sha256 } from './manifest.mjs';

export function shipModels({ strict = false, out = join(ROOT, 'dist') } = {}) {
  const missing = [];
  const shipped = [];
  for (const { manifest: m } of readManifests()) {
    const file = join(BUILT_DIR, m.built?.file ?? `${m.id}.glb`);
    if (!m.built || !existsSync(file) || sha256(readFileSync(file)) !== m.built.sha256) { missing.push(m.id); continue; }
    mkdirSync(join(out, 'models'), { recursive: true });
    copyFileSync(file, join(out, 'models', m.built.file));
    shipped.push(m.id);
  }
  const credits = join(ROOT, 'assets', 'CREDITS.md');
  if (existsSync(credits)) copyFileSync(credits, join(out, 'CREDITS.md'));
  if (missing.length) {
    const why = `real models not built (${missing.join(', ')}): run npm run assets to fetch and build them; until then they are drawn from shapes`;
    if (strict) throw new Error(why);
    console.warn(`talkthrough: ${why}`);
  }
  return { shipped, missing };
}
