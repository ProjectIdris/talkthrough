// node scripts/assets/fetch.mjs [--pin] [model ...]
// The one place files are fetched: a developer step, never run by the app. For each manifest it makes sure every file it names is in the cache
// (assets/cache, or the folder named by TALKTHROUGH_ASSET_CACHE), downloaded only if missing, and checks each against the size and sha256 the manifest
// pins. A file that does not match is refused and removed, not used. --pin is the maintainer's step: it lists the files a manifest's parts need,
// downloads them and writes their sizes and hashes into the manifest.
// Only what the manifests name is downloaded: from a large archive, just those files, by byte range.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CACHE_DIR, manifestProblems, readManifests, sha256 } from './manifest.mjs';
import { httpRange, readDirectory, readEntry } from './zip-range.mjs';

const args = process.argv.slice(2);
const pin = args.includes('--pin');
const only = args.filter((a) => !a.startsWith('--'));

const cachePath = (m, f) => join(CACHE_DIR, m.source.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), f.entry);
const directories = new Map();

/** The archive's directory, checked against the size the manifest recorded (a re-published archive is not the one that was reviewed). */
async function archiveDirectory(m) {
  const { url, bytes } = m.source.archive;
  if (!directories.has(url)) {
    const head = await fetch(url, { method: 'HEAD' });
    const size = Number(head.headers.get('content-length'));
    if (size !== bytes) throw new Error(`${url} is ${size} bytes, the manifest says ${bytes}: it has changed; review it before updating the manifest`);
    directories.set(url, await readDirectory(size, httpRange(url)));
  }
  return directories.get(url);
}

async function fromArchive(m, entry) {
  const dir = await archiveDirectory(m);
  const item = dir.find((e) => e.name === entry);
  if (!item) throw new Error(`${entry} is not in ${m.source.archive.url}`);
  return readEntry(item, httpRange(m.source.archive.url));
}

let failed = 0;
for (const { file, manifest: m } of readManifests()) {
  if (only.length && !only.includes(m.id)) continue;
  console.log(`${m.id}: ${m.parts.length} parts`);
  if (pin) {
    // The files a part names, in the order they appear; the archive folder is the manifest's.
    const ids = [...new Set(m.parts.flatMap((p) => p.nodes ?? []))];
    const known = new Map((m.files ?? []).map((f) => [f.id, f]));
    m.files = ids.map((id) => known.get(id) ?? { id, entry: `${m.source.archive.folder}/${id}.obj` });
  } else if (manifestProblems(m).length) {
    console.error(`  manifest is not sound: ${manifestProblems(m).join('; ')}`);
    failed++;
    continue;
  }
  let fetched = 0, bytes = 0;
  for (const f of m.files) {
    const path = cachePath(m, f);
    let data = existsSync(path) ? readFileSync(path) : undefined;
    if (data && f.sha256 && sha256(data) !== f.sha256) { console.error(`  ${f.id}: the cached file does not match its pinned hash; removed`); rmSync(path); data = undefined; }
    if (!data) {
      try { data = await fromArchive(m, f.entry); } catch (e) { console.error(`  ${f.id}: ${e.message}`); failed++; continue; }
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, data);
      fetched++;
      bytes += data.length;
    }
    if (pin) { f.bytes = data.length; f.sha256 = sha256(data); }
    else if (f.sha256 !== sha256(data) || f.bytes !== data.length) { console.error(`  ${f.id}: does not match the manifest (hash or size); refused`); rmSync(path); failed++; }
  }
  if (pin) writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
  console.log(`  ${m.files.length} files, ${fetched} fetched (${(bytes / 1048576).toFixed(1)} MB)`);
}
if (failed) { console.error(`${failed} problem${failed === 1 ? '' : 's'}`); process.exit(1); }
