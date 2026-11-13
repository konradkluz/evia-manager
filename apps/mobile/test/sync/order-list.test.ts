import { filterOrders } from '../../src/orders/order-list-model';
import { must, NOW, Phone, ScriptedServer, USER, aggregate, notePayload, page, settle, uid } from './harness';

// EVM-103 AC1, AC3, AC5, AC6: the list of the session service - replica and queue, never the server.
let phone: Phone;
beforeEach(async () => {
  phone = new Phone();
  await phone.open();
});
afterEach(() => {
  phone.close();
});

const QUICK_ID = '3b000000-0000-4000-8000-0000000000b1';
const quick = (title = 'SYNTHETIC-QUICK-TITLE') => ({
  type: 'CreateQuickWorkOrder' as const,
  commandVersion: 1,
  payload: {
    workOrderId: QUICK_ID,
    title,
    newCustomer: { displayName: 'Zofia Świętosławska', phone: '+48000000000' },
    newSite: { street: 'ul. Nowa', buildingNumber: '3', city: 'Gdynia', postalCode: '81-000', parkingSpotNumber: 'B-12' },
  },
});

/** A phone with two synced work orders that then loses the network. */
async function loaded() {
  const server = new ScriptedServer();
  server.changes.push(page([...aggregate(1), ...aggregate(2)], { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }));
  const service = phone.service(server);
  await service.start();
  await settle();
  phone.online = false;
  service.setOnline(false);
  await settle();
  return { server, service };
}

describe('SyncService.orderList (EVM-103)', () => {
  it('EVM-103 AC1: the list comes from the local database - the transport is not touched, also without a network', async () => {
    const { server, service } = await loaded();
    const before = { pulls: server.changeRequests.length, pushes: server.pushes.length, order: [...server.order] };
    const rows = await service.orderList(true);
    expect(rows.map((r) => r.number)).toEqual(['ZL-1', 'ZL-2']);
    expect(rows[0]).toMatchObject({ customer: 'Customer 1', street: 'Test street 1', city: 'Testville', status: 'in_progress' });
    expect({ pulls: server.changeRequests.length, pushes: server.pushes.length, order: server.order }).toEqual(before);
  });

  it('EVM-103 AC1: a work order that left the scope (a tombstone after a synchronization) is gone from the list and from the results', async () => {
    const server = new ScriptedServer();
    const removal = page([{ op: 'delete', type: 'work_order', id: uid('work_order', 1), version: 9 }], { cursor: 3 });
    let release: () => void = () => undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.changes.push(page([...aggregate(1), ...aggregate(2)], { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }), async () => {
      await wait;
      return removal;
    });
    const service = phone.service(server);
    await service.start();
    await settle();
    expect((await service.orderList(true)).map((r) => r.number)).toEqual(['ZL-1', 'ZL-2']);
    release();
    service.trigger('manual');
    await settle();
    const rows = await service.orderList(true);
    expect(rows.map((r) => r.number)).toEqual(['ZL-2']);
    expect(filterOrders(rows, 'zl-1', 'all')).toEqual([]);
  });

  it('EVM-103 AC3: a quick work order in the queue is a row "Oczekuje na numer" with its customer and place; a note marks its order as unsent', async () => {
    const { service } = await loaded();
    expect((await service.enqueue(quick())).ok).toBe(true);
    expect((await service.enqueue({ type: 'CreateNote', commandVersion: 1, payload: notePayload(1, uid('work_order', 2)) })).ok).toBe(true);
    const rows = await service.orderList(true);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.id === QUICK_ID)).toMatchObject({
      number: null,
      awaitingNumber: true,
      unsent: true,
      customer: 'Zofia Świętosławska',
      street: 'ul. Nowa 3',
      city: 'Gdynia',
      spot: 'B-12',
    });
    expect(rows.find((r) => r.number === 'ZL-2')?.unsent).toBe(true);
    expect(rows.find((r) => r.number === 'ZL-1')?.unsent).toBe(false);
    expect(JSON.stringify(rows)).not.toContain('SYNTHETIC-QUICK-TITLE');
    expect(filterOrders(rows, 'gdynia', 'all').map((r) => r.id)).toEqual([QUICK_ID]);
    expect(filterOrders(rows, 'swietoslawska', 'unsent').map((r) => r.id)).toEqual([QUICK_ID]);
  });

  it('EVM-103 AC5: in the hidden-data mode no name, address or place is read, from the replica or from the queue (SQL and result)', async () => {
    const { service } = await loaded();
    await service.enqueue(quick());
    phone.engine.statements.length = 0;
    const rows = await service.orderList(false);
    const sql = phone.engine.statements.join('\n');
    expect(sql).not.toMatch(/displayName|street|city|parkingSpotNumber|customerId|siteId|customer|site\b/);
    expect(JSON.stringify(rows)).not.toMatch(/Customer|Test street|Testville|Świętosławska|Nowa|Gdynia|B-12|SYNTHETIC|\+48/);
    expect(rows.map((r) => [r.number, r.awaitingNumber, r.unsent])).toEqual([
      [null, true, true],
      ['ZL-1', false, false],
      ['ZL-2', false, false],
    ]);
    for (const r of rows) expect([r.customer, r.street, r.city, r.spot, r.stage]).toEqual(['', '', '', '', '']);
  });

  it("EVM-103 AC6: only the entries of the signed-in owner count (another user's queue entries never mark or add rows)", async () => {
    const { service } = await loaded();
    await service.enqueue(quick());
    const other = phone.service(new ScriptedServer(), {}, 'someone-else-synthetic');
    expect(must(await other.orderList(true)).map((r) => r.id)).not.toContain(QUICK_ID);
    expect((await service.orderList(true)).map((r) => r.id)).toContain(QUICK_ID);
    expect(USER).not.toBe('someone-else-synthetic');
  });

  it('EVM-103 AC1: after a restart of the process the same list comes back from the encrypted database (queue and replica)', async () => {
    const { service } = await loaded();
    await service.enqueue(quick());
    const before = await service.orderList(true);
    service.dispose();
    await phone.restart();
    const again = phone.service(new ScriptedServer());
    expect(await again.orderList(true)).toEqual(before);
    expect(NOW).toBeGreaterThan(0);
  });
});
