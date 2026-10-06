import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createPool } from '../../src/platform/database/database.ts';
import { currentTraceId, newTraceId, requestContextMixin } from '../../src/platform/http/request-context.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { NestLoggerAdapter } from '../../src/platform/logging/nest-logger.ts';
import { installProcessHandlers } from '../../src/platform/process/process-handlers.ts';
import { LogCapture, UNREACHABLE_DATABASE_URL } from '../support/app.ts';

const capture = () => {
  const destination = new LogCapture();
  return { logger: createLogger({ level: 'info', destination }), destination };
};

describe('platform wiring (EVM-008 AC4; SR-API-01, ADR-0013)', () => {
  it('EVM-008 AC4 last-resort handlers log without stopping on rejections and stop on uncaught exceptions', () => {
    const { logger, destination } = capture();
    const target = Object.assign(new EventEmitter(), { exit: vi.fn() });
    installProcessHandlers(target, logger);
    target.emit('unhandledRejection', new Error('synthetic rejection'));
    expect(target.exit).not.toHaveBeenCalled();
    target.emit('uncaughtException', new Error('synthetic crash'));
    expect(target.exit).toHaveBeenCalledWith(1);
    expect(destination.entries.map((entry) => [entry['level'], entry['msg']])).toEqual([
      ['error', 'unhandled promise rejection'],
      ['fatal', 'uncaught exception'],
    ]);
  });

  it('EVM-008 AC4 Nest framework messages go to the JSON logger with their context', () => {
    const { logger, destination } = capture();
    const nest = new NestLoggerAdapter(logger);
    nest.log('Nest application successfully started', 'NestApplication');
    nest.warn({ unexpected: true });
    nest.error(new Error('synthetic'), 'stack text', 'ExceptionsHandler');
    nest.debug('hidden at info');
    nest.verbose('hidden at info');
    nest.fatal('fatal message');
    expect(destination.entries.map((entry) => [entry['level'], entry['msg'], entry['context']])).toEqual([
      ['info', 'Nest application successfully started', 'NestApplication'],
      ['warn', 'nest event', undefined],
      ['error', 'nest event', 'ExceptionsHandler'],
      ['fatal', 'fatal message', undefined],
    ]);
    expect(destination.text).not.toContain('stack text');
  });

  it('EVM-008 AC4 trace identifiers are 32 random hex characters and exist only inside a request', () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/);
    expect(newTraceId()).not.toBe(newTraceId());
    expect(currentTraceId()).toBeUndefined();
    expect(requestContextMixin()).toEqual({});
  });

  it('EVM-008 AC1 the pool has short timeouts and logs idle connection errors instead of crashing', async () => {
    const { logger, destination } = capture();
    const pool = createPool({ url: UNREACHABLE_DATABASE_URL, logger });
    expect(pool.options).toMatchObject({ max: 10, connectionTimeoutMillis: 2000, statement_timeout: 2000, query_timeout: 3000 });
    pool.emit('error', new Error('synthetic idle error'), undefined);
    expect(destination.entries[0]).toMatchObject({ level: 'warn', msg: 'database pool: idle connection error' });
    await pool.end();
  });
});
