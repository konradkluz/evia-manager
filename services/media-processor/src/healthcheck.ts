/** The health check of the container (EVM-068): the socket accepts a connection. Exit 0 = healthy. */
import { createConnection } from 'node:net';

/** @returns whether the socket accepted a connection within `timeoutMs` */
export function isListening(socketPath: string, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath);
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
