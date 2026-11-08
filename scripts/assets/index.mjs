// node scripts/assets/index.mjs [--check]
// Writes what the app and the guide need to know about the models, from the manifests alone (no mesh needed): src/scene/model-catalogue.ts, and the
// exportable credits file assets/CREDITS.md. Both are committed (a few KB) and a test checks they are what the manifests say; --check does the same here.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LICENCES, ROOT, manifestProblems, readManifests } from './manifest.mjs';

const PARTS_VERSION = 1;

export function catalogueSource(manifests) {
  const entries = manifests.map((m) => ({
    id: m.id, name: m.name, description: m.description, aliases: m.aliases,
    licence: { id: m.licence.id, name: LICENCES[m.licence.id].name, version: m.licence.version, url: LICENCES[m.licence.id].url },
    credit: LICENCES[m.licence.id].credit ? m.credit : undefined,
    size: m.built.size, realLengthMetres: m.scale.realLengthMetres, caveats: m.caveats ?? [],
    built: { file: m.built.file, bytes: m.built.bytes, sha256: m.built.sha256, triangles: m.built.triangles },
    parts: m.parts.map((p) => ({
      key: p.key, name: p.name, aliases: p.aliases ?? [], confidence: p.confidence, color: p.color, closed: m.built.parts[p.key].closed,
      center: m.built.parts[p.key].center, size: m.built.parts[p.key].size, triangles: m.built.parts[p.key].triangles,
    })),
  }));
  return `// The real models the scene language can place: what each is, its licence and credit, and its named parts. Generated from assets/models/*.json by
// \`npm run assets:index\` (scripts/assets/index.mjs); do not edit. The meshes themselves are built files, not in git (see scripts/assets).

import type { Vec3 } from './types.ts';

export type ModelPart = {
  key: string; name: string; aliases: string[];
  /** How the source backs the part: atlas (a named mesh of the source), grouped (several of its meshes, grouped by us), approximate (a place, not a structure). */
  confidence: 'atlas' | 'grouped' | 'approximate';
  color: [number, number, number];
  /** Whether the mesh is a watertight solid, so a cut can be capped. */
  closed: boolean;
  /** The part's middle and size in metres, from the model's own middle. */
  center: Vec3; size: Vec3; triangles: number;
};
export type ModelEntry = {
  id: string; name: string; description: string; aliases: string[];
  licence: { id: string; name: string; version: string; url: string };
  /** The credit line the licence asks to be shown (CC BY); none for CC0. */
  credit: string | undefined;
  /** The whole model's size in metres, and the real length of its subject. */
  size: Vec3; realLengthMetres: number; caveats: string[];
  built: { file: string; bytes: number; sha256: string; triangles: number };
  parts: ModelPart[];
};

export const MODELS: readonly ModelEntry[] = ${JSON.stringify(entries, null, 2)};
`;
}

export function creditsSource(manifests) {
  const lines = [
    '# Credits for the real models',
    '',
    'Talkthrough itself is MIT licensed. The models it can show are separate works under their own licences, listed here, and are not part of the MIT grant.',
    'This file is generated from `assets/models/*.json` (`npm run assets:index`) and is shipped with the app.',
    '',
  ];
  for (const m of manifests) {
    const lic = LICENCES[m.licence.id];
    lines.push(`## ${m.name} (\`${m.id}\`)`, '');
    lines.push(`- Source: ${m.source.name}, ${m.source.url} (${m.source.version})`);
    lines.push(`- Licence: ${lic.name}, version ${m.licence.version}: ${m.licence.url ?? lic.url}`);
    if (m.credit) lines.push(`- Credit: ${m.credit}`);
    lines.push(`- Changes: ${m.changes}`);
    if (m.licence.note) lines.push(`- Note: ${m.licence.note}`);
    lines.push(`- Built file: ${m.built.file}, ${m.built.bytes} bytes, sha256 ${m.built.sha256}`);
    lines.push(`- Parts: ${m.parts.map((p) => `${p.name} (${p.confidence})`).join('; ')}`);
    for (const c of m.caveats ?? []) lines.push(`- Limit: ${c}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function generate() {
  const manifests = readManifests().map((x) => x.manifest);
  for (const m of manifests) {
    const problems = manifestProblems(m);
    if (problems.length) throw new Error(`${m.id}: ${problems.join('; ')}`);
    if (!m.built) throw new Error(`${m.id} has not been built and pinned (run assets:build --pin)`);
  }
  return { catalogue: catalogueSource(manifests), credits: creditsSource(manifests) };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const out = generate();
  const files = [[join(ROOT, 'src', 'scene', 'model-catalogue.ts'), out.catalogue], [join(ROOT, 'assets', 'CREDITS.md'), out.credits]];
  if (process.argv.includes('--check')) {
    for (const [path, text] of files) if (readFileSync(path, 'utf8').replace(/\r\n/g, '\n') !== text) { console.error(`${path} is not what the manifests say: run npm run assets:index`); process.exit(1); }
    console.log('catalogue and credits are current');
  } else {
    for (const [path, text] of files) { writeFileSync(path, text); console.log('wrote', path); }
  }
}
