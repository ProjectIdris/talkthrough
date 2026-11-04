// A reader whose answers are late or never: workerData.delays says, read by read, how long to wait before answering (null: never);
// workerData.hang makes it never answer anything.
import { parentPort, workerData } from 'node:worker_threads';
let n = 0;
parentPort.on('message', (m) => {
  const delay = workerData?.hang ? null : (workerData?.delays?.[n++ % (workerData?.delays?.length ?? 1)] ?? 0);
  if (delay === null) return;
  setTimeout(() => parentPort.postMessage({ id: m.id, window: { title: 'Fixed window', appName: 'Fixture' } }), delay);
});
parentPort.postMessage({ ready: true });
