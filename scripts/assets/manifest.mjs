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

/** The only hosts a glTF model's files may be fetched from: the original publishers'. Another host is a reviewed code change, never a manifest edit. */
export const FETCH_HOSTS = ['dl.polyhaven.org', '3d-api.si.edu'];

/** Whether an address may be fetched from: https, on a publisher's own host. Checked before a request and again for where a redirect landed. */
export function fetchAddressProblem(url) {
  let u;
  try { u = new URL(url); } catch { return `${url} is not an address`; }
  if (u.protocol !== 'https:') return `${url} is not https`;
  if (!FETCH_HOSTS.includes(u.hostname)) return `${u.hostname} is not an allowed host (${FETCH_HOSTS.join(', ')})`;
  return undefined;
}

/** Where a model's source files live in the cache: a folder of its own for a glTF model, the source's folder for an archive's. */
export const cacheFolder = (m) => join(CACHE_DIR, m.format === 'gltf' ? m.source.cacheFolder : m.source.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
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
  // An older notice on the files themselves is kept on record, never erased.
  if (m.licence?.earlierNotice) {
    const c = m.licence.earlierNotice;
    need(typeof c.id === 'string' && typeof c.name === 'string' && typeof c.evidence === 'string' && c.kept === true, 'an earlier licence notice names the licence, where it is found, and that it is kept');
  }
  need(m.release === undefined || (typeof m.release.blocked === 'boolean' && (!m.release.blocked || typeof m.release.why === 'string')), 'release is { blocked, why }');
  need(m.orient && ['x+','x-','y+','y-','z+','z-'].includes(m.orient.up) && ['x+','x-','y+','y-','z+','z-'].includes(m.orient.front), 'orient needs up and front, each one of x+ x- y+ y- z+ z-');
  need(m.scale && Number.isFinite(m.scale.unitsToMetres) && m.scale.unitsToMetres > 0, 'scale.unitsToMetres is missing');
  need(m.format === undefined || m.format === 'obj' || m.format === 'gltf', 'format is obj or gltf');
  const gltf = m.format === 'gltf';
  need(Array.isArray(m.files) && m.files.length > 0, 'files is empty');
  const fileIds = new Set();
  for (const f of m.files ?? []) {
    need(typeof f.entry === 'string' && f.entry.length > 0, 'a file needs an entry');
    need(typeof f.entry !== 'string' || (!/^[/\\]/.test(f.entry) && !/[:\\]/.test(f.entry) && !f.entry.split('/').includes('..')), `file entry "${f.entry}" must stay inside the model's folder (no absolute path, drive, backslash or ..)`);
    const id = f.id ?? f.entry;
    if (!gltf) need(typeof f.id === 'string', 'a file needs an id and an entry');
    need(!fileIds.has(id), `file ${id} is listed twice`);
    fileIds.add(id);
    if (gltf) {
      need(fetchAddressProblem(f.url) === undefined, `${f.entry}: url must be https on one of ${FETCH_HOSTS.join(', ')}`);
      need(Number.isInteger(f.bytes) && f.bytes > 0 && typeof f.sha256 === 'string' && /^[0-9a-f]{64}$/.test(f.sha256), `${f.entry}: bytes and sha256 must be pinned`);
    }
  }
  if (gltf) {
    need(m.files.filter((f) => /[.](gltf|glb)$/i.test(f.entry)).length === 1, 'exactly one .gltf or .glb file is the model');
    need(m.source && typeof m.source.cacheFolder === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(m.source.cacheFolder), 'source.cacheFolder is the folder of its own in the cache');
    need(typeof m.retrieved === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(m.retrieved), 'retrieved (the date the files were fetched) is missing');
    need(m.licence && typeof m.licence.statement === 'string' && typeof m.licence.statedOn === 'string', 'a glTF model records the licence as its page states it (licence.statement, licence.statedOn)');
  }
  need(Array.isArray(m.parts) && m.parts.length > 0, 'parts is empty');
  const keys = new Set();
  for (const p of m.parts ?? []) {
    need(typeof p.key === 'string' && ID.test(p.key), `part key "${p.key}" is not a valid key`);
    need(!keys.has(p.key), `part ${p.key} is listed twice`);
    keys.add(p.key);
    need(typeof p.name === 'string' && p.name.length > 0, `part ${p.key} has no name`);
    need(CONFIDENCE.includes(p.confidence), `part ${p.key} needs a confidence (${CONFIDENCE.join(', ')})`);
    need(Array.isArray(p.nodes) && p.nodes.length > 0 || p.derive, `part ${p.key} names no ${gltf ? 'node' : 'file'}`);
    if (!gltf) for (const n of p.nodes ?? []) need(fileIds.has(n), `part ${p.key} names ${n}, which is not in files`);
  }
  return out;
}

export function readManifests() {
  return readdirSync(MODELS_DIR).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const m = JSON.parse(readFileSync(join(MODELS_DIR, f), 'utf8'));
    return { file: join(MODELS_DIR, f), manifest: m };
  });
}
