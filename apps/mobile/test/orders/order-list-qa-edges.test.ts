import { buildOrderList, filterOrders, redactRows, type OrderListSource } from '../../src/orders/order-list-model';
import { normalizeSearch } from '../../src/orders/normalize';

// Synthetic data only (GDPR). QA edge cases of the offline list search (EVM-103 AC2, AC3, AC5).
const source: OrderListSource = {
  orders: [
    { id: 'o1', number: 'ZL-2026-0001', status: 'new', createdAt: 100, customerId: 'c1', siteId: 's1' },
    { id: 'o2', number: 'ZL-2026-0002', status: 'new', createdAt: 100, customerId: 'c2', siteId: 's2' },
    { id: 'o3', number: 'ZL-2026-0003', status: 'new', createdAt: 300, customerId: null, siteId: null },
  ],
  customers: [
    { id: 'c1', displayName: 'Zażółć Gęślą Jaźń Sp. z o.o.' },
    { id: 'c2', displayName: "O'Brien & Synowie" },
  ],
  sites: [
    { id: 's1', street: 'Świętokrzyska', buildingNumber: '5/7', city: 'Łódź', parkingSpot: 'P-12' },
    { id: 's2', street: 'Żółkiewskiego', buildingNumber: '1', city: 'Gdańsk', parkingSpot: '' },
  ],
  stages: [],
};

describe('order list QA edge cases (EVM-103)', () => {
  it('EVM-103 AC2: all Polish capital and small letters fold to ASCII', () => {
    expect(normalizeSearch('ĄĆĘŁŃÓŚŹŻ')).toBe('acelnoszz');
    expect(normalizeSearch('ąćęłńóśźż')).toBe('acelnoszz');
  });

  it('EVM-103 AC2: a decomposed (NFD) query finds the composed text', () => {
    const rows = buildOrderList(source, []);
    expect(filterOrders(rows, 'Źołkiewskiego', 'all').map((r) => r.id)).toEqual(['o2']);
  });

  it('EVM-103 AC2: multi-word address, slash and apostrophe match literally; a wrong word order does not', () => {
    const rows = buildOrderList(source, []);
    expect(filterOrders(rows, 'swietokrzyska 5/7 lodz', 'all').map((r) => r.id)).toEqual(['o1']);
    expect(filterOrders(rows, "o'brien", 'all').map((r) => r.id)).toEqual(['o2']);
    expect(filterOrders(rows, '5/7 swietokrzyska', 'all')).toEqual([]);
  });

  it('EVM-103 AC1: equal creation dates give a stable order by id, whatever the input order', () => {
    const reversed: OrderListSource = { ...source, orders: [...source.orders].reverse() };
    expect(buildOrderList(reversed, []).map((r) => r.id)).toEqual(['o3', 'o1', 'o2']);
    expect(buildOrderList(source, []).map((r) => r.id)).toEqual(['o3', 'o1', 'o2']);
  });

  it('EVM-103 AC5: a redacted model matches no query and leaks no keys', () => {
    const redacted = redactRows(buildOrderList(source, []));
    expect(filterOrders(redacted, 'lodz', 'all')).toEqual([]);
    expect(filterOrders(redacted, 'ZL-2026', 'all')).toEqual([]);
    expect(JSON.stringify(redacted)).not.toMatch(/Łódź|Świętokrzyska|Zażółć|P-12/);
  });
});
