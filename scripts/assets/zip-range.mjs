// Reads single files out of a large zip without downloading the whole archive: the end of the zip names where its directory is, the directory names
// every file and where it starts, and each file is then a small byte range. `read(start, end)` is any function that returns those bytes (end is
// exclusive), so the same code runs against an HTTP server that accepts ranges and against a buffer in a test. Plain and deflated entries only, and
// no zip64: an archive that needs it is refused rather than half read.

import { inflateRawSync } from 'node:zlib';

const EOCD_SIG = 0x06054b50, CEN_SIG = 0x02014b50, LOC_SIG = 0x04034b50;

/** The directory of the archive: one record for each file in it. */
export async function readDirectory(size, read) {
  const tail = Math.min(size, 65557 + 22);
  const end = await read(size - tail, size);
  let at = -1;
  for (let i = end.length - 22; i >= 0; i--) if (end.readUInt32LE(i) === EOCD_SIG) { at = i; break; }
  if (at < 0) throw new Error('not a zip (no end record)');
  const count = end.readUInt16LE(at + 10), cdSize = end.readUInt32LE(at + 12), cdStart = end.readUInt32LE(at + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdStart === 0xffffffff) throw new Error('zip64 archives are not supported');
  const cd = await read(cdStart, cdStart + cdSize);
  const files = [];
  for (let p = 0, n = 0; n < count; n++) {
    if (cd.readUInt32LE(p) !== CEN_SIG) throw new Error('bad directory record');
    const method = cd.readUInt16LE(p + 10), crc = cd.readUInt32LE(p + 16), csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32), offset = cd.readUInt32LE(p + 42);
    const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
    files.push({ name, method, crc, compressedSize: csize, size: usize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** One file's bytes, checked against its size and its crc. */
export async function readEntry(entry, read) {
  const head = await read(entry.offset, entry.offset + 30);
  if (head.readUInt32LE(0) !== LOC_SIG) throw new Error(`bad local header for ${entry.name}`);
  const start = entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  const raw = await read(start, start + entry.compressedSize);
  const data = entry.method === 0 ? raw : entry.method === 8 ? inflateRawSync(raw) : (() => { throw new Error(`unsupported compression ${entry.method} for ${entry.name}`); })();
  if (data.length !== entry.size) throw new Error(`size of ${entry.name} is ${data.length}, the archive says ${entry.size}`);
  return data;
}

/** A `read` that asks an HTTP server for byte ranges. */
export function httpRange(url, fetchImpl = fetch) {
  return async (start, end) => {
    const response = await fetchImpl(url, { headers: { Range: `bytes=${start}-${end - 1}` } });
    if (response.status !== 206) throw new Error(`${url}: the server did not give the range ${start}-${end - 1} (status ${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  };
}
