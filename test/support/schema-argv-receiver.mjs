// A local startup probe: no provider, network access, prompt files or screen capture.
import { createHash } from 'node:crypto';
const args = process.argv.slice(2);
process.stdout.write(JSON.stringify({ count: args.length, hash: createHash('sha256').update(JSON.stringify(args)).digest('hex') }));
