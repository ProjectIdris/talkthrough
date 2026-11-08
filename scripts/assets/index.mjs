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
    release: { blocked: m.release?.blocked === true, why: m.release?.why },
    credit: LICENCES[m.licence.id].credit ? m.credit : undefined,
    format: m.format ?? 'obj',
    // One object with no parts of its own (a scan, or a model of one thing): it is labelled whole, never exploded or cut.
    single: m.parts.length === 1,
    // Whether the model's parts hold the thing's working mechanism, so it can show how the thing works; none does today (a clock's hands turn, but its gears and bell are not modelled).
    mechanism: m.mechanism === true,
    size: m.built.size, realLengthMetres: m.scale.realLengthMetres ?? Math.max(...m.built.size), caveats: m.caveats ?? [],
    built: { file: m.built.file, bytes: m.built.bytes, sha256: m.built.sha256, triangles: m.built.triangles },
    parts: m.parts.map((p) => ({
      key: p.key, name: p.name, aliases: p.aliases ?? [], confidence: p.confidence, color: p.color ?? [255, 255, 255], closed: m.built.parts[p.key].closed,
      center: m.built.parts[p.key].center, size: m.built.parts[p.key].size, triangles: m.built.parts[p.key].triangles,
      ...(m.built.parts[p.key].hub ? { hub: m.built.parts[p.key].hub } : {}), ...(p.explode ? { explode: p.explode } : {}),
    })),
  }));
  return `// The real models the scene language can place: what each is, its licence and credit, and its named parts. Generated from assets/models/*.json by
// \`npm run assets:index\` (scripts/assets/index.mjs); do not edit. The meshes themselves are built files: those of the models a release carries are committed, the rest are not (see docs/real-models.md).

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
  /** Where the part turns, in metres from the model's own middle (a clock hand's boss), when it is not its own middle: a spin or loop turns it about this point. */
  hub?: Vec3;
  /** Where the part goes in metres when the model is exploded (a hand lifts off its face), from where it sits; without it, outward from the middle. */
  explode?: Vec3;
};
export type ModelEntry = {
  id: string; name: string; description: string; aliases: string[];
  /** obj: parts built from a source's meshes and drawn in a flat colour; gltf: the artist's own textured materials, passed through. */
  format: 'obj' | 'gltf';
  /** One object with no parts of its own: label the whole, never explode or cut it. */
  single: boolean;
  /** Whether its parts hold the thing's working mechanism (so it can show how the thing works), not only how it looks and where its parts are: when false, an answer about how it works builds the mechanism from shapes and may show this small beside it. */
  mechanism: boolean;
  licence: { id: string; name: string; version: string; url: string };
  /** A model held back from every release (the installer is not built while one is). */
  release: { blocked: boolean; why?: string };
  /** The credit line the licence asks to be shown (CC BY); none for CC0. */
  credit?: string;
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
    'Talkthrough\'s own code is MIT licensed. The MIT licence covers that code only: it excludes the models named here, which are separate works under their own licences, listed below with who made them and what was changed.',
    'This file is generated from `assets/models/*.json` (`npm run assets:index`) and is shipped with the app.',
    '',
  ];
  for (const m of manifests) {
    const lic = LICENCES[m.licence.id];
    lines.push(`## ${m.name} (\`${m.id}\`)`, '');
    lines.push(`- Source: ${m.source.name}, ${m.source.url} (${m.source.version})`);
    if (m.source.archive) lines.push(`- Source archive: ${m.source.archive.url} (${m.source.archive.bytes} bytes)`);
    lines.push(`- Licence: ${lic.name}, version ${m.licence.version}: ${m.licence.url ?? lic.url}`);
    if (m.licence.earlierNotice) lines.push(`- Earlier notice, kept on record: ${m.licence.earlierNotice.evidence} name ${m.licence.earlierNotice.name}; the current grant above is what is relied on.`);
    if (m.release?.blocked) lines.push(`- Held back from releases: ${m.release.why}.`);
    if (m.credit) lines.push(`- Credit: ${m.credit}`);
    if (m.licence.statement) lines.push(`- As the licence is stated at ${m.licence.statedOn}: ${m.licence.statement}`);
    if (m.source.authors?.length) lines.push(`- Made by: ${m.source.authors.join(', ')}${m.licence.id === 'CC0-1.0' ? ' (no credit is required; named here as a courtesy)' : ''}`);
    if (m.retrieved) lines.push(`- Fetched on ${m.retrieved} from: ${m.files.filter((f) => f.url).map((f) => f.url).slice(0, 1).join('')}${m.files.length > 1 ? ` and ${m.files.length - 1} more files named in the manifest` : ''}`);
    lines.push(`- Changes: ${m.changes}`);
    if (m.licence.note) lines.push(`- Note: ${m.licence.note}`);
    lines.push(`- Built file: ${m.built.file}, ${m.built.bytes} bytes, sha256 ${m.built.sha256}`);
    lines.push(m.format === 'gltf'
      ? `- Parts (source node): ${m.parts.map((p) => `${p.name} (${(p.nodes ?? []).join(' ')})`).join('; ')}`
      : `- Parts (confidence; source element ids): ${m.parts.map((p) => `${p.name} (${p.confidence}; ${(p.nodes ?? []).join(' ')})`).join('; ')}`);
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
