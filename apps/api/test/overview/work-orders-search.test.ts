import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import { SearchWorkOrdersService } from '../../src/modules/overview/application/search-work-orders.service.ts';
import type { WorkOrderPageService } from '../../src/modules/overview/application/work-order-page.service.ts';
import {
  SEARCH_ID_LIMIT,
  resolveWorkOrderSearchQuery,
  searchFilterPartsOf,
} from '../../src/modules/overview/domain/work-order-search-query.ts';
import { filterPartsOf } from '../../src/modules/overview/domain/work-order-list-query.ts';
import { WorkOrdersSearchController } from '../../src/modules/overview/http/work-orders-search.controller.ts';
import type { BulkReadControl } from '../../src/platform/bulk-read/bulk-read-control.ts';
import type { Database } from '../../src/platform/database/database.ts';
import { resolveAuthentication } from '../../src/platform/http/principal.ts';
import { ProblemException } from '../../src/platform/http/problem.ts';
import type { RateLimiter } from '../../src/platform/http/rate-limiter.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { principal, resolverOf } from '../support/principals.ts';

const problemOf = (action: () => unknown): ProblemException => {
  try {
    action();
  } catch (error) {
    if (error instanceof ProblemException) return error;
  }
  throw new Error('expected a ProblemException');
};

describe('the body of the search of work orders (EVM-072 AC2, AC3, AC4; SR-INPUT-01, SR-INPUT-03, SR-INPUT-08)', () => {
  it('EVM-072 AC2 the phrase is normalised (NFC, white space, trimmed) and the defaults of the list apply: no view, `-number`, 25 per page', () => {
    const decomposed =
      'Gara' + String.fromCodePoint(0x7a, 0x307) + '   pe' + String.fromCodePoint(0x142) + 'ny ' + String.fromCodePoint(10);
    const query = resolveWorkOrderSearchQuery({ query: '  ' + decomposed });
    // "ż" written as "z" + combining dot is composed to one code point
    expect(query.phrase).toBe('Garaż pełny');
    expect(query.filters).toMatchObject({ statuses: [], sort: '-number', limit: 25, cursor: undefined });
  });

  it('EVM-072 AC3 the statuses are normalised (sorted, no duplicates) and "a kind of party" means waiting on a party', () => {
    const query = resolveWorkOrderSearchQuery({
      query: 'wallbox',
      status: ['quoting', 'new', 'quoting'],
      waitingOnPartyKind: 'distribution_system_operator',
      siteType: 'commercial',
      templateId: randomUUID(),
    });
    expect(query.filters).toMatchObject({
      statuses: ['new', 'quoting'],
      waitingOn: 'party',
      waitingOnPartyKind: 'distribution_system_operator',
      siteType: 'commercial',
    });
  });

  it('EVM-072 AC3 a kind of party contradicts waiting on the customer — 400 on /waitingOnPartyKind, never the value', () => {
    const problem = problemOf(() =>
      resolveWorkOrderSearchQuery({ query: 'wallbox', waitingOn: 'customer', waitingOnPartyKind: 'supplier' }),
    );
    expect(problem.code).toBe('validation_failed');
    expect(JSON.stringify(problem)).not.toContain('supplier');
  });

  it('EVM-072 AC2 the cursor of the search is bound to the filters AND the phrase, and the phrase is only part of what is hashed', () => {
    const a = resolveWorkOrderSearchQuery({ query: 'wallbox', status: ['new'] });
    const b = resolveWorkOrderSearchQuery({ query: 'wallbo', status: ['new'] });
    expect(searchFilterPartsOf(a)).toEqual([...filterPartsOf(a.filters), 'wallbox']);
    expect(searchFilterPartsOf(a)).not.toEqual(searchFilterPartsOf(b));
  });

  it('EVM-072 AC2 a phrase with a NUL, a control or an invisible character is invalid_characters BEFORE any query', () => {
    for (const code of [0x0, 0x1, 0x200b]) {
      const query = 'abc' + String.fromCodePoint(code) + 'def';
      expect(problemOf(() => resolveWorkOrderSearchQuery({ query })).extras.errors, JSON.stringify(query)).toEqual([
        { pointer: '/query', code: 'invalid_characters' },
      ]);
    }
  });

  it('EVM-072 AC2 the length of the phrase is counted in code points: 3 emoji are enough, 101 are too long', () => {
    expect(resolveWorkOrderSearchQuery({ query: '\u{1F697}\u{1F697}\u{1F697}' }).phrase).toHaveLength(6);
    expect(problemOf(() => resolveWorkOrderSearchQuery({ query: '\u{1F697}'.repeat(101) })).extras.errors).toEqual([
      { pointer: '/query', code: 'too_long' },
    ]);
  });
});

const PAGE = { items: [], nextCursor: null };

function service(options: { allowed?: boolean; orders?: string[]; customers?: string[]; sites?: string[] } = {}) {
  const calls: string[] = [];
  const track = <T>(name: string, value: T) =>
    vi.fn(() => {
      calls.push(name);
      return Promise.resolve(value);
    });
  const searchIds = {
    orders: track('orders', options.orders ?? []),
    customers: track('customers', options.customers ?? []),
    sites: track('sites', options.sites ?? []),
  };
  const limiter = {
    consumeSubject: vi.fn(() => {
      calls.push('limiter');
      return options.allowed === false ? { allowed: false, retryAfterSeconds: 42 } : { allowed: true };
    }),
  } as unknown as RateLimiter;
  const bulkRead = { before: track('before', undefined) } as unknown as BulkReadControl;
  const page = track('page', PAGE);
  const pages = {
    scope: vi.fn(() => {
      calls.push('scope');
      return 'scope';
    }),
    start: vi.fn(() => {
      calls.push('start');
      return { today: '2026-10-13', position: undefined };
    }),
    authorize: vi.fn(() => {
      calls.push('authorize');
    }),
    page,
  } as unknown as WorkOrderPageService;
  const metrics = new MetricsRegistry();
  const instance = new SearchWorkOrdersService(
    {} as Kysely<Database>,
    pages,
    limiter,
    bulkRead,
    { searchIds: searchIds.orders } as never,
    { searchIds: searchIds.customers } as never,
    { searchIds: searchIds.sites } as never,
    metrics,
  );
  return { instance, calls, searchIds, page, metrics };
}
const user = principal({ role: 'editor' });
const context = { origin: 'web' as const, traceId: '0'.repeat(32) };
const ids = (count: number): string[] => Array.from({ length: count }, () => randomUUID());

describe('the service of the search of work orders (EVM-072 AC2, AC5; SR-API-02, ADR-0017 W6)', () => {
  it('EVM-072 AC5 EVM-056 AC7 the order is: limiter, cursor, the payment rule (W4), meter, the three modules, the page — and the three sets reach the page as they are', async () => {
    const { instance, calls, page } = service({ orders: ids(1), customers: ids(2), sites: ids(3) });
    await expect(instance.search(user, { query: 'wallbox' }, context)).resolves.toEqual(PAGE);
    expect(calls).toEqual(['limiter', 'scope', 'start', 'authorize', 'before', 'orders', 'customers', 'sites', 'page']);
    const request = (page.mock.calls[0] as unknown[] | undefined)?.[1] as {
      operation: string;
      narrowing: { workOrders: string[]; customers: string[]; sites: string[] };
    };
    expect(request.operation).toBe('searchWorkOrders');
    expect(request.narrowing.workOrders).toHaveLength(1);
    expect(request.narrowing.customers).toHaveLength(2);
    expect(request.narrowing.sites).toHaveLength(3);
  });

  it('EVM-072 AC6 each module is asked for one more than the limit; more than 10 000 from ANY of them is 400 too_broad before the page is read', async () => {
    const tooMany = ids(SEARCH_ID_LIMIT + 1);
    for (const which of ['orders', 'customers', 'sites'] as const) {
      const { instance, searchIds, page } = service({ [which]: tooMany });
      const error = await instance.search(user, { query: 'wallbox' }, context).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(ProblemException);
      expect((error as ProblemException).extras.errors, which).toEqual([{ pointer: '/query', code: 'too_broad' }]);
      expect(searchIds[which]).toHaveBeenCalledWith(expect.anything(), user, 'wallbox', SEARCH_ID_LIMIT + 1);
      expect(page).not.toHaveBeenCalled();
    }
    // exactly the limit is still served
    const { instance, page } = service({ orders: ids(SEARCH_ID_LIMIT) });
    await instance.search(user, { query: 'wallbox' }, context);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it('EVM-072 AC5 a phrase too broad in the orders ends the work: the customers and the sites are not asked', async () => {
    const { instance, searchIds } = service({ orders: ids(SEARCH_ID_LIMIT + 1) });
    await instance.search(user, { query: 'wallbox' }, context).catch(() => undefined);
    expect(searchIds.customers).not.toHaveBeenCalled();
    expect(searchIds.sites).not.toHaveBeenCalled();
  });

  it('EVM-072 AC5 the limiter is asked first and a refusal is 429 with Retry-After and the metric without a label — no validation, no meter, no module', async () => {
    const { instance, calls, metrics } = service({ allowed: false });
    const error = await instance.search(user, { query: 'x' }, context).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ProblemException);
    expect(calls).toEqual(['limiter']);
    const sample = metrics.snapshot().find((entry) => entry.name === 'work_order_search_rate_limited');
    expect(sample).toMatchObject({ value: 1, labels: {} });
  });

  it('EVM-056 AC7 T3 the field `payment` in the body of a search is read_only_field (a field of the server), a stranger stays unknown_field', () => {
    const problem = problemOf(() => resolveWorkOrderSearchQuery({ query: 'wallbox', payment: { state: 'paid' }, color: 'red' }));
    expect(problem.code).toBe('validation_failed');
    expect(problem.extras.errors).toEqual([
      { pointer: '/payment', code: 'read_only_field' },
      { pointer: '/color', code: 'unknown_field' },
    ]);
  });

  it('EVM-056 AC3 K5 the descending "-urgency" and a view outside the list are 400 without an echo of the value', () => {
    for (const body of [{ sort: '-urgency' }, { view: 'overdue' }, { sort: 'Urgency' }]) {
      const problem = problemOf(() => resolveWorkOrderSearchQuery({ query: 'wallbox', ...body }));
      expect(problem.code, JSON.stringify(body)).toBe('validation_failed');
      expect(JSON.stringify(problem.extras), JSON.stringify(body)).not.toMatch(/urgency|Urgency|overdue/);
    }
  });

  it('EVM-072 AC2 an invalid body is 400 before the cursor, the meter and the modules', async () => {
    const { instance, calls } = service();
    await expect(instance.search(user, { query: 'ab' }, context)).rejects.toBeInstanceOf(ProblemException);
    expect(calls).toEqual(['limiter']);
  });
});

async function signedIn(): Promise<Request> {
  const request = { ip: '203.0.113.9' } as unknown as Request;
  await new Promise<void>((resolve) => {
    resolveAuthentication(resolverOf({ principal: principal({ role: 'read_only' }) }), createLogger({ level: 'fatal' }))(
      request,
      {} as Response,
      () => {
        resolve();
      },
    );
  });
  return request;
}

describe('the controller of the search of work orders (EVM-072 AC7; SR-AUTHZ-01)', () => {
  it('EVM-072 AC7 the search passes the principal of the session, the raw body and the context of the request, and returns the answer', async () => {
    const search = vi.fn(() => Promise.resolve(PAGE));
    const controller = new WorkOrdersSearchController({ search } as unknown as SearchWorkOrdersService);
    const response = { locals: { traceId: '0'.repeat(32) } } as unknown as Response;
    await expect(controller.searchWorkOrders({ query: 'wallbox' }, await signedIn(), response)).resolves.toEqual(PAGE);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'read_only' }),
      { query: 'wallbox' },
      expect.objectContaining({ origin: 'web' }),
    );
  });

  it('EVM-072 AC7 a request without a principal is 401 unauthenticated and the use case is not reached', () => {
    const search = vi.fn();
    const controller = new WorkOrdersSearchController({ search } as unknown as SearchWorkOrdersService);
    expect(() => controller.searchWorkOrders({ query: 'wallbox' }, { ip: '203.0.113.9' } as unknown as Request, {} as Response)).toThrow(
      ProblemException,
    );
    expect(search).not.toHaveBeenCalled();
  });
});
