import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ListWorkOrdersService } from '../../src/modules/overview/application/list-work-orders.service.ts';
import { WorkOrderPageService } from '../../src/modules/overview/application/work-order-page.service.ts';
import {
  filterPartsOf,
  resolveWorkOrderListQuery,
  type WorkOrderListQuery,
} from '../../src/modules/overview/domain/work-order-list-query.ts';
import { readWorkOrderPage, type WorkOrderRow } from '../../src/modules/overview/infrastructure/work-order-list-reader.ts';
import { PaymentTotalsDirectoryService } from '../../src/modules/payments/application/payment-totals.service.ts';
import type { PaymentTotalsDirectory } from '../../src/modules/payments/payment-totals.ts';
import type { BulkReadControl } from '../../src/platform/bulk-read/bulk-read-control.ts';
import { CursorCodec } from '../../src/platform/crypto/opaque-cursor.ts';
import type { Database } from '../../src/platform/database/database.ts';
import { ProblemException } from '../../src/platform/http/problem.ts';
import { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { FixedClock } from '../support/clock.ts';
import { principal } from '../support/principals.ts';

// The reader is replaced: these tests are about what the SERVICE does with the right to read payments (W4), not about SQL.
vi.mock('../../src/modules/overview/infrastructure/work-order-list-reader.ts', () => ({ readWorkOrderPage: vi.fn() }));
const reader = vi.mocked(readWorkOrderPage);

const TODAY = '2026-10-08';
const user = principal({ role: 'editor' });
const context = { origin: 'web' as const, traceId: '0'.repeat(32) };
const query = (raw: Record<string, string>): WorkOrderListQuery => resolveWorkOrderListQuery.parse(raw);

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

function pages(options: { canReadPayments: boolean; hidden?: readonly string[] }) {
  const calls: string[] = [];
  const bulkRead = {
    before: vi.fn(() => {
      calls.push('before');
      return Promise.resolve();
    }),
    after: vi.fn(),
    afterDistinct: vi.fn(() => Promise.resolve()),
  } as unknown as BulkReadControl;
  const titlesOf = vi.fn((_db: unknown, _principal: unknown, ids: readonly string[]) =>
    Promise.resolve(new Map(ids.filter((id) => !(options.hidden ?? []).includes(id)).map((id) => [id, 'Tytuł syntetyczny']))),
  );
  const empty = () => Promise.resolve(new Map());
  const paymentTotalsOf = vi.fn<PaymentTotalsDirectory['paymentTotalsOf']>((_db, _principal, ids) =>
    Promise.resolve(new Map(ids.map((id) => [id, { invoicedMinor: 450_000, overdueMinor: 360_000 }]))),
  );
  const service = new WorkOrderPageService(
    {} as Kysely<Database>,
    new CursorCodec(Buffer.alloc(32, 7), new FixedClock(`${TODAY}T08:00:00.000Z`)),
    bulkRead,
    { displayNamesOf: empty } as never,
    { titlesOf } as never,
    { namesOf: empty, kindsOf: empty },
    { displayNamesOf: empty } as never,
    { linesOf: empty } as never,
    { paymentTotalsOf },
    () => options.canReadPayments,
    new FixedClock(`${TODAY}T08:00:00.000Z`),
    new MetricsRegistry(),
  );
  return { service, calls, bulkRead, paymentTotalsOf };
}

beforeEach(() => {
  reader.mockReset();
});

describe('W4 in code — a role without the right to read payments (EVM-056 AC7; ADR-0017 W4; CWE-203, ASVS V8.2.3)', () => {
  it('EVM-056 AC7 a payment view is 403 forbidden without an echo of the value, after the validation and before the meter and the query (list)', async () => {
    for (const view of ['overdue_payments', 'unpaid']) {
      const { service, calls } = pages({ canReadPayments: false });
      const list = new ListWorkOrdersService(service, { before: () => calls.push('before') } as unknown as BulkReadControl);
      const error = await list.list(user, { view }, context).catch((reason: unknown) => reason);
      expect(error, view).toBeInstanceOf(ProblemException);
      expect((error as ProblemException).code, view).toBe('forbidden');
      expect(JSON.stringify((error as ProblemException).extras), view).not.toContain(view);
      expect(calls, view).toEqual([]);
      expect(reader, view).not.toHaveBeenCalled();
    }
  });

  it('EVM-056 AC7 the same rule refuses the payment views of a search (the page service decides for both operations)', () => {
    const { service } = pages({ canReadPayments: false });
    for (const view of ['overdue_payments', 'unpaid'] as const) {
      expect(() => {
        service.authorize(user, { ...query({}), view });
      }, view).toThrow(ProblemException);
    }
    for (const view of [undefined, 'all_open', 'mine', 'waiting_on_dso_over_14_days'] as const) {
      expect(() => {
        service.authorize(user, { ...query({}), view });
      }, String(view)).not.toThrow();
    }
    // with the right nothing is refused
    expect(() => {
      pages({ canReadPayments: true }).service.authorize(user, query({ view: 'unpaid' }));
    }).not.toThrow();
  });

  it('EVM-056 AC7 "Najpilniejsze" is never refused: without the right the reader gets the variant without payments, and the items have no field `payment`', async () => {
    const { service, paymentTotalsOf } = pages({ canReadPayments: false });
    reader.mockResolvedValue([row({ invoicedCount: 1, earliestInvoicedDueDate: '2026-10-01', urgency: { group: 4, day: 'infinity' } })]);
    const list = new ListWorkOrdersService(service, { before: () => Promise.resolve() } as unknown as BulkReadControl);
    const page = await list.list(user, { sort: 'urgency' }, context);
    expect(reader.mock.calls[0]?.[4]).toEqual({ today: TODAY, withPayments: false });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).not.toHaveProperty('payment');
    expect(paymentTotalsOf).not.toHaveBeenCalled();
  });

  it('EVM-056 AC7 W8 the variant is part of the scope of the cursor: a cursor of one variant never positions a page of the other', () => {
    const parts = filterPartsOf(query({ sort: 'urgency' }));
    const without = pages({ canReadPayments: false }).service.scope(user, parts);
    const withPayments = pages({ canReadPayments: true }).service.scope(user, parts);
    expect(without).not.toBe(withPayments);
  });

  it('EVM-056 AC7 K3 the facade of the totals is fail-closed: without the right it answers an empty map and never reads', async () => {
    const db = new Proxy(
      {},
      {
        get: () => {
          throw new Error('the database must not be read');
        },
      },
    ) as Kysely<Database>;
    const totals = new PaymentTotalsDirectoryService(() => false);
    await expect(totals.paymentTotalsOf(db, user, [randomUUID()], TODAY)).resolves.toEqual(new Map());
    const allowed = new PaymentTotalsDirectoryService(() => true);
    await expect(allowed.paymentTotalsOf(db, user, [], TODAY)).resolves.toEqual(new Map());
    // more identifiers than a page holds is a defect of the caller, never a large query
    const tooMany = Array.from({ length: 101 }, () => randomUUID());
    await expect(allowed.paymentTotalsOf(db, user, tooMany, TODAY)).rejects.toThrow(/page/);
  });
});

describe('the field `payment` for a role that may read payments (EVM-056 AC1; ADR-0017 D8, W2)', () => {
  it('EVM-056 AC1 the state comes from the projection and the day of the page, the totals from ONE batch of the facade with the same day', async () => {
    const { service, paymentTotalsOf } = pages({ canReadPayments: true });
    const overdue = row({ invoicedCount: 1, earliestInvoicedDueDate: '2026-10-07' });
    const paid = row({ paidCount: 2 });
    const nothing = row();
    reader.mockResolvedValue([overdue, paid, nothing]);
    const list = new ListWorkOrdersService(service, { before: () => Promise.resolve() } as unknown as BulkReadControl);
    const page = await list.list(user, {}, context);
    expect(reader.mock.calls[0]?.[4]).toEqual({ today: TODAY, withPayments: true });
    expect(page.items.map((item) => item.payment)).toEqual([
      {
        state: 'overdue',
        invoicedCount: 1,
        invoicedTotal: { amountMinor: 450_000, currency: 'PLN' },
        overdueTotal: { amountMinor: 360_000, currency: 'PLN' },
      },
      {
        state: 'paid',
        invoicedCount: 0,
        invoicedTotal: { amountMinor: 0, currency: 'PLN' },
        overdueTotal: { amountMinor: 0, currency: 'PLN' },
      },
      {
        state: 'none',
        invoicedCount: 0,
        invoicedTotal: { amountMinor: 0, currency: 'PLN' },
        overdueTotal: { amountMinor: 0, currency: 'PLN' },
      },
    ]);
    // only the orders with an issued milestone are asked for, in one call, with the day of the page
    expect(paymentTotalsOf).toHaveBeenCalledTimes(1);
    expect(paymentTotalsOf.mock.calls[0]?.[2]).toEqual([overdue.id]);
    expect(paymentTotalsOf.mock.calls[0]?.[3]).toBe(TODAY);
  });

  it('EVM-056 AC6 K3 the totals are asked for the orders that passed the batch of titles only — a row the fail-closed batch dropped gets nothing', async () => {
    const shown = row({ invoicedCount: 1, earliestInvoicedDueDate: '2026-10-20' });
    const dropped = row({ invoicedCount: 1, earliestInvoicedDueDate: '2026-10-01' });
    const { service, paymentTotalsOf } = pages({ canReadPayments: true, hidden: [dropped.id] });
    reader.mockResolvedValue([shown, dropped]);
    const list = new ListWorkOrdersService(service, { before: () => Promise.resolve() } as unknown as BulkReadControl);
    const page = await list.list(user, {}, context);
    expect(page.items.map((item) => item.id)).toEqual([shown.id]);
    expect(paymentTotalsOf.mock.calls[0]?.[2]).toEqual([shown.id]);
  });

  it('EVM-056 AC6 no batch of payments when no order of the page has an issued milestone (the count of statements of EVM-034 stays)', async () => {
    const { service, paymentTotalsOf } = pages({ canReadPayments: true });
    reader.mockResolvedValue([row({ paidCount: 1 }), row()]);
    const list = new ListWorkOrdersService(service, { before: () => Promise.resolve() } as unknown as BulkReadControl);
    const page = await list.list(user, {}, context);
    expect(page.items.map((item) => item.payment?.state)).toEqual(['paid', 'none']);
    expect(paymentTotalsOf).not.toHaveBeenCalled();
  });
});
