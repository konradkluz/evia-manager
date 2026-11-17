import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { BASE, useDeletionApp } from '../support/deletion-harness.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';
import { APP_CONFIG } from '../../src/platform/tokens.ts';
import type { AppConfig } from '../../src/platform/config/config.ts';

/**
 * Edge cases of the site survey found by the independent verification (EVM-135, EVM-136): the switch gates only the creation, a survey whose deadline has
 * passed (not yet purged by EVM-139) is still an open survey, and the Polish letters of a survey title are found by the search. Synthetic data only.
 */
const harness = useDeletionApp();
const { app, admin } = harness;

const PAST_DEADLINE = new Date('2026-09-01T08:00:00.000Z'); // before the clock of the harness (2026-10-16)
const POLISH_TITLE = 'Wizja Żółć Łąka Źdźbło Ćma Ęś Ńó';

async function openSurvey(number: string, options: { deadline: Date; title?: string }): Promise<string> {
  const siteId = await insertSite(admin(), { street: 'ul. Wymyślona Kontrolna', city: 'Kontrolowo', postalCode: '99-937' });
  const ids = await insertWorkOrders(admin(), [
    { number, siteSurveyExpiresAt: options.deadline, siteId, ...(options.title === undefined ? {} : { title: options.title }) },
  ]);
  return [...ids.values()][0] ?? '';
}

describe('edges of the site survey (QA)', () => {
  it('EVM-135 AC3 EVM-136 AC1 the switch is OFF in this application, and the assignment of a customer to an existing survey still works: the switch gates the creation only', async () => {
    expect(app().app.get<AppConfig>(APP_CONFIG, { strict: false }).features.siteSurveys).toBe(false);
    const editor = await harness.signIn('editor');
    const id = await openSurvey('ZL-7901-0136', { deadline: new Date('2027-01-01T08:00:00.000Z') });
    const customerId = await insertCustomer(admin());
    const response = await editor.panel.put(`${BASE}/${id}/customer`, { customerId, version: 1 });
    expect(response.status).toBe(200);
  });

  it('EVM-136 AC1 a survey whose deadline has passed but which is not purged yet is still open: the assignment is 200, clears the deadline and the survey is an ordinary order', async () => {
    const editor = await harness.signIn('editor');
    const id = await openSurvey('ZL-7902-0136', { deadline: PAST_DEADLINE });
    const customerId = await insertCustomer(admin());
    const response = await editor.panel.put(`${BASE}/${id}/customer`, { customerId, version: 1 });
    expect(response.status).toBe(200);
    const row = (
      await sql<{ customer_id: string | null; site_survey_expires_at: Date | null }>`
        select customer_id, site_survey_expires_at from work_orders.work_orders where id = ${id}`.execute(admin())
    ).rows[0];
    expect(row).toEqual({ customer_id: customerId, site_survey_expires_at: null });
  });

  it('EVM-135 AC4 the search finds a survey by its title with Polish letters (Administrator and Editor), and Tylko odczyt does not find it', async () => {
    await openSurvey('ZL-7903-0136', { deadline: new Date('2027-01-01T08:00:00.000Z'), title: POLISH_TITLE });
    for (const [role, finds] of [
      ['administrator', true],
      ['editor', true],
      ['read_only', false],
    ] as const) {
      const browser = await harness.signIn(role);
      for (const query of ['Żółć', 'Łąka', 'Źdźbło']) {
        const found = await browser.panel.post('/api/v1/work-orders/search', { query });
        expect(found.status, `${role} ${query}`).toBe(200);
        const numbers = (found.body as { items: Array<{ number: string }> }).items.map((item) => item.number);
        expect(numbers.includes('ZL-7903-0136'), `${role} ${query}`).toBe(finds);
      }
    }
  });
});
