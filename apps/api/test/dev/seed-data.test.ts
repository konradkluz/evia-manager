/**
 * The demo data are plainly fictional and well-formed (EVM-077 AC7; P9, SR-PRIV-08) — checked on the data themselves.
 */
import { zCustomerWritable, zPartyWritable, zSiteWritable } from '@evia/contracts/zod';
import { describe, expect, it } from 'vitest';
import { normalizePhone } from '../../src/platform/input/phone.ts';
import { CUSTOMERS, demoId, ORDERS, PARTIES, PATH, SITES } from '../../dev/seed/data.ts';

const everything = JSON.stringify({ CUSTOMERS, PARTIES, SITES, ORDERS });

describe('demo data (EVM-077 AC7)', () => {
  it('EVM-077 AC7: e-mail addresses are in reserved test domains, telephones are in an unassigned range, no PESEL or tax number', () => {
    const emails = [...CUSTOMERS, ...PARTIES].flatMap((record) => ('email' in record ? [record.email] : []));
    expect(emails.length).toBeGreaterThan(3);
    for (const email of emails) expect(email).toMatch(/@example\.(test|invalid)$/);
    const phones = [...CUSTOMERS, ...PARTIES].flatMap((record) => ('phone' in record ? [record.phone] : []));
    for (const phone of phones) {
      expect(normalizePhone(phone)).toBe(phone);
      expect(phone).toMatch(/^\+48000/);
    }
    expect(everything).not.toMatch(/pesel|taxId|nip/i);
    // an 11-digit number outside the telephones would look like a PESEL
    const withoutIdsAndPhones = everything.replace(/"phone":"\+\d+"/g, '').replace(/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/g, '');
    expect(withoutIdsAndPhones).not.toMatch(/\d{11}/);
  });

  it('EVM-077 AC7: every record is valid for the contract (what the panel sends), with a UUIDv7-shaped fixed identifier', () => {
    for (const customer of CUSTOMERS) expect(zCustomerWritable.safeParse(customer).success, customer.id).toBe(true);
    for (const party of PARTIES) expect(zPartyWritable.safeParse(party).success, party.id).toBe(true);
    for (const site of SITES) expect(zSiteWritable.safeParse(site).success, site.id).toBe(true);
    const ids = [...CUSTOMERS, ...PARTIES, ...SITES, ...ORDERS].map((record) => record.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(demoId(2, 255)).toBe('01990000-0000-7000-8000-0002000000ff');
  });

  it('EVM-077 AC7: persons and companies, several sites with parties, orders in different statuses and two orders at one site', () => {
    expect(new Set(CUSTOMERS.map((customer) => customer.kind))).toEqual(new Set(['person', 'company']));
    expect(SITES.some((site) => 'managerPartyId' in site || 'distributionSystemOperatorPartyId' in site)).toBe(true);
    expect(new Set(ORDERS.map((order) => order.status))).toEqual(new Set(['new', 'quoting', 'accepted', 'in_progress', 'completed']));
    const bySite = new Map<number, number>();
    for (const order of ORDERS) bySite.set(order.site, (bySite.get(order.site) ?? 0) + 1);
    expect(Math.max(...bySite.values())).toBeGreaterThanOrEqual(2);
    for (const order of ORDERS) {
      expect(CUSTOMERS[order.customer]).toBeDefined();
      expect(SITES[order.site]).toBeDefined();
      expect(PATH[order.status]).toBeDefined();
    }
  });
});
