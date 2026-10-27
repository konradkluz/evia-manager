import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ClamdScanner, parseClamdReply } from '../../src/platform/malware-scan/clamd-scanner.ts';
import { EICAR, FakeMalwareScanner } from '../../src/platform/malware-scan/fake-malware-scanner.ts';
import { MalwareScanError } from '../../src/platform/malware-scan/malware-scanner.ts';

async function* chunks(...parts: string[]): AsyncGenerator<Uint8Array> {
  await Promise.resolve();
  for (const part of parts) yield Buffer.from(part);
}

interface FakeClamd {
  readonly server: Server;
  readonly port: number;
  readonly received: Buffer[];
}

const servers: Server[] = [];

/** A clamd stand-in: reads the INSTREAM frames until the zero-length chunk, then answers with `reply` (`undefined` = closes without a reply). */
async function startClamd(reply: string | undefined, options: { replyEarly?: boolean; silent?: boolean } = {}): Promise<FakeClamd> {
  const received: Buffer[] = [];
  const server = createServer((socket: Socket) => {
    let buffer = Buffer.alloc(0);
    socket.on('error', () => undefined);
    socket.on('data', (data: Buffer) => {
      received.push(data);
      buffer = Buffer.concat([buffer, data]);
      if (options.replyEarly === true && reply !== undefined) {
        socket.end(reply);
        return;
      }
      if (options.silent === true) return;
      if (buffer.subarray(-4).equals(Buffer.alloc(4)) && buffer.length > 14) {
        if (reply === undefined) socket.destroy();
        else socket.end(reply);
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { server, port: typeof address === 'object' && address !== null ? address.port : 0, received };
}

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

describe('EVM-044 AC3 the reply of clamd is parsed strictly (fail closed)', () => {
  it('EVM-044 AC3 only "stream: OK" is clean and only "<name> FOUND" is infected', () => {
    expect(parseClamdReply('stream: OK\0')).toEqual({ status: 'clean' });
    expect(parseClamdReply('stream: Eicar-Signature FOUND\0')).toEqual({ status: 'infected' });
    expect(parseClamdReply('stream: Win.Test.EICAR_HDB-1 FOUND\n')).toEqual({ status: 'infected' });
  });

  it.each([
    '',
    '\0',
    'stream: OK extra\0',
    'stream: ERROR\0',
    'INSTREAM size limit exceeded. ERROR\0',
    'stream: Eicar FOUND trailing\0',
    'OK',
    'stream:  FOUND\0',
    'UNKNOWN COMMAND\0',
    'stream: OKAY\0',
  ])('EVM-044 AC3 %j is never clean', (reply) => {
    expect(() => parseClamdReply(reply)).toThrow(MalwareScanError);
  });
});

describe('EVM-044 AC3 the INSTREAM client', () => {
  it('EVM-044 AC3 frames the bytes (zINSTREAM, length-prefixed chunks, zero terminator) and reports clean', async () => {
    const clamd = await startClamd('stream: OK\0');
    const scanner = new ClamdScanner({ kind: 'tcp', host: '127.0.0.1', port: clamd.port });
    await expect(scanner.scan(chunks('hello ', 'world'))).resolves.toEqual({ status: 'clean' });
    const wire = Buffer.concat(clamd.received);
    expect(wire.subarray(0, 10).toString('latin1')).toBe('zINSTREAM\0');
    expect(wire.readUInt32BE(10)).toBe(6);
    expect(wire.subarray(14, 20).toString()).toBe('hello ');
    expect(wire.subarray(-4).equals(Buffer.alloc(4))).toBe(true);
  });

  it('EVM-044 AC3 a large chunk is split into frames of at most 64 KiB', async () => {
    const clamd = await startClamd('stream: OK\0');
    const scanner = new ClamdScanner({ kind: 'tcp', host: '127.0.0.1', port: clamd.port });
    async function* big(): AsyncGenerator<Uint8Array> {
      await Promise.resolve();
      yield Buffer.alloc(150_000, 1);
    }
    await expect(scanner.scan(big())).resolves.toEqual({ status: 'clean' });
    const wire = Buffer.concat(clamd.received);
    expect(wire.readUInt32BE(10)).toBe(65_536);
    expect(wire.length).toBe(10 + 4 + 65_536 + 4 + 65_536 + 4 + (150_000 - 131_072) + 4);
  });

  it('EVM-044 AC3 FOUND is infected', async () => {
    const clamd = await startClamd('stream: Eicar-Signature FOUND\0');
    const scanner = new ClamdScanner({ kind: 'tcp', host: '127.0.0.1', port: clamd.port });
    await expect(scanner.scan(chunks('x'))).resolves.toEqual({ status: 'infected' });
  });

  it('EVM-044 AC3 an ERROR reply, a size-limit reply sent early, and a dropped connection are failures, never clean', async () => {
    const error = await startClamd('stream: ERROR\0');
    await expect(new ClamdScanner({ kind: 'tcp', host: '127.0.0.1', port: error.port }).scan(chunks('x'))).rejects.toBeInstanceOf(
      MalwareScanError,
    );
    const early = await startClamd('INSTREAM size limit exceeded. ERROR\0', { replyEarly: true });
    await expect(new ClamdScanner({ kind: 'tcp', host: '127.0.0.1', port: early.port }).scan(chunks('x'))).rejects.toBeInstanceOf(
      MalwareScanError,
    );
    const dropped = await startClamd(undefined);
    await expect(new ClamdScanner({ kind: 'tcp', host: '127.0.0.1', port: dropped.port }).scan(chunks('x'))).rejects.toBeInstanceOf(
      MalwareScanError,
    );
  });

  it('EVM-044 AC3 an unreachable clamd is a failure', async () => {
    const clamd = await startClamd('stream: OK\0');
    const port = clamd.port;
    clamd.server.close();
    await expect(new ClamdScanner({ kind: 'tcp', host: '127.0.0.1', port }).scan(chunks('x'))).rejects.toBeInstanceOf(MalwareScanError);
  });

  it('EVM-044 AC3 a silent clamd times out as a failure', async () => {
    const clamd = await startClamd(undefined, { silent: true });
    const scanner = new ClamdScanner({ kind: 'tcp', host: '127.0.0.1', port: clamd.port }, { idleTimeoutMs: 100 });
    await expect(scanner.scan(chunks('x'))).rejects.toBeInstanceOf(MalwareScanError);
  });

  it('EVM-044 AC3 a source that fails half way sends no terminator and yields no verdict', async () => {
    const clamd = await startClamd('stream: OK\0');
    async function* broken(): AsyncGenerator<Uint8Array> {
      await Promise.resolve();
      yield Buffer.from('partial');
      throw new Error('storage dropped');
    }
    await expect(new ClamdScanner({ kind: 'tcp', host: '127.0.0.1', port: clamd.port }).scan(broken())).rejects.toBeInstanceOf(
      MalwareScanError,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(Buffer.concat(clamd.received).subarray(-4).equals(Buffer.alloc(4))).toBe(false);
  });

  it('EVM-044 AC3 a unix socket is reachable too', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clamd-'));
    const path = join(dir, 'clamd.sock');
    const server = createServer((socket: Socket) => {
      socket.on('error', () => undefined);
      socket.on('data', (data: Buffer) => {
        if (data.subarray(-4).equals(Buffer.alloc(4))) socket.end('stream: OK\0');
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(path, resolve));
    try {
      await expect(new ClamdScanner({ kind: 'unix', path }).scan(chunks('abc'))).resolves.toEqual({ status: 'clean' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('EVM-044 AC3 the scanner double', () => {
  it('EVM-044 AC3 detects EICAR, passes other bytes and fails when switched to unavailable', async () => {
    const fake = new FakeMalwareScanner();
    await expect(fake.scan(chunks('plain'))).resolves.toEqual({ status: 'clean' });
    await expect(fake.scan(chunks(EICAR))).resolves.toEqual({ status: 'infected' });
    fake.mode = 'unavailable';
    await expect(fake.scan(chunks('plain'))).rejects.toBeInstanceOf(MalwareScanError);
  });
});
