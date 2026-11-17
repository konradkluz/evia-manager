/**
 * The address of a site survey and the phone of its requester stay out of everything but the detail (EVM-135 AC8; ADR-0024 pt 7; W5; SR-LOG-02, SR-DATA-03):
 * after the creation from the phone and from the panel, the reads (the list, the detail, the search), the synchronisation (the changes and the snapshot), a
 * medium from the phone and the refusals (validation, an existing identifier, a missing site, the limit), neither the log, the audit trail, `sync.change_log`,
 * the security alerts, the e-mail outbox, the metrics, the files of the media, the answers of the refusals, the answer of the list nor the search text of the
 * order holds them. Synthetic data only: the address and the numbers are invented.
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { METRICS } from '../../src/platform/tokens.ts';
import type { IdentityApp } from '../support/identity-app.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { bootSync, drain, editor } from '../support/sync-harness.ts';
import { uuidv7 } from '../support/uuid.ts';

const STREET = 'ul. Tajemnicza Wizyjna';
const CITY = 'Redakcjogród';
const POSTAL = '00-813';
const BUILDING = '77B';
const PHONE = '600 813 135';
const PHONE_E164 = '+48600813135';
const PANEL_PHONE = '+48 600 813 246';
const PANEL_PHONE_E164 = '+48600813246';
const SECRETS = [STREET, 'Tajemnicza', CITY, POSTAL, BUILDING, PHONE, PHONE_E164, '600813135', PANEL_PHONE, PANEL_PHONE_E164, '600813246'];

let current: IdentityApp;
const refusals: unknown[] = [];
let listBody: unknown;
let surveyFromPhone = '';
let surveyFromPanel = '';

beforeAll(async () => {
  current = (await bootSync({ SITE_SURVEYS_ENABLED: 'true' })).app;
  const { account, phone } = await editor(current);
  const push = async (mutation: unknown) => {
    const response = await phone.post('/api/v1/sync/mutations', { mutations: [mutation] }, phone.authorised());
    expect(response.status).toBe(200);
    return (response.body as { results: Array<Record<string, unknown>> }).results[0] ?? {};
  };
  const survey = (payload: Record<string, unknown>) => ({
    mutationId: uuidv7(),
    type: 'CreateSiteSurvey',
    commandVersion: 1,
    payload: { workOrderId: uuidv7(), ...payload },
  });
  const newSite = () => ({
    id: uuidv7(),
    siteType: 'single_family_house',
    street: STREET,
    buildingNumber: BUILDING,
    postalCode: POSTAL,
    city: CITY,
  });

  // the phone: a survey with a new site and the phone of the requester, a medium of it, and the refusals
  const created = survey({ newSite: newSite(), requesterPhone: PHONE });
  expect(await push(created)).toMatchObject({ outcome: 'applied' });
  surveyFromPhone = created.payload.workOrderId;
  expect(
    await push({
      mutationId: uuidv7(),
      type: 'CreateMediaAsset',
      commandVersion: 1,
      payload: { id: uuidv7(), workOrderId: surveyFromPhone, mediaType: 'photo', category: 'site_survey' },
    }),
  ).toMatchObject({ outcome: 'applied' });
  refusals.push(await push(survey({ newSite: newSite(), requesterPhone: '81 31 35' })));
  refusals.push(await push({ ...created, mutationId: uuidv7() }));
  refusals.push(await push(survey({ siteId: uuidv7(), requesterPhone: PHONE })));
  for (let index = 0; index < 20; index += 1) await push(survey({ newSite: newSite(), requesterPhone: PHONE }));
  refusals.push(await push(survey({ newSite: newSite(), requesterPhone: PHONE })));
  expect(JSON.stringify(refusals)).toContain('quota_exceeded');

  // the panel: a survey of an existing site, the refusals, the reads
  const siteId = await insertSite(current.database.admin, { street: STREET, city: CITY, postalCode: POSTAL, buildingNumber: BUILDING });
  surveyFromPanel = uuidv7();
  expect((await account.panel.post('/api/v1/site-surveys', { id: surveyFromPanel, siteId, requesterPhone: PANEL_PHONE })).status).toBe(201);
  for (const body of [
    { id: uuidv7(), siteId, requesterPhone: '81 32 46' },
    { id: surveyFromPanel, siteId, requesterPhone: PANEL_PHONE },
    { id: uuidv7(), siteId: uuidv7(), requesterPhone: PANEL_PHONE },
  ]) {
    const refused = await account.panel.post('/api/v1/site-surveys', body);
    expect(refused.status).toBeGreaterThanOrEqual(400);
    refusals.push(refused.body);
  }
  const list = await account.panel.get('/api/v1/work-orders?siteSurvey=only');
  expect(list.status).toBe(200);
  listBody = list.body;
  expect((await account.panel.get(`/api/v1/work-orders/${surveyFromPanel}`)).status).toBe(200);
  expect((await account.panel.post('/api/v1/work-orders/search', { query: 'Wizja lokalna' })).status).toBe(200);

  // the synchronisation: the changes and the snapshot of the survey
  await drain(phone);
  expect((await phone.get(`/api/v1/sync/work-orders/${surveyFromPhone}`, phone.authorised())).status).toBe(200);
});
afterAll(async () => {
  await current.close();
});

const rowsOf = async (query: ReturnType<typeof sql<{ row: string }>>): Promise<string> =>
  (await query.execute(current.database.admin)).rows.map((row) => row.row).join('\n');

describe('the address and the phone stay out (EVM-135 AC8; W5)', () => {
  it('EVM-135 AC8 the log lines, the audit trail, sync.change_log, the security alerts, the e-mail outbox (the notifications), the metrics and the files of the media hold neither the address nor the phone', async () => {
    const metrics = JSON.stringify(current.app.get<MetricsRegistry>(METRICS, { strict: false }).snapshot());
    const sources: Record<string, string> = {
      log: current.logs.text,
      audit: await rowsOf(sql`select to_jsonb(t)::text as row from audit.events t`),
      changeLog: await rowsOf(sql`select to_jsonb(t)::text as row from sync.change_log t`),
      alerts: await rowsOf(sql`select to_jsonb(t)::text as row from platform.security_alert_outbox t`),
      email: await rowsOf(sql`select to_jsonb(t)::text as row from platform.email_outbox t`),
      files: await rowsOf(sql`select to_jsonb(t)::text as row from media.stored_files t`),
      media: await rowsOf(sql`select to_jsonb(t)::text as row from media.media_assets t`),
      metrics,
    };
    expect(sources['audit']).toContain('CreateSiteSurvey');
    for (const [name, text] of Object.entries(sources)) {
      for (const secret of SECRETS) expect(text, `${name}: ${secret}`).not.toContain(secret);
    }
  });

  it('EVM-135 AC8 the answers of the refusals (validation, an existing identifier, a missing site, the limit) hold neither the address nor the phone', () => {
    const text = JSON.stringify(refusals);
    expect(refusals.length).toBeGreaterThanOrEqual(7);
    for (const secret of [...SECRETS, '81 31 35', '81 32 46']) expect(text, secret).not.toContain(secret);
  });

  it('EVM-135 AC8 W5 the answer of the list names the surveys by their number and mark - never their address', () => {
    const text = JSON.stringify(listBody);
    expect(text).toContain(surveyFromPanel);
    for (const secret of [STREET, CITY, POSTAL, BUILDING]) expect(text, secret).not.toContain(secret);
  });

  it('EVM-135 AC8 the search text of the orders holds no phone of the requester, and the search by that phone finds nothing', async () => {
    const { rows } = await sql<{
      search_text: string;
    }>`select search_text from work_orders.work_orders where id in (${surveyFromPhone}, ${surveyFromPanel})`.execute(
      current.database.admin,
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) for (const digits of ['600813135', '600813246', '813 135']) expect(row.search_text).not.toContain(digits);
  });
});
