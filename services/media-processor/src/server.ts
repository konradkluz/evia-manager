/**
 * The listener of the processor (EVM-068; ADR-0009): a Unix socket, ONE job at a time (a queue in order of arrival). A connection sends one line
 * of at most {@link MAX_REQUEST_BYTES}, gets one line back and is closed; a request that is not exactly the protocol, or does not arrive within
 * 5 s, is closed without an answer. The log carries a job id and a fixed code, nothing else (no file name, no text of a library).
 */
import { createServer, type Server, type Socket } from 'node:net';
import { MAX_REQUEST_BYTES, parseRequest, type JobRequest, type JobResult } from './protocol.ts';
import { parseVideoRequest, type VideoRequest, type VideoResult } from './video-protocol.ts';

export type JobRunner = (request: JobRequest | VideoRequest) => Promise<JobResult | VideoResult>;
export type JobLogger = (entry: { readonly event: string; readonly jobId?: string; readonly code?: string }) => void;

const REQUEST_WAIT_MS = 5000;

export function createProcessorServer(run: JobRunner, log: JobLogger): Server {
  let queue: Promise<unknown> = Promise.resolve();

  const serve = (socket: Socket): void => {
    let received = '';
    let handled = false;
    socket.setTimeout(REQUEST_WAIT_MS, () => {
      if (!handled) socket.destroy();
    });
    socket.on('error', () => undefined);
    socket.on('data', (chunk) => {
      if (handled) return;
      received += chunk.toString('utf8');
      if (received.length > MAX_REQUEST_BYTES + 1) {
        handled = true;
        socket.destroy();
        return;
      }
      const end = received.indexOf('\n');
      if (end === -1) return;
      handled = true;
      socket.setTimeout(0);
      const line = received.slice(0, end);
      const request = parseRequest(line) ?? parseVideoRequest(line);
      if (request === undefined) {
        log({ event: 'rejected' });
        socket.destroy();
        return;
      }
      queue = queue.then(async () => {
        const result = await run(request).catch((): JobResult => ({ ok: false, code: 'internal' }));
        log({ event: 'done', jobId: request.jobId, code: result.ok ? 'ok' : result.code });
        socket.end(`${JSON.stringify(result)}\n`);
      });
    });
  };

  return createServer(serve);
}
