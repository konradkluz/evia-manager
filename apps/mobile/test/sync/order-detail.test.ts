import { must, NOW, Phone, ScriptedServer, USER, aggregate, notePayload, page, settle, uid } from './harness';

// EVM-104 AC1, AC4, AC5 (security K4, K5, K10): the details of the session service - replica and queue, never the server.
let phone: Phone;
beforeEach(async () => {
  phone = new Phone();
  await phone.open();
});
afterEach(() => {
  phone.close();
});

const QUICK_ID = '3b000000-0000-4000-8000-0000000000b1';
const ORDER_1 = uid('work_order', 1);
const ORDER_2 = uid('work_order', 2);

const stage = (n: number, workOrder: number, status: string): Record<string, unknown> => ({
  op: 'upsert',
  entity: {
    type: 'procedure_stage',
    id: `5a000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    version: 1,
    workOrderId: uid('work_order', workOrder),
    procedureId: `6a000000-0000-4000-8000-${String(workOrder).padStart(12, '0')}`,
    procedureCode: 'P',
    code: `S${String(n)}`,
    procedureName: `Process ${String(workOrder)}`,
    name: `Stage ${String(n)}`,
    position: n,
    status,
    waitingOn: null,
    waitingPartyId: null,
    waitingSince: null,
    dueDate: null,
    responsibleUserId: null,
    blockedReason: null,
    startedAt: null,
    completedOn: null,
  },
});

/** Two synced orders, stages for each, then the network is lost. */
async function loaded() {
  const server = new ScriptedServer();
  server.changes.push(
    page([...aggregate(1), ...aggregate(2), stage(1, 1, 'in_progress'), stage(2, 2, 'todo')], { phase: 'snapshot', cursor: 1 }),
    page([], { cursor: 2 }),
  );
  const service = phone.service(server);
  await service.start();
  await settle();
  phone.online = false;
  service.setOnline(false);
  await settle();
  return { server, service };
}

describe('SyncService.orderDetail (EVM-104)', () => {
  it('EVM-104 AC1: the details come from the local database - the transport is not touched, also without a network', async () => {
    const { server, service } = await loaded();
    const before = { pulls: server.changeRequests.length, pushes: server.pushes.length };
    const detail = must(await service.orderDetail(ORDER_1));
    expect(detail).toMatchObject({ number: 'ZL-1', title: 'Order 1', status: 'in_progress' });
    expect(detail.customer).toMatchObject({ name: 'Customer 1' });
    expect(detail.processes.map((p) => p.stages.map((s) => s.name))).toEqual([['Stage 1']]);
    expect({ pulls: server.changeRequests.length, pushes: server.pushes.length }).toEqual(before);
  });

  it('EVM-104 AC4 (security K5): only notes and comments of this order come from the queue - not another order and not a quick order', async () => {
    const { service } = await loaded();
    await service.enqueue({ type: 'CreateNote', commandVersion: 1, payload: notePayload(1, ORDER_1) });
    await service.enqueue({ type: 'CreateNote', commandVersion: 1, payload: notePayload(2, ORDER_2) });
    await service.enqueue({
      type: 'CreateQuickWorkOrder',
      commandVersion: 1,
      payload: {
        workOrderId: QUICK_ID,
        title: 'SYNTHETIC-QUICK-TITLE',
        newCustomer: { displayName: 'Zofia Świętosławska', phone: '+48000000000' },
        newSite: { street: 'ul. Nowa', buildingNumber: '3', city: 'Gdynia', postalCode: '81-000', parkingSpotNumber: 'B-12' },
      },
    });
    const detail = must(await service.orderDetail(ORDER_1));
    expect(detail.journal.map((j) => [j.source, j.body])).toEqual([['pending', 'synthetic note 1']]);
    expect(JSON.stringify(detail)).not.toMatch(/synthetic note 2|SYNTHETIC-QUICK|Świętosławska/);
  });

  it('EVM-104 AC4: a note of the owner only - entries of another user never show', async () => {
    const { service } = await loaded();
    await service.enqueue({ type: 'CreateNote', commandVersion: 1, payload: notePayload(1, ORDER_1) });
    const other = phone.service(new ScriptedServer(), {}, 'someone-else-synthetic');
    expect(must(await other.orderDetail(ORDER_1)).journal).toEqual([]);
    expect(USER).not.toBe('someone-else-synthetic');
  });

  it('EVM-104 AC5 (security K4): after a tombstone the order is unavailable and its queue item stays in the queue', async () => {
    const server = new ScriptedServer();
    const removal = page([{ op: 'delete', type: 'work_order', id: ORDER_1, version: 9 }], { cursor: 3 });
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
    expect(must(await service.orderDetail(ORDER_1)).number).toBe('ZL-1');
    phone.online = false;
    service.setOnline(false);
    await service.enqueue({ type: 'CreateNote', commandVersion: 1, payload: notePayload(1, ORDER_1) });
    phone.online = true;
    service.setOnline(true);
    release();
    service.trigger('manual');
    await settle();
    expect(await service.orderDetail(ORDER_1)).toBeNull();
    expect(must(await service.orderDetail(ORDER_2)).number).toBe('ZL-2');
    expect((await service.queueView(false)).items).toHaveLength(1);
    expect(NOW).toBeGreaterThan(0);
  });

  it('EVM-104 AC5: an order that was never in the replica is unavailable', async () => {
    const { service } = await loaded();
    expect(await service.orderDetail('3f000000-0000-4000-8000-0000000000ff')).toBeNull();
  });

  it('EVM-104 AC1: after a restart of the process the same details come back from the encrypted database', async () => {
    const { service } = await loaded();
    await service.enqueue({ type: 'CreateNote', commandVersion: 1, payload: notePayload(1, ORDER_1) });
    const before = await service.orderDetail(ORDER_1);
    service.dispose();
    await phone.restart();
    const again = phone.service(new ScriptedServer());
    expect(await again.orderDetail(ORDER_1)).toEqual(before);
  });

  it('EVM-104 AC1 (security K10): one read - a fixed number of statements, the id of the order only as a bound parameter', async () => {
    const { service } = await loaded();
    phone.engine.statements.length = 0;
    await service.orderDetail(ORDER_1);
    const sql = phone.engine.statements.join('\n');
    expect(sql).not.toContain(ORDER_1);
    expect(phone.engine.statements.filter((s) => /^\s*SELECT/i.test(s)).length).toBeLessThanOrEqual(12);
  });
});
