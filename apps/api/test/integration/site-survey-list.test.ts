/**
 * The site surveys on the list of work orders (EVM-135 AC6; ADR-0024 pt 2; W5): by default together with the ordinary orders and marked with `siteSurvey`
 * (`customer: null`, `site: null` - the address only in the detail); `siteSurvey=only|exclude`; the sort by the deadline with `only`; the reports
 * (`waiting_on_dso_over_14_days`, `overdue_payments`, `unpaid` and the list of unpaid milestones) leave the open surveys out; the projection holds the deadline
 * and `verify` finds no drift. Synthetic data only.
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertMilestones } from '../support/payment-fixtures.ts';
import { projectionTools } from '../support/projection.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { insertWorkOrders, numberOf } from '../support/work-order-fixtures.ts';

const STREET = 'ul. Listowa Wizyjna';
const CITY = 'Listogród';
const PHONE = '+48600246135';
const LATE = new Date('2027-03-01T08:00:00.000Z');
const EARLY = new Date('2027-02-01T08:00:00.000Z');

let current: IdentityApp;
let ids: Map<string, string>;
const SURVEY_LATE = numberOf(2026, 8001);
const SURVEY_EARLY = numberOf(2026, 8002);
const ORDINARY = numberOf(2026, 8003);
const SURVEY_INVOICED = numberOf(2026, 8004);

beforeAll(async () => {
  current = await createIdentityApp();
  const admin = current.database.admin;
  const siteId = await insertSite(admin, { street: STREET, city: CITY });
  const customerId = await insertCustomer(admin, {});
  ids = await insertWorkOrders(admin, [
    { number: SURVEY_LATE, siteId, siteSurveyExpiresAt: LATE },
    { number: SURVEY_EARLY, siteId, siteSurveyExpiresAt: EARLY },
    { number: ORDINARY, siteId, customerId, status: 'in_progress' },
    { number: SURVEY_INVOICED, siteId, siteSurveyExpiresAt: LATE },
  ]);
  await sql`update work_orders.work_orders set requester_phone = ${PHONE}, site_survey_extensions = 1 where number = ${SURVEY_EARLY}`.execute(
    admin,
  );
  // milestones a survey cannot get through the API (EVM-135 AC7): written straight, to prove that the reports leave the survey out anyway
  for (const number of [ORDINARY, SURVEY_INVOICED]) {
    await insertMilestones(admin, ids.get(number) ?? '', [{ status: 'invoiced', dueDate: '2026-01-10', amountMinor: 100_000 }]);
  }
  const { maintenance } = projectionTools(admin);
  await maintenance.rebuild({ only: [...ids.values()] });
});
afterAll(async () => {
  await current.close();
});

async function signIn(role: Role = 'editor') {
  const user = await createUser(current.database.admin, current.clock, { role });
  const session = await createSession(current.database.admin, current.clock, user, { channel: 'web' });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return panel;
}
interface Item {
  readonly number: string;
  readonly customer: unknown;
  readonly site: unknown;
  readonly siteSurvey?: { expiresAt: string; extensionCount: number; requesterPhone: string | null } | null;
}
const itemsOf = (body: unknown): Item[] => (body as { items: Item[] }).items;
const numbersOf = (body: unknown): string[] => itemsOf(body).map((item) => item.number);
const ours = (numbers: readonly string[]): string[] =>
  numbers.filter((number) => [SURVEY_LATE, SURVEY_EARLY, ORDINARY, SURVEY_INVOICED].includes(number));

describe('the site surveys on the list (EVM-135 AC6)', () => {
  it('EVM-135 AC6 by default the list shows the surveys with the ordinary orders; a survey has siteSurvey, customer null and site null; an ordinary order siteSurvey null', async () => {
    const panel = await signIn();
    const list = await panel.get('/api/v1/work-orders?sort=number');
    expect(list.status).toBe(200);
    expect(ours(numbersOf(list.body))).toEqual([SURVEY_LATE, SURVEY_EARLY, ORDINARY, SURVEY_INVOICED]);
    const byNumber = new Map(itemsOf(list.body).map((item) => [item.number, item]));
    expect(byNumber.get(SURVEY_EARLY)).toMatchObject({
      customer: null,
      site: null,
      siteSurvey: { expiresAt: EARLY.toISOString(), extensionCount: 1, requesterPhone: PHONE },
    });
    expect(byNumber.get(SURVEY_LATE)).toMatchObject({
      customer: null,
      site: null,
      siteSurvey: { expiresAt: LATE.toISOString(), extensionCount: 0, requesterPhone: null },
    });
    expect(byNumber.get(ORDINARY)).toMatchObject({ siteSurvey: null, site: { city: CITY } });
  });

  it('EVM-135 AC6 W5 the answer of the list holds the address of the ordinary order only - never the address of a survey', async () => {
    const panel = await signIn();
    const only = await panel.get('/api/v1/work-orders?siteSurvey=only');
    expect(JSON.stringify(only.body)).not.toContain(STREET);
    expect(JSON.stringify(only.body)).not.toContain(CITY);
  });

  it('EVM-135 AC6 siteSurvey=only and siteSurvey=exclude; the pages of a cursor keep the filter; a cursor of another filter is 400 invalid_cursor', async () => {
    const panel = await signIn();
    expect(ours(numbersOf((await panel.get('/api/v1/work-orders?siteSurvey=only&sort=number')).body))).toEqual([
      SURVEY_LATE,
      SURVEY_EARLY,
      SURVEY_INVOICED,
    ]);
    expect(ours(numbersOf((await panel.get('/api/v1/work-orders?siteSurvey=exclude&sort=number')).body))).toEqual([ORDINARY]);
    const first = await panel.get('/api/v1/work-orders?siteSurvey=only&sort=number&limit=1');
    const cursor = (first.body as { nextCursor: string }).nextCursor;
    const next = await panel.get(`/api/v1/work-orders?siteSurvey=only&sort=number&limit=1&cursor=${cursor}`);
    expect(next.status).toBe(200);
    const other = await panel.get(`/api/v1/work-orders?siteSurvey=exclude&sort=number&limit=1&cursor=${cursor}`);
    expect(other.status).toBe(400);
    expect((other.body as { code: string }).code).toBe('invalid_cursor');
    const invalid = await panel.get('/api/v1/work-orders?siteSurvey=all');
    expect(invalid.status).toBe(400);
  });

  it('EVM-135 AC6 the sort by the deadline: ascending with siteSurvey=only, page by page; without the filter it is 400 on /sort', async () => {
    const panel = await signIn();
    const sorted = await panel.get('/api/v1/work-orders?siteSurvey=only&sort=siteSurveyExpiresAt');
    expect(sorted.status).toBe(200);
    expect(ours(numbersOf(sorted.body))).toEqual([
      SURVEY_EARLY,
      ...[SURVEY_LATE, SURVEY_INVOICED].sort((a, b) => ((ids.get(a) ?? '') < (ids.get(b) ?? '') ? -1 : 1)),
    ]);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await panel.get(
        `/api/v1/work-orders?siteSurvey=only&sort=siteSurveyExpiresAt&limit=1${cursor === null ? '' : `&cursor=${cursor}`}`,
      );
      expect(page.status).toBe(200);
      seen.push(...numbersOf(page.body));
      cursor = (page.body as { nextCursor: string | null }).nextCursor;
    } while (cursor !== null);
    expect(ours(seen)).toEqual(ours(numbersOf(sorted.body)));
    for (const query of ['sort=siteSurveyExpiresAt', 'siteSurvey=exclude&sort=siteSurveyExpiresAt']) {
      const refused = await panel.get(`/api/v1/work-orders?${query}`);
      expect(refused.status, query).toBe(400);
      expect((refused.body as { errors: Array<{ pointer: string }> }).errors.map((error) => error.pointer)).toEqual(['/sort']);
    }
    const search = await panel.post('/api/v1/work-orders/search', { query: 'Zlecenie', sort: 'siteSurveyExpiresAt' });
    expect(search.status).toBe(400);
  });

  it('EVM-135 AC6 the reports leave the open surveys out: the views overdue_payments and unpaid, and the list of unpaid milestones', async () => {
    const panel = await signIn();
    for (const view of ['overdue_payments', 'unpaid']) {
      const list = await panel.get(`/api/v1/work-orders?view=${view}`);
      expect(list.status, view).toBe(200);
      expect(ours(numbersOf(list.body)), view).toEqual([ORDINARY]);
    }
    const unpaid = await panel.get('/api/v1/payment-milestones');
    expect(unpaid.status).toBe(200);
    const numbers = (unpaid.body as { items: Array<{ workOrder: { number: string } }> }).items.map((item) => item.workOrder.number);
    expect(ours(numbers)).toEqual([ORDINARY]);
  });

  it('EVM-135 AC6 the projection holds the deadline of each survey and verify finds no drift', async () => {
    const { rows } = await sql<{ number: string; site_survey_expires_at: Date | null }>`
      select number, site_survey_expires_at from overview.work_order_summaries where number in (${SURVEY_EARLY}, ${ORDINARY}) order by number`.execute(
      current.database.admin,
    );
    expect(rows).toEqual([
      { number: SURVEY_EARLY, site_survey_expires_at: EARLY },
      { number: ORDINARY, site_survey_expires_at: null },
    ]);
    const report = await projectionTools(current.database.admin).maintenance.verify({ traceId: '0'.repeat(32), alert: false });
    expect(report.drift.authorization).toEqual([]);
    expect(report.missing).toEqual([]);
  });
});
