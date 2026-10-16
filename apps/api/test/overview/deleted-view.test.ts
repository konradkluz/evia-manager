import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ListWorkOrdersService } from '../../src/modules/overview/application/list-work-orders.service.ts';
import { WorkOrderPageService } from '../../src/modules/overview/application/work-order-page.service.ts';
import { resolveWorkOrderListQuery } from '../../src/modules/overview/domain/work-order-list-query.ts';
import { resolveWorkOrderSearchQuery } from '../../src/modules/overview/domain/work-order-search-query.ts';
import { readWorkOrderPage, type WorkOrderRow } from '../../src/modules/overview/infrastructure/work-order-list-reader.ts';
import type { PaymentTotalsDirectory } from '../../src/modules/payments/payment-totals.ts';
import type { BulkReadControl } from '../../src/platform/bulk-read/bulk-read-control.ts';
import { CursorCodec } from '../../src/platform/crypto/opaque-cursor.ts';
import type { Database } from '../../src/platform/database/database.ts';
import { ProblemException } from '../../src/platform/http/problem.ts';
import { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { FixedClock } from '../support/clock.ts';
import { principal } from '../support/principals.ts';

// The reader is replaced: these tests are about what the SERVICE does with the view "Usunięte" (EVM-060), not about SQL.
vi.mock('../../src/modules/overview/infrastructure/work-order-list-reader.ts', () => ({ readWorkOrderPage: vi.fn() }));
const reader = vi.mocked(readWorkOrderPage);

const TODAY = '2026-10-16';
const context = { origin: 'web' as const, traceId: '0'.repeat(32) };
const DELETED_AT = new Date('2026-10-15T09:30:00.000Z');

function row(overrides: Partial<WorkOrderRow> = {}): WorkOrderRow {
  return {
    id: randomUUID(),
    number: 'ZL-2026-0001',
    status: 'in_progress',
    createdAt: new Date('2026-10-01T08:00:00.000Z'),
    deletedAt: null,
    coordinatorUserId: null,
    customerId: null,
    siteId: null,
    waitingCount: 0,
    longestWaitingSince: null,
    longestWaitingOn: null,
    longestWaitingPartyId: null,
    nextDueDate: null,
    invoicedCount: 0,
    paidCount: 0,
    earliestInvoicedDueDate: null,
    ...overrides,
  };
}

function pages(options: { hidden?: readonly string[] } = {}) {
  const calls: string[] = [];
  const after = vi.fn();
  const afterDistinct = vi.fn(() => Promise.resolve());
  const bulkRead = {
    before: vi.fn(() => {
      calls.push('before');
      return Promise.resolve();
    }),
    after,
    afterDistinct,
  } as unknown as BulkReadControl;
  const shown = (ids: readonly string[]) => ids.filter((id) => !(options.hidden ?? []).includes(id));
  const titlesOf = vi.fn((_db: unknown, _principal: unknown, ids: readonly string[]) =>
    Promise.resolve(new Map(shown(ids).map((id) => [id, 'Tytuł syntetyczny']))),
  );
  const deletedRefsOf = vi.fn((_db: unknown, _principal: unknown, ids: readonly string[]) =>
    Promise.resolve(new Map(shown(ids).map((id) => [id, { title: 'Tytuł usuniętego', version: 4 }]))),
  );
  const empty = () => Promise.resolve(new Map());
  const paymentTotalsOf = vi.fn<PaymentTotalsDirectory['paymentTotalsOf']>(() => Promise.resolve(new Map()));
  const service = new WorkOrderPageService(
    {} as Kysely<Database>,
    new CursorCodec(Buffer.alloc(32, 7), new FixedClock(`${TODAY}T08:00:00.000Z`)),
    bulkRead,
    { displayNamesOf: empty } as never,
    { titlesOf, deletedRefsOf } as never,
    { namesOf: empty, kindsOf: empty },
    { displayNamesOf: empty } as never,
    { linesOf: empty } as never,
    { paymentTotalsOf },
    () => true,
    new FixedClock(`${TODAY}T08:00:00.000Z`),
    new MetricsRegistry(),
  );
  return { service, calls, after, afterDistinct, titlesOf, deletedRefsOf, paymentTotalsOf };
}

beforeEach(() => {
  reader.mockReset();
});

describe('the view "Usunięte" in code (EVM-060 AC4; ADR-0017; SR-AUTHZ-02, SR-API-02; ASVS V8.2.2, V2.4.1)', () => {
  it('EVM-060 AC4 the Editor and Read-only are 403 forbidden — after the validation, before the meter of mass reading, the query and the facades', async () => {
    for (const role of ['editor', 'read_only'] as const) {
      const { service, calls, titlesOf, deletedRefsOf } = pages();
      const list = new ListWorkOrdersService(service, { before: () => calls.push('before') } as unknown as BulkReadControl);
      const error = await list.list(principal({ role }), { view: 'deleted' }, context).catch((reason: unknown) => reason);
      expect(error, role).toBeInstanceOf(ProblemException);
      expect((error as ProblemException).code, role).toBe('forbidden');
      expect(calls, role).toEqual([]);
      expect(reader, role).not.toHaveBeenCalled();
      expect(titlesOf).not.toHaveBeenCalled();
      expect(deletedRefsOf).not.toHaveBeenCalled();
    }
  });

  it('EVM-060 AC4 a malformed query is 400 before anything else (the validation comes first for every role)', async () => {
    const { service } = pages();
    const list = new ListWorkOrdersService(service, { before: () => Promise.resolve() } as unknown as BulkReadControl);
    const error = await list
      .list(principal({ role: 'editor' }), { view: 'deleted', limit: '0' }, context)
      .catch((reason: unknown) => reason);
    expect((error as ProblemException).code).toBe('validation_failed');
  });

  it('EVM-060 AC4 the Administrator: the meter of mass reading is asked and counts the records, the titles come from the mode "deleted" of the facade, the item has deletedAt and version and no column of payments', async () => {
    const { service, calls, after, afterDistinct, titlesOf, deletedRefsOf, paymentTotalsOf } = pages();
    reader.mockResolvedValue([row({ deletedAt: DELETED_AT, invoicedCount: 1 })]);
    const list = new ListWorkOrdersService(service, {
      before: () => {
        calls.push('before');
        return Promise.resolve();
      },
    } as unknown as BulkReadControl);
    const page = await list.list(principal({ role: 'administrator' }), { view: 'deleted' }, context);
    expect(calls).toEqual(['before']);
    expect(reader.mock.calls[0]?.[2]).toMatchObject({ view: 'deleted' });
    expect(deletedRefsOf).toHaveBeenCalledOnce();
    expect(titlesOf).not.toHaveBeenCalled();
    expect(paymentTotalsOf).not.toHaveBeenCalled();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ title: 'Tytuł usuniętego', deletedAt: DELETED_AT.toISOString(), version: 4 });
    expect(page.items[0]).not.toHaveProperty('payment');
    expect(after).toHaveBeenCalledWith(expect.any(String), 1);
    expect(afterDistinct).toHaveBeenCalledOnce();
  });

  it('EVM-060 AC4 every other view reads the titles from the mode "visible" and its items carry neither deletedAt nor version', async () => {
    const { service, titlesOf, deletedRefsOf } = pages();
    reader.mockResolvedValue([row()]);
    const list = new ListWorkOrdersService(service, { before: () => Promise.resolve() } as unknown as BulkReadControl);
    const page = await list.list(principal({ role: 'administrator' }), { view: 'all_open' }, context);
    expect(titlesOf).toHaveBeenCalledOnce();
    expect(deletedRefsOf).not.toHaveBeenCalled();
    expect(page.items[0]).not.toHaveProperty('deletedAt');
    expect(page.items[0]).not.toHaveProperty('version');
  });

  it('EVM-060 AC4 fail closed: a row of the view that the facade does not return is dropped, never shown with a guessed title', async () => {
    const hidden = row({ deletedAt: DELETED_AT });
    const { service } = pages({ hidden: [hidden.id] });
    reader.mockResolvedValue([hidden, row({ deletedAt: DELETED_AT })]);
    const list = new ListWorkOrdersService(service, { before: () => Promise.resolve() } as unknown as BulkReadControl);
    const page = await list.list(principal({ role: 'administrator' }), { view: 'deleted' }, context);
    expect(page.items.map((item) => item.id)).not.toContain(hidden.id);
    expect(page.items).toHaveLength(1);
  });

  it('EVM-060 AC4 the cursor is bound to the view: the filters of the list name it', () => {
    const { service } = pages();
    const user = principal({ role: 'administrator' });
    const deleted = service.scope(user, ['view:deleted']);
    expect(deleted).not.toBe(service.scope(user, ['view:all_open']));
  });

  it('EVM-060 AC4 a search never takes the view: view=deleted in its body is 400 validation_failed on /view, with no echo of the value', () => {
    let error: unknown;
    try {
      resolveWorkOrderSearchQuery({ query: 'wallbox', view: 'deleted' });
    } catch (reason) {
      error = reason;
    }
    expect(error).toBeInstanceOf(ProblemException);
    expect((error as ProblemException).code).toBe('validation_failed');
    expect((error as ProblemException).extras.errors?.map((item) => item.pointer)).toEqual(['/view']);
    expect(JSON.stringify((error as ProblemException).extras)).not.toContain('deleted');
    expect(() => resolveWorkOrderSearchQuery({ query: 'wallbox', view: 'all_open' })).not.toThrow();
  });

  it('EVM-060 AC4 the list accepts the view as a value of the contract (and nothing else is added to the query)', () => {
    expect(resolveWorkOrderListQuery.parse({ view: 'deleted' }).view).toBe('deleted');
    expect(() => resolveWorkOrderListQuery.parse({ view: 'removed' })).toThrow();
  });
});
