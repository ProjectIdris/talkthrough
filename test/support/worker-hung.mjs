// A reader that loads and then never answers a read.
import { parentPort } from 'node:worker_threads';
parentPort.on('message', () => undefined);
parentPort.postMessage({ ready: true });
