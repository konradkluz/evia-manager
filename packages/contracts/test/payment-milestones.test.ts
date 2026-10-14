import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundleContract } from '../src/redocly.ts';
import { AUTHZ_MANIFEST } from '../src/authz.ts';
import {
  zAuditEvent,
  zAuditEventList,
  zCreatePaymentMilestoneHeaders,
  zMoney,
  zPaymentMilestone,
  zPaymentMilestoneCreate,
  zPaymentMilestoneList,
  zPaymentMilestonePatch,
  zUpdatePaymentMilestoneHeaders,
  zListUnpaidPaymentMilestonesQuery,
  zUnpaidPaymentMilestoneList,
  zUpdatePaymentMilestonePath,
} from '../src/zod.ts';

const V7 = '0198b0a0-0000-7000-8000-000000000001';
const milestone = {
  id: V7,
  code: 'advance',
  name: 'Zaliczka',
  position: 1,
  sharePercent: 20,
  paymentTermDays: 7,
  amount: { amountMinor: 360000, currency: 'PLN' },
  status: 'planned',
  invoiceNumber: null,
  invoicedOn: null,
  dueDate: null,
  paidOn: null,
  isOverdue: false,
  version: 1,
  allowedTransitions: ['invoiced', 'cancelled'],
};
const zero = { amountMinor: 0, currency: 'PLN' };

describe('payments contract (EVM-053; SR-AUTHZ-01, SR-AUTHZ-04, SR-AUTHZ-12, SR-INPUT-01, SR-API-07)', () => {
  it('EVM-053 AC7 the list is open to the three roles, the creation and the change of the amount to Administrator and Editor with audit — every operation on the web channel only (P3)', () => {
    expect(AUTHZ_MANIFEST['listPaymentMilestones']).toMatchObject({
      method: 'get',
      path: '/api/v1/work-orders/{workOrderId}/payment-milestones',
      authz: { roles: ['administrator', 'editor', 'read_only'], channels: ['web'] },
    });
    expect(AUTHZ_MANIFEST['createPaymentMilestone']).toMatchObject({
      method: 'post',
      path: '/api/v1/work-orders/{workOrderId}/payment-milestones',
      authz: { roles: ['administrator', 'editor'], channels: ['web'], audit: true },
    });
    expect(AUTHZ_MANIFEST['updatePaymentMilestone']).toMatchObject({
      method: 'patch',
      path: '/api/v1/work-orders/{workOrderId}/payment-milestones/{milestoneId}',
      authz: { roles: ['administrator', 'editor'], channels: ['web'], audit: true },
    });
  });

  it('EVM-053 AC7 EVM-054 AC8 a milestone is addressed by the order AND the milestone in the path — there is no operation with the milestone alone', () => {
    const paths = Object.values(AUTHZ_MANIFEST).map((operation) => operation.path);
    expect([...new Set(paths.filter((path) => path.includes('{milestoneId}')))].sort()).toEqual([
      '/api/v1/work-orders/{workOrderId}/payment-milestones/{milestoneId}',
      '/api/v1/work-orders/{workOrderId}/payment-milestones/{milestoneId}/transitions',
    ]);
    expect(zUpdatePaymentMilestonePath.safeParse({ workOrderId: V7, milestoneId: V7 }).success).toBe(true);
    expect(zUpdatePaymentMilestonePath.safeParse({ workOrderId: V7, milestoneId: 'x' }).success).toBe(false);
  });

  it('EVM-053 AC3 Money is an integer number of grosze in PLN: a fraction of a grosz, zero, a negative amount, a string, another currency and an unknown key are refused', () => {
    expect(zMoney.safeParse({ amountMinor: 360000, currency: 'PLN' }).success).toBe(true);
    expect(zMoney.safeParse({ amountMinor: 99_999_999_999, currency: 'PLN' }).success).toBe(true);
    expect(zMoney.safeParse({ amountMinor: 100_000_000_000, currency: 'PLN' }).success).toBe(false);
    expect(zMoney.safeParse({ amountMinor: 360000.5, currency: 'PLN' }).success).toBe(false);
    expect(zMoney.safeParse(zero).success).toBe(false);
    expect(zMoney.safeParse({ amountMinor: -1, currency: 'PLN' }).success).toBe(false);
    expect(zMoney.safeParse({ amountMinor: '360000', currency: 'PLN' }).success).toBe(false);
    expect(zMoney.safeParse({ amountMinor: 360000, currency: 'EUR' }).success).toBe(false);
    expect(zMoney.safeParse({ amountMinor: 360000 }).success).toBe(false);
  });

  it('EVM-053 AC3 EVM-054 AC4 the change needs If-Match as a strong tag and takes an optional UUIDv7 Idempotency-Key; the patch is the amount, the data of the invoice and the day of the payment — never the status', () => {
    expect(zUpdatePaymentMilestoneHeaders.safeParse({ 'If-Match': '"3"' }).success).toBe(true);
    expect(zUpdatePaymentMilestoneHeaders.safeParse({ 'If-Match': '"3"', 'Idempotency-Key': V7 }).success).toBe(true);
    expect(zUpdatePaymentMilestoneHeaders.safeParse({}).success).toBe(false);
    expect(zUpdatePaymentMilestoneHeaders.safeParse({ 'If-Match': 'W/"3"' }).success).toBe(false);
    expect(Object.keys(zPaymentMilestonePatch.shape)).toEqual(['amount', 'invoiceNumber', 'invoicedOn', 'dueDate', 'paidOn']);
    expect(zPaymentMilestonePatch.safeParse({ amount: null }).success).toBe(false);
    expect(zPaymentMilestonePatch.safeParse({ invoiceNumber: null }).success).toBe(false);
  });

  it('EVM-053 AC4 the creation needs a UUIDv7 Idempotency-Key, a UUIDv7 id and a name of 1–120 characters; the amount is optional; the fields of the server are not part of it', () => {
    expect(zCreatePaymentMilestoneHeaders.safeParse({ 'Idempotency-Key': V7 }).success).toBe(true);
    expect(zCreatePaymentMilestoneHeaders.safeParse({}).success).toBe(false);
    expect(zPaymentMilestoneCreate.safeParse({ id: V7, name: 'Zaliczka' }).success).toBe(true);
    expect(zPaymentMilestoneCreate.safeParse({ id: V7, name: 'Zaliczka', amount: { amountMinor: 1, currency: 'PLN' } }).success).toBe(true);
    expect(zPaymentMilestoneCreate.safeParse({ id: V7, name: '' }).success).toBe(false);
    expect(zPaymentMilestoneCreate.safeParse({ id: V7, name: 'x'.repeat(121) }).success).toBe(false);
    expect(zPaymentMilestoneCreate.safeParse({ id: '0198b0a0-0000-4000-8000-000000000001', name: 'Zaliczka' }).success).toBe(false);
    for (const field of ['status', 'sharePercent', 'paymentTermDays', 'code', 'position', 'version', 'invoiceNumber', 'isOverdue']) {
      expect(Object.keys(zPaymentMilestoneCreate.shape), field).not.toContain(field);
      expect(Object.keys(zPaymentMilestone.shape), field).toContain(field);
    }
  });

  it('EVM-053 AC2 the list has at most 20 milestones and the totals unpaid and paid (zero allowed); a milestone without an amount is planned', () => {
    const totals = { unpaid: zero, paid: { amountMinor: 360000, currency: 'PLN' } };
    expect(zPaymentMilestoneList.safeParse({ items: [milestone, { ...milestone, amount: null }], totals }).success).toBe(true);
    expect(zPaymentMilestoneList.safeParse({ items: Array.from({ length: 21 }, () => milestone), totals }).success).toBe(false);
    expect(zPaymentMilestoneList.safeParse({ items: [], totals: { unpaid: zero } }).success).toBe(false);
    expect(zPaymentMilestone.safeParse({ ...milestone, code: null, sharePercent: null, paymentTermDays: null }).success).toBe(true);
    expect(zPaymentMilestone.safeParse({ ...milestone, status: 'overdue' }).success).toBe(false);
  });

  it('EVM-053 AC3 the audit event carries the amount before and after (the exception of payments), optional and nullable — an earlier event without them stays valid', () => {
    const event = {
      id: V7,
      occurredAt: '2026-10-13T08:00:00.000Z',
      actor: null,
      action: 'payment_milestone.amount_changed',
      outcome: 'success',
      reasonCode: null,
      objectType: 'payment_milestone',
      objectId: V7,
      ipPrefix: null,
    };
    expect(zAuditEvent.safeParse(event).success).toBe(true);
    expect(zAuditEvent.safeParse({ ...event, amountBefore: null, amountAfter: { amountMinor: 360000, currency: 'PLN' } }).success).toBe(
      true,
    );
    expect(zAuditEventList.safeParse({ items: [{ ...event, action: 'payment_milestone.cancelled' }], nextCursor: null }).success).toBe(
      true,
    );
    expect(zAuditEvent.safeParse({ ...event, action: 'payment_milestone.deleted' }).success).toBe(false);
  });

  it('EVM-053 P3 SR-AUTHZ-12 no operation open to the mobile channel can answer with a payment milestone or an amount (payments never reach the phone)', () => {
    const output = join(mkdtempSync(join(tmpdir(), 'evia-contracts-')), 'openapi.json');
    expect(bundleContract(output).status).toBe(0);
    const bundle = JSON.parse(readFileSync(output, 'utf8')) as {
      paths: Record<string, Record<string, { 'x-evia-authz'?: { channels?: string[] }; responses?: unknown }>>;
      components: { schemas: Record<string, unknown> };
    };
    const refsOf = (node: unknown): string[] => {
      const text = JSON.stringify(node);
      return [...text.matchAll(/"#\/components\/schemas\/([A-Za-z0-9]+)"/g)].map((match) => match[1] ?? '');
    };
    const reachable = (node: unknown): Set<string> => {
      const seen = new Set<string>();
      const queue = refsOf(node);
      while (queue.length > 0) {
        const name = queue.pop() ?? '';
        if (seen.has(name)) continue;
        seen.add(name);
        queue.push(...refsOf(bundle.components.schemas[name]));
      }
      return seen;
    };
    const mobile = Object.values(bundle.paths).flatMap((item) =>
      Object.values(item).filter((operation) => operation['x-evia-authz']?.channels?.includes('mobile') === true),
    );
    for (const operation of mobile) {
      const names = reachable(operation.responses);
      for (const name of ['Money', 'MoneyTotal', 'PaymentMilestone', 'PaymentMilestoneList', 'UnpaidPaymentMilestoneList'])
        expect(names.has(name)).toBe(false);
    }
    // the payment schemas are really reachable from the web operations (the walk above is not vacuous)
    const web = bundle.paths['/api/v1/work-orders/{workOrderId}/payment-milestones']?.['get'];
    expect(reachable(web?.responses).has('Money')).toBe(true);
  });

  it('EVM-055 AC7 the summary of unpaid invoices is open to the three roles on the web channel only, with no audit of the read (P3, P6)', () => {
    expect(AUTHZ_MANIFEST['listUnpaidPaymentMilestones']).toMatchObject({
      method: 'get',
      path: '/api/v1/payment-milestones',
      authz: { roles: ['administrator', 'editor', 'read_only'], channels: ['web'] },
    });
    expect(AUTHZ_MANIFEST['listUnpaidPaymentMilestones']?.authz).not.toHaveProperty('audit');
  });

  it('EVM-055 AC4 the query accepts the closed view, the range of days and an identifier of a customer, and refuses a value outside the lists, a day outside 2000-2100', () => {
    const parse = (query: unknown) => zListUnpaidPaymentMilestonesQuery.safeParse(query).success;
    expect(parse({})).toBe(true);
    expect(parse({ view: 'overdue', dueFrom: '2000-01-01', dueTo: '2100-12-31', customerId: V7, limit: 100 })).toBe(true);
    expect(parse({ view: 'to_invoice' })).toBe(false);
    expect(parse({ dueFrom: '1999-12-31' })).toBe(false);
    expect(parse({ dueTo: '2101-01-01' })).toBe(false);
    expect(parse({ dueFrom: '2026-1-1' })).toBe(false);
    expect(parse({ customerId: 'not-a-uuid' })).toBe(false);
    expect(parse({ limit: 0 })).toBe(false);
    expect(parse({ limit: 101 })).toBe(false);
  });

  it('EVM-055 AC3 the answer has the page, the day of the clock and the summary with the money as MoneyTotal', () => {
    const item = {
      id: V7,
      workOrder: { id: V7, number: 'ZL-2026-0031', title: 'Wallbox' },
      customer: { deleted: true },
      name: 'Zaliczka',
      invoiceNumber: 'FV/1/2026',
      amount: { amountMinor: 360000, currency: 'PLN' },
      dueDate: '2026-09-28',
      status: 'invoiced',
      isOverdue: true,
      overdueDays: 5,
      version: 3,
    };
    const count = { count: 1, total: { amountMinor: 360000, currency: 'PLN' } };
    const page = {
      items: [item],
      nextCursor: null,
      asOf: '2026-10-03',
      summary: {
        unpaid: count,
        overdue: count,
        longestOverdue: { days: 5, workOrder: { id: V7, number: 'ZL-2026-0031' } },
        filtered: count,
      },
    };
    expect(zUnpaidPaymentMilestoneList.safeParse(page).success).toBe(true);
    expect(zUnpaidPaymentMilestoneList.safeParse({ ...page, items: [{ ...item, overdueDays: 0 }] }).success).toBe(false);
    expect(zUnpaidPaymentMilestoneList.safeParse({ ...page, summary: { ...page.summary, longestOverdue: null } }).success).toBe(true);
  });
});
