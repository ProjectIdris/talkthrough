// Reading and checking the per-model manifests (assets/models/*.json), shared by the fetch, build and index scripts. A manifest is the whole claim about
// a model: where it came from, under which licence, which files, how they are turned into the scene's axes and size, and which named parts are which
// files. Nothing is trusted that the manifest does not say.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MODELS_DIR = join(ROOT, 'assets', 'models');
export const CACHE_DIR = process.env.TALKTHROUGH_ASSET_CACHE ? resolve(process.env.TALKTHROUGH_ASSET_CACHE) : join(ROOT, 'assets', 'cache');
export const BUILT_DIR = join(ROOT, 'assets', 'built');

/** Licences a model may carry: the permissive ones the project can redistribute. Everything else is refused (NC and ND, share-alike, "CC" alone). */
export const LICENCES = {
  'CC0-1.0': { name: 'CC0 1.0 Universal', url: 'https://creativecommons.org/publicdomain/zero/1.0/', credit: false },
  'CC-BY-4.0': { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', credit: true },
};

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const CONFIDENCE = ['atlas', 'grouped', 'approximate'];
const ID = /^[a-z][a-z0-9-]{0,31}$/;

/** Problems with a manifest, as plain sentences (an empty list means it is sound). */
export function manifestProblems(m) {
  const out = [];
  const need = (ok, why) => { if (!ok) out.push(why); };
  need(m && typeof m === 'object', 'the manifest is not an object');
  if (!m || typeof m !== 'object') return out;
  need(typeof m.id === 'string' && ID.test(m.id), 'id must be lower-case letters, digits and dashes');
  need(typeof m.name === 'string' && m.name.length > 0, 'name is missing');
  need(typeof m.description === 'string' && m.description.length > 0 && m.description.length <= 160, 'description is missing or longer than 160 characters');
  need(Array.isArray(m.aliases) && m.aliases.every((a) => typeof a === 'string'), 'aliases must be a list of words');
  need(m.licence && Object.hasOwn(LICENCES, m.licence.id), `licence must be one of ${Object.keys(LICENCES).join(', ')}`);
  need(m.licence && typeof m.licence.version === 'string', 'the licence needs its version');
  need(m.source && typeof m.source.name === 'string' && typeof m.source.url === 'string', 'source needs a name and a url');
  need(m.credit === undefined || typeof m.credit === 'string', 'credit must be text');
  if (m.licence && LICENCES[m.licence.id]?.credit) need(typeof m.credit === 'string' && m.credit.length > 0, 'this licence requires a credit line');
  need(typeof m.changes === 'string', 'changes (what was done to the files) must be stated');
  need(m.orient && ['x+','x-','y+','y-','z+','z-'].includes(m.orient.up) && ['x+','x-','y+','y-','z+','z-'].includes(m.orient.front), 'orient needs up and front, each one of x+ x- y+ y- z+ z-');
  need(m.scale && Number.isFinite(m.scale.unitsToMetres) && m.scale.unitsToMetres > 0, 'scale.unitsToMetres is missing');
  need(Array.isArray(m.files) && m.files.length > 0, 'files is empty');
  const fileIds = new Set();
  for (const f of m.files ?? []) {
    need(typeof f.id === 'string' && typeof f.entry === 'string', 'a file needs an id and an entry');
    need(!fileIds.has(f.id), `file ${f.id} is listed twice`);
    fileIds.add(f.id);
  }
  need(Array.isArray(m.parts) && m.parts.length > 0, 'parts is empty');
  const keys = new Set();
  for (const p of m.parts ?? []) {
    need(typeof p.key === 'string' && ID.test(p.key), `part key "${p.key}" is not a valid key`);
    need(!keys.has(p.key), `part ${p.key} is listed twice`);
    keys.add(p.key);
    need(typeof p.name === 'string' && p.name.length > 0, `part ${p.key} has no name`);
    need(CONFIDENCE.includes(p.confidence), `part ${p.key} needs a confidence (${CONFIDENCE.join(', ')})`);
    need(Array.isArray(p.nodes) && p.nodes.length > 0 || p.derive, `part ${p.key} names no file`);
    for (const n of p.nodes ?? []) need(fileIds.has(n), `part ${p.key} names ${n}, which is not in files`);
  }
  return out;
}

export function readManifests() {
  return readdirSync(MODELS_DIR).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const m = JSON.parse(readFileSync(join(MODELS_DIR, f), 'utf8'));
    return { file: join(MODELS_DIR, f), manifest: m };
  });
}
