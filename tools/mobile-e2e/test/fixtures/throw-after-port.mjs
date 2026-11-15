// Fixture of a worker that reports a port and then dies on an uncaught exception (EVM-130): the host must say so, not stay silent.
import { parentPort } from 'node:worker_threads';

parentPort?.postMessage({ port: 1 });
setTimeout(() => {
  throw new Error('synthetic worker failure');
}, 20);
