// @ts-check
/**
 * Worker thread of the scenario server (EVM-009 AC4). The runner blocks its own thread in synchronous child processes (Maestro runs
 * for minutes), so the server must live in another thread or the app would never get an answer. Messages in: { mode } and { close };
 * out: { port } once, then every recorded request on the channel given in workerData.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { startStubApi } from './stub-api.mjs';

// workerData and messages are untyped at the thread boundary; their shape is fixed by process.mjs
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const { port, channel } = /** @type {{ port: number, channel: import('node:worker_threads').MessagePort }} */ (workerData);
const parent = /** @type {import('node:worker_threads').MessagePort} */ (parentPort);
let epoch = 0;
const stub = await startStubApi({
  port,
  onRequest: (request) => {
    channel.postMessage(request);
  },
  // the counters of the sync part travel on the same channel; `epoch` tells the runner which reset they belong to
  onSync: (report) => {
    channel.postMessage({ sync: report, epoch });
  },
});
parent.on(
  'message',
  (
    /** @type {{ mode?: import('./stub-api.mjs').StubMode, auth?: import('./stub-api.mjs').AuthMode, close?: true, syncReset?: number }} */ message,
  ) => {
    if (message.syncReset !== undefined) {
      epoch = message.syncReset;
      stub.syncReset();
      channel.postMessage({ sync: stub.syncReport(), epoch });
    }
    if (message.mode !== undefined) stub.setMode(message.mode, message.auth ?? 'ok');
    if (message.close === true) {
      void stub.close().then(() => {
        channel.close();
        parent.close();
      });
    }
  },
);
parent.postMessage({ port: stub.port });
