// Rate-limiting TCP proxy in front of the S3 emulator, for the long "app in the background > 10 min" scenarios.
// The emulator console `network speed` did not slow the Wi-Fi/cellular path of the emulator, so the limit is applied here, on the host.
// A pure TCP pass-through: the signed `Host` header (10.0.2.2:<proxy port>) reaches SeaweedFS unchanged, so SigV4 still validates.
// Listens on 127.0.0.1 only (the emulator reaches it as 10.0.2.2).
import { createConnection, createServer, type Server, type Socket } from 'node:net';

export interface ThrottleProxy {
  server: Server;
  listen(): Promise<void>;
  close(): Promise<void>;
  bytesUp: () => number;
}

export function createThrottleProxy(opts: { listenPort: number; targetPort: number; bytesPerSecond: number }): ThrottleProxy {
  let up = 0;
  const sockets = new Set<Socket>();
  const server = createServer((client) => {
    const upstream = createConnection({ host: '127.0.0.1', port: opts.targetPort });
    sockets.add(client);
    sockets.add(upstream);
    const done = () => {
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on('error', done);
    upstream.on('error', done);
    client.on('close', done);
    upstream.on('close', done);
    upstream.pipe(client); // responses are tiny; not limited
    // client -> upstream (the upload) is limited: 16 KiB slices spaced by the rate
    const slice = 16 * 1024;
    const queue: Buffer[] = [];
    let busy = false;
    const pump = () => {
      if (busy) return;
      const chunk = queue.shift();
      if (!chunk) {
        client.resume();
        return;
      }
      busy = true;
      upstream.write(chunk, () => {
        up += chunk.length;
        setTimeout(
          () => {
            busy = false;
            pump();
          },
          Math.ceil((chunk.length / opts.bytesPerSecond) * 1000),
        );
      });
    };
    client.on('data', (data: Buffer) => {
      for (let i = 0; i < data.length; i += slice) queue.push(data.subarray(i, i + slice));
      if (queue.length > 64) client.pause();
      pump();
    });
    client.on('end', () => {
      const wait = setInterval(() => {
        if (queue.length === 0 && !busy) {
          clearInterval(wait);
          upstream.end();
        }
      }, 50);
    });
  });
  return {
    server,
    bytesUp: () => up,
    listen: () => new Promise<void>((resolve) => server.listen(opts.listenPort, '127.0.0.1', resolve)),
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
