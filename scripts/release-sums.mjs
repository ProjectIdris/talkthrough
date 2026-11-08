// Writes release/SHA256SUMS.txt beside the installer, one `<sha256>  <file>` line (the format `sha256sum` writes), which is what the app's
// self-update checks a download against. Publish it with the installer on the release.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function writeSums(dir, name) {
  const hash = createHash('sha256').update(readFileSync(join(dir, name))).digest('hex');
  const file = join(dir, 'SHA256SUMS.txt');
  writeFileSync(file, `${hash}  ${name}\n`);
  return { file, hash };
}
