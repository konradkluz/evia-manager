/** The health check of the container (EVM-068): the socket accepts a connection. Exit 0 = healthy. */
import { createConnection } from 'node:net';

/** @returns whether the socket (a file; a loopback port in the tests, which run on any platform) accepted a connection within `timeoutMs` */
export function isListening(target: string | number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = typeof target === 'number' ? createConnection(target, '127.0.0.1') : createConnection(target);
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      resolve(false);
    });
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
  });
}

/* v8 ignore start -- process wiring of the container health check (isListening() is tested) */
if (import.meta.main) {
  process.exit((await isListening(process.env['MEDIA_PROCESSOR_SOCKET'] ?? '')) ? 0 : 1);
}
/* v8 ignore stop */
