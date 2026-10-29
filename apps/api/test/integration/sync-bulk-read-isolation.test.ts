import { afterEach, describe, expect, it } from 'vitest';
import { BULK_READ_METER, DISTINCT_READ_METER } from '../../src/platform/tokens.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { signedInPhone } from '../support/mobile-flows.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { totpAccount } from '../support/totp-flows.ts';
import { insertWorkOrders, numberOf } from '../support/work-order-fixtures.ts';

let current: IdentityApp;
afterEach(async () => {
  await current.close();
});

describe('sync reads and the meters of EVM-039 (EVM-096 AC8; AB-08, SR-API-02)', () => {
  it('EVM-096 AC8 a full download and a pull with a cursor never reach the meter of different customers or of records', async () => {
    const distinctCalls: string[] = [];
    const recordCalls: string[] = [];
    current = await createIdentityApp({
      env: { SYNC_FULL_DOWNLOADS_PER_DAY: '50' },
      configure: (builder) =>
        builder
          .overrideProvider(DISTINCT_READ_METER)
          .useValue({
            record: (userId: string, type: string) => {
              distinctCalls.push(`${type}:${userId}`);
              return false;
            },
          })
          .overrideProvider(BULK_READ_METER)
          .useValue({
            record: (userId: string, type: string) => {
              recordCalls.push(`${type}:${userId}`);
              return false;
            },
          }),
    });
    const account = await totpAccount(current, { role: 'editor' });
    const phone = await signedInPhone(current, account);
    const customer = await insertCustomer(current.database.admin);
    const site = await insertSite(current.database.admin);
    await insertWorkOrders(current.database.admin, [{ number: numberOf(2026, 1), customerId: customer, siteId: site }]);

    const full = await phone.get('/api/v1/sync/changes', phone.authorised());
    expect(full.status).toBe(200);
    const body = full.body as { changes: Array<{ entity?: { type: string } }>; cursor: string };
    expect(body.changes.map((change) => change.entity?.type)).toContain('customer');
    const next = await phone.get(`/api/v1/sync/changes?cursor=${body.cursor}`, phone.authorised());
    expect(next.status).toBe(200);
    expect(distinctCalls).toEqual([]);
    expect(recordCalls).toEqual([]);
  });
});
