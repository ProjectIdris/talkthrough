import assert from 'node:assert/strict';
import test from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';
// @ts-expect-error a plain script module
import { readDirectory, readEntry } from '../scripts/assets/zip-range.mjs';

/** A zip made by hand: each file stored or deflated, a directory at the end, an end record. */
function makeZip(files: Array<{ name: string; data: Buffer; deflate?: boolean }>, junk = 0): Buffer {
  const parts: Buffer[] = [Buffer.alloc(junk, 7)]; // bytes before the first file (an archive may start with anything)
  const central: Buffer[] = [];
  let offset = junk;
  for (const f of files) {
    const body = f.deflate ? deflateRawSync(f.data) : f.data;
    const name = Buffer.from(f.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(f.deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc32(f.data), 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(f.data.length, 22); local.writeUInt16LE(name.length, 26);
    const rec = Buffer.alloc(46);
    rec.writeUInt32LE(0x02014b50, 0); rec.writeUInt16LE(20, 4); rec.writeUInt16LE(20, 6); rec.writeUInt16LE(f.deflate ? 8 : 0, 10);
    rec.writeUInt32LE(crc32(f.data), 16); rec.writeUInt32LE(body.length, 20); rec.writeUInt32LE(f.data.length, 24); rec.writeUInt16LE(name.length, 28); rec.writeUInt32LE(offset, 42);
    parts.push(local, name, body);
    central.push(rec, name);
    offset += 30 + name.length + body.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

const rangeOf = (zip: Buffer, log: Array<[number, number]> = []) => async (a: number, b: number) => { log.push([a, b]); return zip.subarray(a, b); };

test('a single file is read from a zip by its byte range, stored or deflated', async () => {
  const a = Buffer.from('o 1 2 3\nv 0 0 0\n'.repeat(40)), b = Buffer.from('plain bytes');
  const zip = makeZip([{ name: 'dir/filler.bin', data: Buffer.alloc(300000, 3) }, { name: 'dir/FJ0001.obj', data: a, deflate: true }, { name: 'dir/FJ0002.obj', data: b }, { name: 'dir/FJ0003.obj', data: Buffer.from('x'.repeat(5000)), deflate: true }], 123);
  const log: Array<[number, number]> = [];
  const dir = await readDirectory(zip.length, rangeOf(zip, log));
  assert.deepEqual(dir.map((e: { name: string }) => e.name), ['dir/filler.bin', 'dir/FJ0001.obj', 'dir/FJ0002.obj', 'dir/FJ0003.obj']);
  const taken = log.length;
  assert.deepEqual(await readEntry(dir[1], rangeOf(zip, log)), a);
  assert.deepEqual(await readEntry(dir[2], rangeOf(zip, log)), b);
  // Reading the directory touched only its end, and one file only that file's bytes: nothing like the whole archive.
  const bytes = log.reduce((n, [x, y]) => n + (y - x), 0);
  assert.ok(taken <= 2, `directory read in ${taken} ranges`);
  assert.ok(bytes < 70000 + 600, `${bytes} of ${zip.length}`);
  assert.ok(!log.some(([x, y]) => x === 0 && y >= zip.length), 'the whole archive was never asked for');
});

test('a damaged archive is refused: no end record, a bad size, an unsupported method', async () => {
  await assert.rejects(readDirectory(10, async () => Buffer.alloc(10)), /not a zip/);
  const zip = makeZip([{ name: 'a.obj', data: Buffer.from('abc') }]);
  const dir = await readDirectory(zip.length, rangeOf(zip));
  await assert.rejects(readEntry({ ...dir[0], size: 99 }, rangeOf(zip)), /size of a\.obj/);
  await assert.rejects(readEntry({ ...dir[0], method: 12 }, rangeOf(zip)), /unsupported compression/);
});
