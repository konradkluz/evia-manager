import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { sql } from 'kysely';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertWorkOrders, numberOf } from '../support/work-order-fixtures.ts';

/**
 * EVM-072 AC5 (P10, D5): the customers NAMED by a page of the list or of the search count as different customers read — the 301st
 * different customer in an hour raises the alert `bulk_read_customers`, once. The thresholds of the record meter stay at their
 * production values (2000 / 10 000) so only the distinct meter speaks. 301 synthetic customers, one order each.
 */
const CUSTOMERS = 301;
let app: IdentityApp;
beforeAll(async () => {
  app = await createIdentityApp();
  const specs = [];
  for (let index = 0; index < CUSTOMERS; index += 1) {
    const customerId = await insertCustomer(app.database.admin, {
      firstName: 'Klient',
      lastName: `Seryjny${String(index).padStart(3, '0')}`,
      phone: `+4860${String(1_000_000 + index)}`,
    });
    specs.push({ number: numberOf(2026, index + 1), title: `Zlecenie seryjne ${index + 1}`, customerId });
  }
  await insertWorkOrders(app.database.admin, specs);
}, 120_000);
afterAll(async () => {
  await app.close();
});

const alerts = () => app.logs.entries.filter((entry) => entry['alert'] === 'security' && entry['alertCode'] === 'bulk_read_customers');

async function browser() {
  const user = await createUser(app.database.admin, app.clock, { role: 'editor' });
  const session = await createSession(app.database.admin, app.clock, user);
  const panel = new PanelClient(app.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, cookie: session.cookie, panel };
}
interface Page {
  items: Array<{ customer?: { id: string } | { deleted: true } | null }>;
  nextCursor: string | null;
}

describe('different customers read through the list and the search (EVM-072 AC5; P10 D5; TM-19, AB-08)', () => {
  it('EVM-072 AC5 paging the LIST through 301 different customers raises ONE alert bulk_read_customers on the page with the 301st, without the user or a name', async () => {
    const user = await browser();
    const before = alerts().length;
    let cursor: string | null = null;
    let pages = 0;
    do {
      const response: request.Response = await request(app.app.getHttpServer())
        .get(`/api/v1/work-orders?limit=100${cursor === null ? '' : `&cursor=${cursor}`}`)
        .set('Cookie', user.cookie);
      expect(response.status).toBe(200);
      cursor = (response.body as Page).nextCursor;
      pages += 1;
      // 100, 200, 300 different customers: no alert yet; the 4th page holds the 301st
      expect(alerts().length - before, `after page ${pages}`).toBe(pages === 4 ? 1 : 0);
    } while (cursor !== null);
    expect(pages).toBe(4);
    const entry = alerts().at(-1);
    expect(JSON.stringify(entry)).not.toMatch(new RegExp(`${user.userId}|Seryjny`));
    const { rows } = await sql<{ n: string }>`
      select count(*)::text as n from audit.events where actor_user_id = ${user.userId} and action = 'bulk_read.alerted'`.execute(
      app.database.admin,
    );
    expect(rows[0]?.n).toBe('1');
  });

  it('EVM-072 AC5 paging the SEARCH through the same 301 customers raises ONE alert on the page with the 301st; the same page asked again does not add a customer', async () => {
    const user = await browser();
    const before = alerts().length;
    const first = await user.panel.post('/api/v1/work-orders/search', { query: 'seryjne', limit: 100 });
    expect(first.status).toBe(200);
    // the same 100 again: no new identifier
    expect((await user.panel.post('/api/v1/work-orders/search', { query: 'seryjne', limit: 100 })).status).toBe(200);
    expect(alerts().length - before).toBe(0);
    let cursor = (first.body as Page).nextCursor;
    while (cursor !== null) {
      const response = await user.panel.post('/api/v1/work-orders/search', { query: 'seryjne', limit: 100, cursor });
      expect(response.status).toBe(200);
      cursor = (response.body as Page).nextCursor;
    }
    expect(alerts().length - before).toBe(1);
  });
});
