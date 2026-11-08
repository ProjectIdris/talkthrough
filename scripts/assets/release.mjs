// What a release build leaves out. A model whose manifest says `release.blocked` is for local use: a release is built with a catalogue that does not
// list it (so the guide, the schema and the validator never offer it and answers use shapes instead), and without its file or its credits.
// `npm run dist` builds this way; the build says what it left out.

import { catalogueSource } from './index.mjs';
import { ROOT, readManifests } from './manifest.mjs';
import { join } from 'node:path';

/** The manifests a release carries, and those it leaves out with why. */
export function releaseSplit() {
  const all = readManifests().map((x) => x.manifest);
  return { kept: all.filter((m) => m.release?.blocked !== true), dropped: all.filter((m) => m.release?.blocked === true) };
}

/** An esbuild plugin that serves src/scene/model-catalogue.ts without the held models. */
export const releaseCatalogue = {
  name: 'release-catalogue',
  setup(build) {
    const target = join(ROOT, 'src', 'scene', 'model-catalogue.ts').replace(/[\\]/g, '/').toLowerCase();
    build.onLoad({ filter: /model-catalogue\.ts$/ }, (args) => {
      if (args.path.replace(/[\\]/g, '/').toLowerCase() !== target) return undefined;
      return { contents: catalogueSource(releaseSplit().kept), loader: 'ts', resolveDir: join(ROOT, 'src', 'scene') };
    });
  },
};

export const droppedNote = (dropped) => dropped.length
  ? `left out of this release (held back): ${dropped.map((m) => `${m.id} (${m.release.why})`).join('; ')}`
  : '';
