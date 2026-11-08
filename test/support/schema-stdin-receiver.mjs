// A local startup probe: no provider, network access, prompt files or screen capture. Reads the first line of its input and says what it was.
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
createInterface({ input: process.stdin }).once('line', (line) => {
  process.stdout.write(JSON.stringify({ length: line.length, hash: createHash('sha256').update(line).digest('hex') }));
  process.exit(0);
});
