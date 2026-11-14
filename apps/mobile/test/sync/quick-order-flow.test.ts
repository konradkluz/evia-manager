import { zSyncMutationsRequest } from '@evia/contracts/zod';
import { createUuidV7 } from '@evia/sync-core';
import { webcrypto } from 'node:crypto';
import { buildEntryInput, type EntryDraft } from '../../src/orders/entry-form-model';
import { buildQuickOrderInput, EMPTY_DRAFT, type QuickOrderDraft } from '../../src/orders/quick-order-model';
import type { PhoneTemplate } from '../../src/orders/templates';
import { must, NOW, Phone, ScriptedServer, aggregate, page, settle } from './harness';

// EVM-106 AC2, AC4, AC5 (+ security K5, K8): the flow from the command of the form through the durable queue, the kill of the app, the
// network that returns, the number and the rejection - on the real SQLCipher adapters (the stand-in server of EVM-107 AC6). Synthetic data only.
let phone: Phone;
beforeEach(async () => {
  phone = new Phone();
  await phone.open();
});
afterEach(() => {
  phone.close();
});

const iso = (ms: number): string => new Date(ms).toISOString();
const newId = createUuidV7(
  { now: () => NOW },
  { getRandomValues: (bytes) => (webcrypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>), bytes) },
);
const TEMPLATE: PhoneTemplate = {
  id: '0194c2a0-0000-7000-8000-000000000a01',
  code: 'house',
  name: 'Dom — sam montaż',
  siteTypeHint: 'single_family_house',
  itemCount: 3,
  procedureCount: 1,
  milestoneCount: 1,
};
const DRAFT: QuickOrderDraft = {
  ...EMPTY_DRAFT,
  firstName: 'Anna',
  lastName: 'Fikcyjna',
  phone: '600 000 009',
  siteType: 'single_family_house',
  street: 'ul. Testowa',
  buildingNumber: '5',
  postalCode: '05-500',
  city: 'Piaseczno',
  templateId: TEMPLATE.id,
  title: 'Dom — sam montaż',
  note: 'Oględziny w piątek',
};
const SYNTHETIC = /Anna|Fikcyjna|600 000 009|Testowa|Piaseczno|Oględziny/;

async function loaded() {
  const server = new ScriptedServer();
  server.changes.push(page([...aggregate(1)], { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }));
  const service = phone.service(server);
  await service.start();
  await settle();
  phone.clockNow += 5_000;
  return { server, service };
}

/** What "Zapisz zlecenie" does: the model builds the command from the draft, the queue stores it. */
function quickCommand(draft: QuickOrderDraft = DRAFT) {
  const built = buildQuickOrderInput(draft, { customers: [], sites: [] }, [TEMPLATE], newId);
  if (!built.ok) throw new Error('the draft must be valid');
  return { ...built, payload: built.input.payload as Record<string, unknown> };
}
/** What the entry form does for the waiting order: the details give the mutation of the order, the entry waits behind it. */
const noteFor = async (service: ReturnType<Phone['service']>, workOrderId: string, body = 'Pierwszy wpis do nowego zlecenia.') => {
  const detail = must(await service.orderDetail(workOrderId));
  const draft: EntryDraft = {
    kind: 'note',
    workOrderId,
    category: 'arrangement',
    stageId: null,
    stages: [],
    body,
    parentMutationId: detail.pendingMutationId ?? null,
  };
  const built = buildEntryInput(draft, phone.clockNow, newId);
  if (!built.ok) throw new Error('the entry must be valid');
  return built.input;
};

/** The server gives the new order its number: the next pull brings the order, its customer and its place. */
function serverCreates(server: ScriptedServer, payload: Record<string, unknown>, number: string, cursorAt = 3) {
  const customer = payload['newCustomer'] as { id: string; displayName: string; phone: string };
  const site = payload['newSite'] as { id: string };
  const entity = (type: string, id: string, fields: Record<string, unknown>) => ({
    op: 'upsert',
    entity: { type, id, version: 1, ...fields },
  });
  server.changes.push(
    page(
      [
        entity('customer', customer.id, { kind: 'person', displayName: customer.displayName, phone: customer.phone }),
        entity('site', site.id, {
          siteType: 'single_family_house',
          street: 'ul. Testowa',
          buildingNumber: '5',
          apartmentNumber: null,
          postalCode: '05-500',
          city: 'Piaseczno',
          parkingSpotNumber: null,
          garageLevel: null,
          connectionPowerKw: null,
          managerPartyId: null,
          distributionSystemOperatorPartyId: null,
          notes: null,
        }),
        entity('work_order', String(payload['workOrderId']), {
          number,
          title: String(payload['title']),
          status: 'new',
          customerId: customer.id,
          siteId: site.id,
          coordinatorUserId: null,
          description: null,
          plannedDate: null,
          createdAt: iso(NOW),
          closedAt: null,
        }),
      ],
      { cursor: cursorAt },
    ),
  );
}

/** The network returns: the retry goes through the timer of the backoff. */
async function networkReturns(service: ReturnType<Phone['service']>) {
  phone.online = true;
  phone.clockNow += 10 * 60_000;
  service.setOnline(true);
  await settle();
  for (let round = 0; round < 6 && service.getSnapshot().counts.unsent > 0; round += 1) {
    phone.clockNow += 10 * 60_000;
    await phone.timers.fireAll();
    service.trigger();
    await settle();
  }
}

describe('quick order offline (EVM-106 AC2)', () => {
  it('EVM-106 AC2: the order is in the queue before the form closes; M-05 lists it on top without a number; M-03 opens from the queue', async () => {
    const { server, service } = await loaded();
    phone.online = false;
    service.setOnline(false);
    const built = quickCommand();
    // `enqueue` answered ok = the command is on disk (the form closes only now)
    expect(await service.enqueue(built.input)).toEqual({ ok: true });
    expect(await phone.queue.readAll()).toHaveLength(1);
    expect(server.pushes).toHaveLength(0);
    const rows = await service.orderList(true);
    expect(rows[0]).toMatchObject({ id: built.workOrderId, awaitingNumber: true, number: null, customer: 'Anna Fikcyjna' });
    expect(rows).toHaveLength(2);
    const detail = must(await service.orderDetail(built.workOrderId));
    expect(detail).toMatchObject({
      id: built.workOrderId,
      number: null,
      awaitingNumber: true,
      title: 'Dom — sam montaż',
      customer: { name: 'Anna Fikcyjna' },
      location: { street: 'ul. Testowa 5', city: '05-500 Piaseczno' },
    });
  });

  it('EVM-106 AC2: an entry added to the waiting order sits in the queue behind it ("Wyślemy po utworzeniu zlecenia") and goes out after it', async () => {
    const { server, service } = await loaded();
    phone.online = false;
    service.setOnline(false);
    const built = quickCommand();
    await service.enqueue(built.input);
    expect(await service.enqueue(await noteFor(service, built.workOrderId))).toEqual({ ok: true });
    const detail = must(await service.orderDetail(built.workOrderId));
    expect(detail.journal).toHaveLength(1);
    expect(detail.journal[0]).toMatchObject({
      source: 'pending',
      kind: 'note',
      awaitsOrder: true,
      body: 'Pierwszy wpis do nowego zlecenia.',
    });
    serverCreates(server, built.payload, 'ZL-2026-0099');
    await networkReturns(service);
    expect(service.getSnapshot().counts.unsent).toBe(0);
    const sent = server.pushes.flatMap((push) => push.mutations);
    expect(sent.map((m) => m.type)).toEqual(['CreateQuickWorkOrder', 'CreateNote']);
    for (const push of server.pushes) expect(zSyncMutationsRequest.safeParse(push).success).toBe(true);
  });
});

describe('quick order sync (EVM-106 AC4)', () => {
  it('EVM-106 AC4: after the network returns the order is sent once, gets its number, and the same screen turns into the synchronized order', async () => {
    const { server, service } = await loaded();
    phone.online = false;
    service.setOnline(false);
    const built = quickCommand();
    await service.enqueue(built.input);
    serverCreates(server, built.payload, 'ZL-2026-0099');
    await networkReturns(service);
    expect(await phone.queue.readAll()).toEqual([]);
    expect(server.applied.size).toBe(1);
    const detail = must(await service.orderDetail(built.workOrderId));
    expect(detail).toMatchObject({ number: 'ZL-2026-0099', title: 'Dom — sam montaż', status: 'new' });
    expect(detail.awaitingNumber).not.toBe(true);
    const rows = await service.orderList(true);
    expect(rows.find((row) => row.id === built.workOrderId)).toMatchObject({ awaitingNumber: false, number: 'ZL-2026-0099' });
  });

  it('EVM-106 AC4: a lost answer repeats the SAME mutation id - the server applies the order once (duplicate after the resync)', async () => {
    const { server, service } = await loaded();
    phone.online = false;
    service.setOnline(false);
    const built = quickCommand();
    await service.enqueue(built.input);
    server.pushScript.push(() => {
      for (const m of server.pushes[server.pushes.length - 1]?.mutations ?? []) server.applied.set(m.mutationId, 1);
      return { kind: 'network' };
    });
    serverCreates(server, built.payload, 'ZL-2026-0099');
    await networkReturns(service);
    expect(service.getSnapshot().counts.unsent).toBe(0);
    const received = server.pushes.flatMap((push) => push.mutations.map((m) => m.mutationId));
    expect(received.length).toBeGreaterThanOrEqual(2);
    expect(new Set(received).size).toBe(1);
    expect(server.applied.size).toBe(1);
  });

  it('EVM-106 AC4: the kill of the app before the sending keeps the order and its entry; after the restart they are sent once, in order', async () => {
    const { server, service } = await loaded();
    phone.online = false;
    service.setOnline(false);
    const built = quickCommand();
    await service.enqueue(built.input);
    await service.enqueue(await noteFor(service, built.workOrderId));
    service.dispose();
    await phone.restart();
    const second = phone.service(server);
    phone.online = false;
    await second.start();
    await settle();
    expect(second.getSnapshot().counts.unsent).toBe(2);
    expect(must(await second.orderDetail(built.workOrderId)).awaitingNumber).toBe(true);
    expect((await second.orderList(true))[0]).toMatchObject({ id: built.workOrderId, awaitingNumber: true });
    expect(server.pushes).toHaveLength(0);
    serverCreates(server, built.payload, 'ZL-2026-0099');
    await networkReturns(second);
    expect(second.getSnapshot().counts.unsent).toBe(0);
    const sent = server.pushes.flatMap((push) => push.mutations);
    expect(sent.map((m) => m.type)).toEqual(['CreateQuickWorkOrder', 'CreateNote']);
    expect(server.applied.size).toBe(2);
  });

  it('EVM-106 AC4: a second command with the same ids is a "duplicate" of the first on the server, not a second order', async () => {
    const { server, service } = await loaded();
    const built = quickCommand();
    await service.enqueue(built.input);
    await settle();
    phone.clockNow += 60_000;
    service.trigger();
    await settle();
    const first = server.pushes.flatMap((push) => push.mutations)[0];
    // a replay of the same envelope (the resync after a lost state)
    await server.sendBatch({ ...must(server.pushes[0]) });
    expect(server.applied.get(must(first).mutationId)).toBe(2);
    expect(server.applied.size).toBe(1);
  });
});

describe('rejected quick order (EVM-106 AC5)', () => {
  const rejectNext = (server: ScriptedServer, code: string) => {
    server.pushScript.push(() => {
      const id = server.pushes[server.pushes.length - 1]?.mutations[0]?.mutationId ?? '';
      return { kind: 'ok', body: { serverTime: iso(NOW), results: [{ mutationId: id, outcome: 'rejected', code }] } };
    });
  };

  it.each([
    ['quota_exceeded', 'quota_exceeded'],
    ['template_unavailable', 'template_unavailable'],
    ['validation_failed', 'validation_failed_quick'],
    ['id_conflict', 'id_conflict'],
  ])(
    'EVM-106 AC5: %s puts the order and its entries in ONE group of "Wymaga uwagi" with the number of dependents; no automatic retry',
    async (code, reason) => {
      const { server, service } = await loaded();
      const built = quickCommand();
      phone.online = false;
      service.setOnline(false);
      await service.enqueue(built.input);
      await service.enqueue(await noteFor(service, built.workOrderId));
      await service.enqueue(await noteFor(service, built.workOrderId, 'Drugi wpis.'));
      rejectNext(server, code);
      await networkReturns(service);
      const view = await service.queueView(true);
      expect(view.items).toHaveLength(1);
      expect(view.items[0]).toMatchObject({ type: 'CreateQuickWorkOrder', state: 'attention', reason, dependents: 2 });
      expect(view.items[0]?.actions).toEqual(['recreate', 'discard']);
      const requests = server.pushes.length;
      for (let i = 0; i < 3; i += 1) {
        phone.clockNow += 10 * 60_000;
        await phone.timers.fireAll();
        service.trigger();
        await settle();
      }
      expect(server.pushes.length).toBe(requests);
      // "Usuń z telefonu" is the separate action; it names the number of the dependents and removes the whole group
      const id = must(view.items[0]).id;
      expect(await service.dependentsOf(id)).toBe(2);
      expect(await service.discard(id)).toEqual({ ok: true, dependents: 2 });
      expect(await phone.queue.readAll()).toEqual([]);
    },
  );

  it('EVM-106 AC5: a code the app does not know is a general "Wymaga uwagi" (the vocabulary is open) with copy and discard', async () => {
    const { server, service } = await loaded();
    await service.enqueue(quickCommand().input);
    rejectNext(server, 'something_new');
    await settle();
    phone.clockNow += 60_000;
    service.trigger();
    await settle();
    const item = must((await service.queueView(true)).items[0]);
    expect(item).toMatchObject({ state: 'attention', reason: 'unknown' });
    expect(item.actions).toEqual(['copy', 'discard']);
  });

  it('EVM-106 AC5: "Kopiuj treść" of the group gives what the technician typed, only through the service (the screen puts it on the clipboard)', async () => {
    const { server, service } = await loaded();
    await service.enqueue(quickCommand().input);
    rejectNext(server, 'quota_exceeded');
    await settle();
    phone.clockNow += 60_000;
    service.trigger();
    await settle();
    const id = must((await service.queueView(true)).items[0]).id;
    const copied = must(await service.copyText(id));
    expect(copied).toContain('Anna Fikcyjna');
    expect(copied).toContain('ul. Testowa 5 05-500 Piaseczno');
  });
});

describe('no data in the logs (EVM-106 AC6; security K5)', () => {
  it('EVM-106 AC6: neither the write, nor a refused write, nor the pending details, nor the rejection writes anything to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
    const { server, service } = await loaded();
    const built = quickCommand();
    await service.enqueue(built.input);
    await service.enqueue({ type: 'CreateQuickWorkOrder', commandVersion: 1, payload: { ...built.payload, title: '' } });
    await service.orderDetail(built.workOrderId);
    server.pushScript.push(() => {
      const id = server.pushes[server.pushes.length - 1]?.mutations[0]?.mutationId ?? '';
      return { kind: 'ok', body: { serverTime: iso(NOW), results: [{ mutationId: id, outcome: 'rejected', code: 'quota_exceeded' }] } };
    });
    phone.clockNow += 60_000;
    service.trigger();
    await settle();
    const calls = spies.flatMap((spy) => spy.mock.calls.map((call) => JSON.stringify(call)));
    expect(calls.join(' ')).not.toMatch(SYNTHETIC);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(phone.diagnostics)).not.toMatch(SYNTHETIC);
    spies.forEach((spy) => {
      spy.mockRestore();
    });
  });
});
