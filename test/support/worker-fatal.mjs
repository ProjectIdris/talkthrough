// A reader that cannot load.
import { parentPort } from 'node:worker_threads';
parentPort.postMessage({ fatal: 'the reader would not load' });
