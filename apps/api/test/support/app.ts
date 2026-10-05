/**
 * Test helpers of the API (EVM-008): synthetic configuration and an in-memory log destination. No real data —
 * passwords and versions below are synthetic.
 */
import { Writable } from 'node:stream';

/** A database that refuses connections immediately (nothing listens on port 1) — no DNS, no waiting. */
export const UNREACHABLE_DATABASE_URL = 'postgres://evia:synthetic-test-password@127.0.0.1:1/evia';

export function validEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: UNREACHABLE_DATABASE_URL,
    MIN_SUPPORTED_APP_VERSION_ANDROID: '1.2.0',
    MIN_SUPPORTED_APP_VERSION_IOS: '1.1.0',
    ...overrides,
  };
}

/** Collects pino output lines (JSON) for assertions. */
export class LogCapture extends Writable {
  readonly lines: string[] = [];

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.lines.push(...chunk.toString('utf8').split('\n').filter(Boolean));
    callback();
  }

  get entries(): Array<Record<string, unknown>> {
    return this.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  get text(): string {
    return this.lines.join('\n');
  }
}
