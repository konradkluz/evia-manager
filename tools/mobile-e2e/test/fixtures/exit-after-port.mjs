// Fixture of a worker that reports a port and then ends (EVM-009 AC4): close() of the host must not hang.
import { parentPort } from 'node:worker_threads';

parentPort?.postMessage({ port: 1 });
process.exit(0);
