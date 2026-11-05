// Narrow PE CodeView debug-path handling for disposable Windows packaging inputs.
import path from 'node:path';

function checked(buffer, offset, size) {
  if (!Number.isSafeInteger(offset) || offset < 0 || size < 0 || offset + size > buffer.length) {
    throw new Error('Malformed PE bounds');
  }
}

function parse(input) {
  const b = Buffer.from(input);
  checked(b, 0, 64);
  if (b.toString('ascii', 0, 2) !== 'MZ') throw new Error('Malformed PE DOS header');
  const pe = b.readUInt32LE(0x3c);
  checked(b, pe, 24);
  if (b.toString('binary', pe, pe + 4) !== 'PE\0\0') throw new Error('Malformed PE signature');
  const count = b.readUInt16LE(pe + 6), optionalSize = b.readUInt16LE(pe + 20), optional = pe + 24;
  checked(b, optional, optionalSize);
  const magic = b.readUInt16LE(optional);
  if (magic !== 0x20b && magic !== 0x10b) throw new Error('Unsupported PE format');
  const directories = optional + (magic === 0x20b ? 112 : 96);
  const directoryCount = optional + (magic === 0x20b ? 108 : 92);
  checked(b, directoryCount, 4);
  if (b.readUInt32LE(directoryCount) < 7 || directories + 7 * 8 > optional + optionalSize) throw new Error('Missing PE debug directory');
  const checksum = optional + 64;
  checked(b, checksum, 4);
  if (b.readUInt32LE(directories + 4 * 8 + 4) !== 0) throw new Error('Signed PE inputs cannot be modified');
  const sections = optional + optionalSize;
  checked(b, sections, count * 40);
  const rva = b.readUInt32LE(directories + 6 * 8), size = b.readUInt32LE(directories + 6 * 8 + 4);
  if (!rva && !size) return { b, checksum, records: [] };
  if (!rva || !size || size % 28) throw new Error('Malformed PE debug directory');
  let offset;
  for (let i = 0; i < count; i++) {
    const section = sections + i * 40, address = b.readUInt32LE(section + 12);
    const rawSize = b.readUInt32LE(section + 16), raw = b.readUInt32LE(section + 20);
    if (rva >= address && rva - address + size <= rawSize) { offset = raw + rva - address; break; }
  }
  if (offset === undefined) throw new Error('Unmapped PE debug directory');
  checked(b, offset, size);
  const records = [];
  for (let i = 0; i < size; i += 28) {
    const entry = offset + i;
    if (b.readUInt32LE(entry + 12) !== 2) continue;
    const length = b.readUInt32LE(entry + 16), raw = b.readUInt32LE(entry + 24);
    checked(b, raw, length);
    const signature = b.toString('ascii', raw, raw + 4);
    const start = raw + (signature === 'RSDS' ? 24 : signature === 'NB10' ? 16 : 0);
    if (start === raw || start >= raw + length) throw new Error('Unsupported CodeView record');
    const end = b.indexOf(0, start);
    if (end < 0 || end >= raw + length) throw new Error('Malformed CodeView path');
    const value = b.toString('latin1', start, end);
    records.push({ start, end, value, unsafe: /[\\/]/.test(value) });
  }
  return { b, checksum, records };
}

export function inspectPeDebugPaths(input) {
  const parsed = parse(input);
  return { records: parsed.records.length, unsafe: parsed.records.filter(record => record.unsafe).length };
}

function peChecksum(b, skip) {
  let sum = 0;
  for (let i = 0; i < b.length; i += 2) {
    if (i === skip || i === skip + 2) continue;
    sum += (b[i] ?? 0) + ((b[i + 1] ?? 0) << 8);
    sum = (sum & 0xffff) + (sum >>> 16);
  }
  sum = (sum & 0xffff) + (sum >>> 16);
  return ((sum & 0xffff) + b.length) >>> 0;
}

export function sanitizePeDebugPaths(input) {
  const parsed = parse(input);
  let changed = 0;
  for (const record of parsed.records) {
    if (!record.unsafe) continue;
    const name = path.win32.basename(record.value.replaceAll('/', '\\'));
    if (!name || name === '.' || name === '..') throw new Error('Invalid CodeView basename');
    parsed.b.fill(0, record.start, record.end);
    parsed.b.write(name, record.start, record.end - record.start, 'latin1');
    changed++;
  }
  if (changed) {
    parsed.b.writeUInt32LE(0, parsed.checksum);
    parsed.b.writeUInt32LE(peChecksum(parsed.b, parsed.checksum), parsed.checksum);
  }
  return { buffer: parsed.b, changed };
}
