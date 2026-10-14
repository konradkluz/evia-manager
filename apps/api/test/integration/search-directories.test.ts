import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CustomerDirectoryService } from '../../src/modules/customers/application/customer-directory.service.ts';
import { SiteDirectoryService } from '../../src/modules/sites/application/site-directory.service.ts';
import { WorkOrderDirectoryService } from '../../src/modules/work-orders/application/work-order-directory.service.ts';
import { principal } from '../support/principals.ts';
import { clearCustomers, insertCustomer } from '../support/customer-fixtures.ts';
import { clearSitesAndParties, insertSite } from '../support/site-fixtures.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
beforeAll(async () => {
  database = await migratedDatabase();
});
afterAll(async () => {
  await database.close();
});

const admin = () => database.admin;
const orders = new WorkOrderDirectoryService();
const customers = new CustomerDirectoryService();
const sites = new SiteDirectoryService();
const caller = principal({ role: 'editor' });

beforeEach(async () => {
  await sql`delete from work_orders.work_order_assignments`.execute(admin());
  await sql`delete from work_orders.work_orders`.execute(admin());
  await clearCustomers(admin());
  await clearSitesAndParties(admin());
});

describe('the search and display facades of the three modules (EVM-072 AC2, AC5; ADR-0017 W1, W2)', () => {
  it('EVM-072 AC2 WorkOrderDirectory.searchIds finds by number and by title, ignoring case and accents, and never a deleted order', async () => {
    const ids = await insertWorkOrders(admin(), [
      { number: 'ZL-2026-0042', title: 'Garaż — pełny' },
      { number: 'ZL-2026-0043', title: 'Przyłącze' },
      { number: 'ZL-2026-0044', title: 'Garaż usunięty', deletedAt: new Date('2026-10-02T08:00:00Z') },
    ]);
    expect(await orders.searchIds(admin(), caller, '0042', 11)).toEqual([ids.get('ZL-2026-0042')]);
    expect(await orders.searchIds(admin(), caller, 'GARAZ - PELNY', 11)).toEqual([ids.get('ZL-2026-0042')]);
    expect(await orders.searchIds(admin(), caller, 'garaż — pełny', 11)).toEqual([ids.get('ZL-2026-0042')]);
    expect(await orders.searchIds(admin(), caller, 'garaż', 11)).toEqual([ids.get('ZL-2026-0042')]);
  });

  it('EVM-072 AC2 the phrase is data: %, _ and \\ match literally and a full-width look-alike is not a pattern', async () => {
    await insertWorkOrders(admin(), [
      { number: 'ZL-2026-0001', title: 'Rabat 50% na montaż' },
      { number: 'ZL-2026-0002', title: 'Rabat 500 na montaż' },
      { number: 'ZL-2026-0003', title: 'Linia_A' },
      { number: 'ZL-2026-0004', title: 'LiniaXA' },
    ]);
    expect(await orders.searchIds(admin(), caller, '50%', 11)).toHaveLength(1);
    expect(await orders.searchIds(admin(), caller, 'linia_a', 11)).toHaveLength(1);
    expect(await orders.searchIds(admin(), caller, '％％％', 11)).toHaveLength(0);
    expect(await orders.searchIds(admin(), caller, 'a\\b', 11)).toHaveLength(0);
  });

  it('EVM-072 AC6 the limit bounds the answer (the caller asks for one more than it accepts)', async () => {
    await insertWorkOrders(
      admin(),
      Array.from({ length: 5 }, (_, index) => ({ number: `ZL-2026-${String(index + 1).padStart(4, '0')}`, title: 'Wspólny tytuł' })),
    );
    expect(await orders.searchIds(admin(), caller, 'wspólny', 3)).toHaveLength(3);
  });

  it('EVM-072 AC2 CustomerDirectory.searchIds finds by name, city and telephone digits, not a deleted customer; displayNamesOf omits a deleted one', async () => {
    const jan = await insertCustomer(admin(), { lastName: 'Przykładowy', city: 'Łódź', phone: '+48600000001' });
    const deleted = await insertCustomer(admin(), { lastName: 'Przykładowska', deletedAt: '2026-10-05T08:00:00Z' });
    expect(await customers.searchIds(admin(), caller, 'przykladowy', 11)).toEqual([jan]);
    expect(await customers.searchIds(admin(), caller, 'Lodz', 11)).toEqual([jan]);
    expect(await customers.searchIds(admin(), caller, '+48 600 000 001', 11)).toEqual([jan]);
    expect(await customers.searchIds(admin(), caller, 'przykladowska', 11)).toEqual([]);
    expect(await customers.searchIds(admin(), caller, 'ab', 11)).toEqual([]);
    const names = await customers.displayNamesOf(admin(), caller, [jan, deleted]);
    expect([...names.keys()]).toEqual([jan]);
    expect(names.get(jan)).toContain('Przykładowy');
    expect((await customers.displayNamesOf(admin(), caller, [])).size).toBe(0);
  });

  it('EVM-072 AC1 SiteDirectory.searchIds finds "Lodz" and "zolkiewskiego"; linesOf returns the city, the street and the building number only', async () => {
    const site = await insertSite(admin(), {
      street: 'ul. Żółkiewskiego',
      buildingNumber: '12',
      apartmentNumber: '5',
      postalCode: '91-001',
      city: 'Łódź',
      siteType: 'multi_family_garage',
      parkingSpotNumber: 'P-17',
    });
    const gone = await insertSite(admin(), { city: 'Łódź', street: 'ul. Usunięta', deletedAt: '2026-10-05T08:00:00Z' });
    expect(await sites.searchIds(admin(), caller, 'zolkiewskiego', 11)).toEqual([site]);
    expect(await sites.searchIds(admin(), caller, 'lodz', 11)).toEqual([site]);
    const lines = await sites.linesOf(admin(), caller, [site, gone]);
    expect([...lines.keys()]).toEqual([site]);
    expect(lines.get(site)).toEqual({ id: site, city: 'Łódź', street: 'ul. Żółkiewskiego', buildingNumber: '12' });
    expect((await sites.linesOf(admin(), caller, [])).size).toBe(0);
  });

  it('EVM-055 AC3 WorkOrderDirectory.refsOf gives the number, the title and the customer of the visible orders only: a deleted order and an unknown identifier are absent, for every role', async () => {
    const customerId = await insertCustomer(admin(), { lastName: 'Zamawiający' });
    const ids = await insertWorkOrders(admin(), [
      { number: 'ZL-2026-0101', title: 'Widoczne', customerId },
      { number: 'ZL-2026-0102', title: 'Bez klienta' },
      { number: 'ZL-2026-0103', title: 'Usunięte', deletedAt: new Date('2026-10-02T08:00:00Z') },
    ]);
    const idOf = (number: string): string => ids.get(number) ?? '';
    const [visible, withoutCustomer, deleted] = [idOf('ZL-2026-0101'), idOf('ZL-2026-0102'), idOf('ZL-2026-0103')] as [
      string,
      string,
      string,
    ];
    const unknown = '0190a1b2-0000-7000-8000-0000000000ff';
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const refs = await orders.refsOf(admin(), principal({ role }), [visible, withoutCustomer, deleted, unknown, visible]);
      expect([...refs.keys()].sort()).toEqual([visible, withoutCustomer].sort());
      expect(refs.get(visible)).toEqual({ number: 'ZL-2026-0101', title: 'Widoczne', customerId });
      expect(refs.get(withoutCustomer)).toEqual({ number: 'ZL-2026-0102', title: 'Bez klienta', customerId: null });
    }
    expect((await orders.refsOf(admin(), caller, [])).size).toBe(0);
  });

  it('EVM-055 AC3 refsOf takes the identifiers as ONE array parameter: thousands of identifiers are one statement', async () => {
    const ids = await insertWorkOrders(admin(), [{ number: 'ZL-2026-0201' }]);
    const many = Array.from({ length: 5000 }, (_, index) => `0190a1b2-0000-7000-8000-${String(index).padStart(12, '0')}`);
    const refs = await orders.refsOf(admin(), caller, [...many, ids.get('ZL-2026-0201') ?? '']);
    expect([...refs.keys()]).toEqual([ids.get('ZL-2026-0201')]);
  });
});
