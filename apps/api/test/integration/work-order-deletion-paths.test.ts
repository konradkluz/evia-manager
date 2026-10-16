import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { BASE, useDeletionApp, type Browser } from '../support/deletion-harness.ts';
import type { MilestoneSpec } from '../support/payment-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';

/**
 * The paths of AB-17 (EVM-060 AC5; SR-AUTHZ-05, SR-AUTHZ-10, SR-SESS-08; ASVS V8.2.1): the deletion of a work order must not be a way to
 * the effect of a correction of a payment — to hide an issued invoice, to change an amount or a status without the step-up. Every
 * path below ends with the milestones exactly as they were.
 */
const harness = useDeletionApp();
const { admin } = harness;

const codeOf = (body: unknown) => (body as { code?: string }).code;
const invoiced: MilestoneSpec = { status: 'invoiced', amountMinor: 360_000, dueDate: '2026-10-30' };
const paid: MilestoneSpec = { status: 'paid', amountMinor: 120_000 };
const planned: MilestoneSpec = { status: 'planned', amountMinor: 40_000 };

const del = (browser: Browser, id: string, key?: string) =>
  browser.panel.delete(`${BASE}/${id}`, { 'If-Match': '"1"', ...(key === undefined ? {} : { 'Idempotency-Key': key }) });
const milestoneRows = async (orderId: string) =>
  (
    await sql<{ status: string; amount_minor: string | null; version: number; deleted: boolean }>`
      select status, amount_minor, version, deleted_at is not null as deleted
      from payments.payment_milestones where work_order_id = ${orderId} order by position`.execute(admin())
  ).rows;

describe('the paths to a payment correction through the deletion of the order (EVM-060 AC5; AB-17; SR-AUTHZ-10)', () => {
  it('EVM-060 AC5 (a) the Editor deleting an order with a paid milestone is 403 forbidden — the milestones are exactly as they were', async () => {
    const editor = await harness.signIn('editor', { key: 'fresh' });
    const created = await harness.order([paid, planned]);
    const before = await milestoneRows(created.id);
    const response = await del(editor, created.id, uuidv7());
    expect([response.status, codeOf(response.body)]).toEqual([403, 'forbidden']);
    expect(await milestoneRows(created.id)).toEqual(before);
    expect(await harness.rowOf(created.id)).toMatchObject({ deleted: false });
  });

  it('EVM-060 AC5 (b) the Administrator without a step-up deleting an order with a paid milestone is 403 step_up_required — nothing changes', async () => {
    const plain = await harness.signIn('administrator');
    const created = await harness.order([paid, planned]);
    const before = await milestoneRows(created.id);
    const response = await del(plain, created.id);
    expect([response.status, codeOf(response.body)]).toEqual([403, 'step_up_required']);
    expect(await milestoneRows(created.id)).toEqual(before);
    expect(await harness.rowOf(created.id)).toMatchObject({ deleted: false });
  });

  it('EVM-060 AC5 (c) an order with an invoiced milestone is 409 for the Administrator with a fresh step-up too — the invoice cannot be hidden', async () => {
    const administrator = await harness.administrator();
    const created = await harness.order([invoiced, paid]);
    const before = await milestoneRows(created.id);
    const response = await del(administrator, created.id);
    expect([response.status, codeOf(response.body)]).toEqual([409, 'has_active_dependents']);
    expect(await milestoneRows(created.id)).toEqual(before);
    expect(await harness.rowOf(created.id)).toMatchObject({ deleted: false });
  });

  it('EVM-060 AC5 (d) after the deletion every write on the milestones is 404 — the Administrator with a fresh step-up and the Editor alike — and Read-only stays 403; nothing is changed', async () => {
    const administrator = await harness.administrator();
    const editor = await harness.signIn('editor');
    const viewer = await harness.signIn('read_only');
    const created = await harness.order([paid, planned]);
    const [paidId = '', plannedId = ''] = created.milestoneIds;
    expect((await del(administrator, created.id)).status).toBe(204);
    const before = await milestoneRows(created.id);
    const base = `${BASE}/${created.id}/payment-milestones`;
    const writes = (browser: Browser) => [
      // a correction of a paid milestone (the step-up one) and the issue of a planned one
      browser.panel.post(`${base}/${paidId}/transitions`, { to: 'invoiced' }, { 'If-Match': '"1"' }),
      browser.panel.post(
        `${base}/${plannedId}/transitions`,
        { to: 'invoiced', invoiceNumber: 'FV/TEST/1', dueDate: '2026-10-30' },
        { 'If-Match': '"1"' },
      ),
      browser.panel.patch(`${base}/${paidId}`, { amount: { amountMinor: 1, currency: 'PLN' } }, { 'If-Match': '"1"' }),
      browser.panel.patch(`${base}/${plannedId}`, { amount: { amountMinor: 1, currency: 'PLN' } }, { 'If-Match': '"1"' }),
      browser.panel.delete(`${base}/${paidId}`, { 'If-Match': '"1"' }),
      browser.panel.delete(`${base}/${plannedId}`, { 'If-Match': '"1"' }),
      browser.panel.post(base, { id: uuidv7(), name: 'Nowa', amount: { amountMinor: 100, currency: 'PLN' } }),
    ];
    // the deletion of a milestone (#4, #5) is the Administrator's: the Editor is stopped by the guard (403) before the order is looked for
    const expected = (browser: Browser, index: number) =>
      browser === editor && (index === 4 || index === 5) ? [403, 'forbidden'] : [404, 'not_found'];
    for (const browser of [administrator, editor]) {
      for (const [index, response] of (await Promise.all(writes(browser))).entries()) {
        expect([response.status, codeOf(response.body)], `${browser === administrator ? 'administrator' : 'editor'} #${index}`).toEqual(
          expected(browser, index),
        );
      }
    }
    for (const response of await Promise.all(writes(viewer))) expect([response.status, codeOf(response.body)]).toEqual([403, 'forbidden']);
    expect(await milestoneRows(created.id)).toEqual(before);
  });

  it('EVM-060 AC5 (d) the deleted order is no way round the step-up either: a paid milestone of a deleted order cannot be corrected, and after the restoration the correction asks for the step-up again', async () => {
    const administrator = await harness.administrator();
    const plain = await harness.signIn('administrator');
    const created = await harness.order([paid]);
    const paidId = created.milestoneIds[0] ?? '';
    expect((await del(administrator, created.id)).status).toBe(204);
    const restored = await administrator.panel.post(`${BASE}/${created.id}/restore`, undefined, { 'If-Match': '"2"' });
    expect(restored.status).toBe(200);
    const correction = await plain.panel.post(
      `${BASE}/${created.id}/payment-milestones/${paidId}/transitions`,
      { to: 'invoiced' },
      { 'If-Match': '"1"' },
    );
    expect([correction.status, codeOf(correction.body)]).toEqual([403, 'step_up_required']);
    expect(await milestoneRows(created.id)).toMatchObject([{ status: 'paid', amount_minor: '120000', version: 1 }]);
  });

  it('EVM-060 AC5 the deletion changes no milestone and writes no event of payments: the audit of the order has the one action of the deletion', async () => {
    const administrator = await harness.administrator();
    const created = await harness.order([paid, planned]);
    expect((await del(administrator, created.id)).status).toBe(204);
    const { rows } = await sql<{ action: string }>`
      select action from audit.events where action like 'payment_milestone.%' and object_id = any(${created.milestoneIds}::uuid[])`.execute(
      admin(),
    );
    expect(rows).toEqual([]);
  });
});
