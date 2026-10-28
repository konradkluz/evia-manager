import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryBulkReadMeter } from '../../src/platform/bulk-read/bulk-read-meter.ts';
import { BULK_READ_METER, CLOCK } from '../../src/platform/tokens.ts';
import { codeOf, CUSTOMERS, NOW, signInTo, type Browser } from '../support/customer-erasure.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';

let app: IdentityApp;
beforeAll(async () => {
  // thresholds lowered through the provider: a block at 10 records in 10 minutes
  app = await createIdentityApp({
    now: NOW,
    configure: (builder) =>
      builder.overrideProvider(BULK_READ_METER).useFactory({
        inject: [CLOCK],
        factory: (clock: { now(): Date }) => new InMemoryBulkReadMeter(clock, { alertAt: 5, blockAt: 10 }),
      }),
  });
  for (let index = 0; index < 6; index += 1) {
    await insertCustomer(app.database.admin, {
      firstName: 'Masowy',
      lastName: `Usuniety${String(index)}`,
      deletedAt: '2026-10-20T08:00:00Z',
    });
  }
});
afterAll(async () => {
  await app.close();
});

describe('EVM-041 AC3 - the view "Usunięci" counts towards the mass-read limit like the ordinary list (P10, SR-API-02)', () => {
  it('EVM-041 AC3 the records of the list and of the search of the deleted customers are counted: past the block 429 rate_limited with Retry-After and no customer in the answer', async () => {
    const administrator: Browser = await signInTo(app, 'administrator');
    const listed = await administrator.panel.get(`${CUSTOMERS}?deleted=true`); // 6 records
    expect(listed.status).toBe(200);
    expect((listed.body as { items: unknown[] }).items).toHaveLength(6);
    const searched = await administrator.panel.post(`${CUSTOMERS}/search`, { query: 'masowy', deleted: true }); // 12: over the block
    expect(searched.status).toBe(200);
    const blocked = await administrator.panel.get(`${CUSTOMERS}?deleted=true`);
    expect([blocked.status, codeOf(blocked.body)]).toEqual([429, 'rate_limited']);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(JSON.stringify(blocked.body)).not.toMatch(/Usuniety|Masowy/);
    // the live list of the same user is blocked too: ONE meter for the customers, whatever the view
    expect((await administrator.panel.get(CUSTOMERS)).status).toBe(429);
  });

  it('EVM-041 AC3 a refused request (403 for the Editor) counts nothing: the Editor can still read the live list', async () => {
    const editor: Browser = await signInTo(app, 'editor');
    expect((await editor.panel.get(`${CUSTOMERS}?deleted=true`)).status).toBe(403);
    expect((await editor.panel.get(CUSTOMERS)).status).toBe(200);
  });
});
