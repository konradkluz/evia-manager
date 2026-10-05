import { ForbiddenException, HttpException, HttpStatus, UnauthorizedException, type ArgumentsHost } from '@nestjs/common';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { ProblemFilter } from '../../src/platform/http/problem.filter.ts';
import { traceIdOf } from '../../src/platform/http/request-context.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { LogCapture } from '../support/app.ts';

function harness(headersSent = false) {
  const logs = new LogCapture();
  const filter = new ProblemFilter(createLogger({ level: 'info', destination: logs }), { resolve: () => null });
  const response = { headersSent, locals: { traceId: 'c'.repeat(32) }, status: vi.fn(), set: vi.fn(), send: vi.fn() };
  response.status.mockReturnValue(response);
  response.set.mockReturnValue(response);
  const host = { switchToHttp: () => ({ getRequest: () => ({}), getResponse: () => response }) } as unknown as ArgumentsHost;
  const sent = () => JSON.parse(String(response.send.mock.calls[0]?.[0])) as { code: string; status: number };
  return { filter, response, host, sent, logs };
}

const bodyParserError = (status: number) => Object.assign(new Error('request aborted'), { status, expose: true });

describe('problem filter mapping (EVM-008 AC4; SR-API-01)', () => {
  it.each([
    [new UnauthorizedException(), 'unauthenticated', 401],
    [new ForbiddenException(), 'forbidden', 403],
    [new HttpException('teapot', HttpStatus.I_AM_A_TEAPOT), 'internal_error', 500],
    [bodyParserError(400), 'malformed_json', 400],
    [bodyParserError(413), 'payload_too_large', 413],
    [bodyParserError(411), 'malformed_json', 400],
    [Object.assign(new Error('server side'), { status: 400, expose: false }), 'internal_error', 500],
    ['a thrown string', 'internal_error', 500],
  ])('EVM-008 AC4 %s → %s', (exception, code, status) => {
    const { filter, host, sent } = harness();
    filter.catch(exception, host);
    expect(sent()).toMatchObject({ code, status });
  });

  it('EVM-008 AC4 after headers were sent the error is only logged', () => {
    const { filter, host, response, logs } = harness(true);
    filter.catch(new Error('late failure'), host);
    expect(response.send).not.toHaveBeenCalled();
    expect(logs.entries[0]).toMatchObject({ level: 'error', msg: 'unhandled error', traceId: 'c'.repeat(32) });
  });

  it('EVM-008 AC4 a response outside the request context still gets a fresh trace id', () => {
    expect(traceIdOf({ locals: {} } as Response)).toMatch(/^[0-9a-f]{32}$/);
  });
});
