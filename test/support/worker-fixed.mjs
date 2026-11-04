// A reader that always sees the same window.
import { parentPort } from 'node:worker_threads';
parentPort.on('message', (m) => parentPort.postMessage({ id: m.id, window: { title: 'Fixed window', appName: 'Fixture' } }));
parentPort.postMessage({ ready: true });
