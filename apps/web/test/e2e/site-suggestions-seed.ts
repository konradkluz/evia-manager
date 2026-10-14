import type { MockApi } from './mock-api.ts';

export const GARAGE_ID = '01968f3e-0000-7000-8000-00000000bbb1';
export const HOUSE_ID = '01968f3e-0000-7000-8000-00000000bbb2';

/** Jan Przykładowy has three earlier orders: two in the garage, one in the house (the server lists the newest first). */
export function seedJanOrders(api: MockApi) {
  const jan = api.customers[0]?.id ?? '';
  const order = (index: number, siteId: string) => ({
    id: `01968f3e-0000-7000-8000-0000000200${String(index).padStart(2, '0')}`,
    number: `ZL-2026-01${String(index).padStart(2, '0')}`,
    title: 'Montaż wallboxa',
    customerId: jan,
    siteId,
    templateId: null,
    assigneeUserId: '11111111-1111-4111-8111-111111111111',
    plannedDate: undefined,
    description: undefined,
    scopeItems: 0,
  });
  api.orders.created.push(order(1, GARAGE_ID), order(2, HOUSE_ID), order(3, GARAGE_ID));
}
