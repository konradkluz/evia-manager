import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { requestContext, requestEventContext } from '../../src/platform/http/request-context.ts';

const request = { ip: '203.0.113.7' } as unknown as Request;

describe('context of events raised before a handler runs (EVM-067 AC5; SR-LOG-03)', () => {
  it('EVM-067 AC5 inside a request the trace identifier is the one of the request, the origin is web and the address is kept in memory only', () => {
    let seen: ReturnType<typeof requestEventContext> | undefined;
    let traceId: unknown;
    const response = { locals: {} as Record<string, unknown> } as unknown as Response;
    requestContext(request, response, () => {
      seen = requestEventContext(request);
      traceId = response.locals['traceId'];
    });
    expect(seen).toEqual({ origin: 'web', traceId, ip: '203.0.113.7' });
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('EVM-067 AC5 outside a request scope a fresh trace identifier is made, so an event never goes without one', () => {
    const first = requestEventContext(request);
    const second = requestEventContext(request);
    expect(first.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(second.traceId).not.toBe(first.traceId);
  });
});
