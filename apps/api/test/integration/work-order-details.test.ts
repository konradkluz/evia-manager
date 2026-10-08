import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PARTY_DIRECTORY, type PartyDirectory } from '../../src/modules/parties/index.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { insertParty, insertSite } from '../support/site-fixtures.ts';
import {
  clearWorkOrderCreation,
  insertScopeItems,
  insertWorkOrders,
  numberOf,
  type ScopeItemSpec,
} from '../support/work-order-fixtures.ts';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp();
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  await clearWorkOrderCreation(current.database.admin);
  await sql`delete from sites.sites`.execute(current.database.admin);
  await sql`delete from parties.parties`.execute(current.database.admin);
  await sql`delete from customers.customers`.execute(current.database.admin);
});

const PATH = '/api/v1/work-orders';
const admin = () => current.database.admin;
const server = () => current.app.getHttpServer();

interface Session {
  readonly userId: string;
  readonly cookie: string;
}
async function signIn(role: Role = 'editor', channel: 'web' | 'mobile' = 'web', displayName?: string): Promise<Session> {
  const user = await createUser(admin(), current.clock, { role, ...(displayName === undefined ? {} : { displayName }) });
  const session = await createSession(admin(), current.clock, user, { channel });
  return { userId: user.id, cookie: session.cookie };
}
const get = (session: Session | undefined, path: string) => {
  const call = request(server()).get(path);
  return session === undefined ? call : call.set('Cookie', session.cookie);
};
const SUFFIXES = ['', '/scope-items', '/customer', '/site'] as const;

interface Scene {
  readonly customerId: string;
  readonly siteId: string;
  readonly osdId: string;
  readonly managerId: string;
  readonly orderId: string;
  readonly coordinator: Session;
}
/** The order ZL-2026-0042 of "Jan Przykładowy" at the garage place 15, level -1, with 9 scope items. */
async function scene(): Promise<Scene> {
  const coordinator = await signIn('editor', 'web', 'Anna Testowa');
  const customerId = await insertCustomer(admin(), {
    firstName: 'Jan',
    lastName: 'Przykładowy',
    phone: '+48600000001',
    email: 'jan@example.invalid',
  });
  const osdId = await insertParty(admin(), {
    displayName: 'Operator Testowy',
    contactPersonName: 'Osoba Kontaktowa',
    phone: '+48600000002',
  });
  const managerId = await insertParty(admin(), { kind: 'property_manager', displayName: 'Zarządca Testowy', notes: 'notatka-strony' });
  const siteId = await insertSite(admin(), {
    siteType: 'multi_family_garage',
    parkingSpotNumber: '15',
    garageLevel: '-1',
    connectionPowerKw: 40,
    meteringPointId: 'PL-TEST-0001',
    osdPartyId: osdId,
    managerPartyId: managerId,
    notes: '<script>alert(1)</script> javascript:alert(1)',
  });
  const ids = await insertWorkOrders(admin(), [
    { number: numberOf(2026, 42), title: 'Garaż — pełny proces', customerId, siteId, coordinatorId: coordinator.userId },
  ]);
  const orderId = ids.get(numberOf(2026, 42)) ?? '';
  await insertScopeItems(
    admin(),
    orderId,
    Array.from({ length: 9 }, (_, index): ScopeItemSpec => ({
      position: index + 1,
      parameterSetCode: index === 0 ? 'charger_spec' : null,
      parameters: index === 0 ? { currentType: 'ac', powerKw: 11, phases: 3 } : {},
    })),
  );
  return { customerId, siteId, osdId, managerId, orderId, coordinator };
}

describe('work order header (EVM-018 AC1, AC5)', () => {
  it('EVM-018 AC1 the header has the number, the title, the status, the customer, the address, the coordinator and the creation time', async () => {
    const s = await scene();
    const reader = await signIn('read_only');
    const response = await get(reader, `${PATH}/${s.orderId}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toEqual({
      id: s.orderId,
      number: 'ZL-2026-0042',
      title: 'Garaż — pełny proces',
      status: 'new',
      customer: { id: s.customerId, displayName: 'Jan Przykładowy' },
      site: {
        id: s.siteId,
        siteType: 'multi_family_garage',
        street: 'ul. Testowa',
        buildingNumber: '7',
        postalCode: '00-001',
        city: 'Warszawa',
        parkingSpotNumber: '15',
        garageLevel: '-1',
      },
      coordinator: { id: s.coordinator.userId, displayName: 'Anna Testowa' },
      allowedTransitions: [], // Tylko odczyt: no transition (EVM-030 AC7)
      version: 1,
      createdAt: expect.stringMatching(/^2026-01-01T08:00:00\.000Z$/) as string,
    });
    expect(response.headers['etag']).toBe('"1"');
  });

  it('EVM-018 AC5 the header carries no contact data, PPE, notes, power or scope (SR-DATA-03)', async () => {
    const s = await scene();
    const response = await get(await signIn('administrator'), `${PATH}/${s.orderId}`);
    const text = JSON.stringify(response.body);
    for (const secret of ['jan@example.invalid', '+48600000001', 'PL-TEST-0001', 'alert(1)', 'scopeItems', 'connectionPowerKw']) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('EVM-018 AC1 a customer, a site or a coordinator that is gone leaves the header with null in its place (no data of a deleted record)', async () => {
    const s = await scene();
    await sql`update customers.customers set deleted_at = now() where id = ${s.customerId}`.execute(admin());
    await sql`update sites.sites set deleted_at = now() where id = ${s.siteId}`.execute(admin());
    await sql`update work_orders.work_order_assignments set deleted_at = now() where work_order_id = ${s.orderId}`.execute(admin());
    const response = await get(await signIn('editor'), `${PATH}/${s.orderId}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ customer: null, site: null, coordinator: null });
    const bare = await insertWorkOrders(admin(), [{ number: numberOf(2026, 5) }]);
    const bareHeader = await get(await signIn('editor'), `${PATH}/${[...bare.values()][0]}`);
    expect(bareHeader.body).toMatchObject({ customer: null, site: null, coordinator: null });
  });

  it('EVM-018 AC5 the customer and the site are not copied into work_orders: the table has no column of their data', async () => {
    const columns = await sql<{ column_name: string }>`
      select column_name from information_schema.columns where table_schema = 'work_orders' and table_name = 'work_orders'`.execute(
      admin(),
    );
    const names = columns.rows.map((row) => row.column_name);
    for (const copied of ['customer_name', 'customer_display_name', 'phone', 'email', 'street', 'city', 'notes', 'metering_point_id']) {
      expect(names, copied).not.toContain(copied);
    }
  });
});

describe('scope (EVM-018 AC2)', () => {
  it('EVM-018 AC2 nine items come in the order of their position with their parameters; a deleted item is not among them', async () => {
    const s = await scene();
    await insertScopeItems(admin(), s.orderId, [{ position: 10, deletedAt: new Date('2026-10-02T08:00:00Z') }]);
    const response = await get(await signIn('read_only'), `${PATH}/${s.orderId}/scope-items`);
    expect(response.status).toBe(200);
    const items = (response.body as { items: Array<{ position: number; parameters: unknown; parameterSetCode: string | null }> }).items;
    expect(items.map((item) => item.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(items[0]).toMatchObject({ parameterSetCode: 'charger_spec', parameters: { currentType: 'ac', powerKw: 11, phases: 3 } });
    expect(Object.keys(items[0] ?? {}).sort()).toEqual(['code', 'id', 'name', 'parameterSetCode', 'parameters', 'position', 'quantity']);
  });

  it('EVM-018 AC2 an order without items answers an empty list', async () => {
    const ids = await insertWorkOrders(admin(), [{ number: numberOf(2026, 1) }]);
    const response = await get(await signIn('editor'), `${PATH}/${[...ids.values()][0]}/scope-items`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [] });
  });
});

describe('cards (EVM-018 AC1, AC4, AC5)', () => {
  it('EVM-018 AC1 AC5 the customer card has the name, the telephone and the e-mail and nothing else', async () => {
    const s = await scene();
    await sql`update customers.customers set notes = 'notatka-klienta', tax_id = null where id = ${s.customerId}`.execute(admin());
    const response = await get(await signIn('editor'), `${PATH}/${s.orderId}/customer`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ displayName: 'Jan Przykładowy', phone: '+48600000001', email: 'jan@example.invalid' });
  });

  it('EVM-018 AC1 the customer card has a null e-mail when the customer has none', async () => {
    const customerId = await insertCustomer(admin(), {});
    const ids = await insertWorkOrders(admin(), [{ number: numberOf(2026, 2), customerId }]);
    const response = await get(await signIn('editor'), `${PATH}/${[...ids.values()][0]}/customer`);
    expect(response.body).toEqual({ displayName: 'Jan Przykładowy', phone: '+48600000001', email: null });
  });

  it('EVM-018 AC1 AC4 AC5 the site card has the type, the address, the spot, the power, the PPE, the notes as text and the parties as {id, displayName}', async () => {
    const s = await scene();
    const response = await get(await signIn('read_only'), `${PATH}/${s.orderId}/site`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toEqual({
      siteType: 'multi_family_garage',
      street: 'ul. Testowa',
      buildingNumber: '7',
      postalCode: '00-001',
      city: 'Warszawa',
      parkingSpotNumber: '15',
      garageLevel: '-1',
      connectionPowerKw: 40,
      meteringPointId: 'PL-TEST-0001',
      notes: '<script>alert(1)</script> javascript:alert(1)',
      distributionSystemOperator: { id: s.osdId, displayName: 'Operator Testowy' },
      manager: { id: s.managerId, displayName: 'Zarządca Testowy' },
    });
    const text = JSON.stringify(response.body);
    for (const secret of ['Osoba Kontaktowa', '+48600000002', 'notatka-strony']) expect(text, secret).not.toContain(secret);
  });

  it('EVM-018 AC5 the names of the two parties are asked in ONE batch call to the parties facade', async () => {
    const s = await scene();
    const spy = vi.spyOn(current.app.get<PartyDirectory>(PARTY_DIRECTORY), 'namesOf');
    await get(await signIn('editor'), `${PATH}/${s.orderId}/site`);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[2]).toEqual([s.osdId, s.managerId]);
    spy.mockRestore();
  });

  it('EVM-018 AC1 a deleted party leaves null in its place; a site without parties has two nulls', async () => {
    const s = await scene();
    await sql`update parties.parties set deleted_at = now() where id = ${s.managerId}`.execute(admin());
    const response = await get(await signIn('editor'), `${PATH}/${s.orderId}/site`);
    expect(response.body).toMatchObject({ distributionSystemOperator: { id: s.osdId }, manager: null });
    const bare = await insertSite(admin(), {});
    const ids = await insertWorkOrders(admin(), [{ number: numberOf(2026, 3), siteId: bare }]);
    const plain = await get(await signIn('editor'), `${PATH}/${[...ids.values()][0]}/site`);
    expect(plain.body).toMatchObject({ distributionSystemOperator: null, manager: null });
    expect(Object.keys(plain.body as object)).not.toContain('notes');
  });

  it('EVM-018 AC3 a deleted customer or site is 404 on its card, the same answer as a missing one', async () => {
    const s = await scene();
    await sql`update customers.customers set deleted_at = now() where id = ${s.customerId}`.execute(admin());
    await sql`update sites.sites set deleted_at = now() where id = ${s.siteId}`.execute(admin());
    const reader = await signIn('read_only');
    for (const suffix of ['/customer', '/site']) {
      const response = await get(reader, `${PATH}/${s.orderId}${suffix}`);
      expect(response.status, suffix).toBe(404);
      expect((response.body as { code: string }).code).toBe('not_found');
    }
    const bare = await insertWorkOrders(admin(), [{ number: numberOf(2026, 4) }]);
    for (const suffix of ['/customer', '/site']) {
      expect((await get(reader, `${PATH}/${[...bare.values()][0]}${suffix}`)).status, suffix).toBe(404);
    }
  });
});

describe('not found and IDOR (EVM-018 AC3, AC6; SR-AUTHZ-02, TM-17)', () => {
  it('EVM-018 AC3 a missing order and a deleted one are the same 404 not_found for the Administrator, the Editor and Read-only, on all four reads', async () => {
    const [deleted] = [
      ...(await insertWorkOrders(admin(), [{ number: numberOf(2026, 7), deletedAt: new Date('2026-10-02T08:00:00Z') }])).values(),
    ];
    const bodies = new Set<string>();
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const session = await signIn(role);
      for (const id of [randomUUID(), deleted ?? '']) {
        for (const suffix of SUFFIXES) {
          const response = await get(session, `${PATH}/${id}${suffix}`);
          expect(response.status, `${role} ${suffix}`).toBe(404);
          expect((response.body as { code: string }).code).toBe('not_found');
          expect(response.headers['content-type']).toContain('application/problem+json');
          bodies.add(
            JSON.stringify(response.body)
              .replace(/"traceId":"[0-9a-f]+"/, '')
              .replace(id, 'ID'),
          );
        }
      }
    }
    expect(bodies.size).toBe(1); // no way to tell "missing" from "deleted", no value in the answer
  });

  it('EVM-018 AC3 AC6 the answers for order A never contain the data of order B (other customer, site and scope)', async () => {
    const a = await scene();
    const customerB = await insertCustomer(admin(), {
      firstName: 'Ewa',
      lastName: 'Inna',
      phone: '+48600000999',
      email: 'ewa@example.invalid',
    });
    const siteB = await insertSite(admin(), { street: 'ul. Obca', city: 'Gdańsk', meteringPointId: 'PL-TEST-B', notes: 'notatka-B' });
    const idsB = await insertWorkOrders(admin(), [
      { number: numberOf(2026, 43), title: 'Zlecenie B', customerId: customerB, siteId: siteB },
    ]);
    const orderB = [...idsB.values()][0] ?? '';
    await insertScopeItems(admin(), orderB, [{ position: 1, name: 'Pozycja-B-sekret' }]);
    const reader = await signIn('administrator');
    for (const suffix of SUFFIXES) {
      const own = JSON.stringify((await get(reader, `${PATH}/${a.orderId}${suffix}`)).body);
      for (const foreign of [
        'Ewa',
        'Inna',
        '+48600000999',
        'ewa@example.invalid',
        'Gdańsk',
        'PL-TEST-B',
        'notatka-B',
        'Pozycja-B-sekret',
        'Zlecenie B',
      ]) {
        expect(own, `${suffix} ${foreign}`).not.toContain(foreign);
      }
    }
    // the items of B are read only through B
    const itemsB = await get(reader, `${PATH}/${orderB}/scope-items`);
    expect(JSON.stringify(itemsB.body)).toContain('Pozycja-B-sekret');
  });

  it('EVM-018 AC3 the customer and the site come from the row of the order: a customer id in the query string changes nothing', async () => {
    const a = await scene();
    const other = await insertCustomer(admin(), { firstName: 'Ewa', lastName: 'Inna' });
    const response = await get(await signIn('editor'), `${PATH}/${a.orderId}/customer?customerId=${other}`);
    expect(response.status).toBe(400);
    expect((response.body as { code: string }).code).toBe('unknown_parameter');
  });

  it('EVM-018 AC3 a malformed identifier is 400 validation_failed on all four reads', async () => {
    const session = await signIn('editor');
    for (const suffix of SUFFIXES) {
      const response = await get(session, `${PATH}/not-a-uuid${suffix}`);
      expect(response.status, suffix).toBe(400);
      expect((response.body as { code: string }).code).toBe('validation_failed');
    }
  });
});

describe('roles, channels and headers (EVM-018 AC6; SR-AUTHZ-05, SR-API-01)', () => {
  it('EVM-018 AC6 the Administrator, the Editor and Read-only see all four sections; an anonymous caller gets 401', async () => {
    const s = await scene();
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const session = await signIn(role);
      for (const suffix of SUFFIXES) expect((await get(session, `${PATH}/${s.orderId}${suffix}`)).status, `${role} ${suffix}`).toBe(200);
    }
    for (const suffix of SUFFIXES) {
      const response = await get(undefined, `${PATH}/${s.orderId}${suffix}`);
      expect(response.status, suffix).toBe(401);
      expect((response.body as { code: string }).code).toBe('unauthenticated');
    }
  });

  it('EVM-018 AC6 a mobile session gets 403 channel_not_allowed on all four reads (the app uses the synchronisation)', async () => {
    const s = await scene();
    const mobile = await signIn('editor', 'mobile');
    for (const suffix of SUFFIXES) {
      const response = await get(mobile, `${PATH}/${s.orderId}${suffix}`);
      expect(response.status, suffix).toBe(403);
      expect((response.body as { code: string }).code).toBe('forbidden');
    }
  });

  it('EVM-018 AC5 every answer — 200, 400, 404 and 401 — is Cache-Control: no-store, and a read leaves no audit record', async () => {
    const s = await scene();
    const session = await signIn('editor');
    const before = await sql<{ n: string }>`select count(*)::text as n from audit.events`.execute(admin());
    const answers = [
      await get(session, `${PATH}/${s.orderId}`),
      await get(session, `${PATH}/${s.orderId}/site`),
      await get(session, `${PATH}/${randomUUID()}`),
      await get(session, `${PATH}/nope/customer`),
      await get(undefined, `${PATH}/${s.orderId}`),
    ];
    for (const response of answers) expect(response.headers['cache-control'], String(response.status)).toBe('no-store');
    const after = await sql<{ n: string }>`select count(*)::text as n from audit.events`.execute(admin());
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });
});
