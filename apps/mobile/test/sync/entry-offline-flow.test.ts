import { zSyncMutationsRequest } from '@evia/contracts/zod';
import { createUuidV7 } from '@evia/sync-core';
import { webcrypto } from 'node:crypto';
import { buildEntryInput, stageChoices, type EntryDraft } from '../../src/orders/entry-form-model';
import { must, NOW, Phone, ScriptedServer, aggregate, page, settle, uid } from './harness';

// EVM-105 AC1, AC2, AC5, AC6: the flow from the command of the form through the durable queue, the kill of the app, the network that
// returns and the rejection - on the real SQLCipher adapters (the same stand-in server as EVM-107 AC6). Synthetic data only.
let phone: Phone;
beforeEach(async () => {
  phone = new Phone();
  await phone.open();
});
afterEach(() => {
  phone.close();
});

const ORDER_1 = uid('work_order', 1);
const ORDER_2 = uid('work_order', 2);
const iso = (ms: number): string => new Date(ms).toISOString();
const newId = createUuidV7(
  { now: () => NOW },
  { getRandomValues: (bytes) => (webcrypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>), bytes) },
);

const stage = {
  op: 'upsert',
  entity: {
    type: 'procedure_stage',
    id: '5a000000-0000-4000-8000-000000000001',
    version: 1,
    workOrderId: ORDER_1,
    procedureId: '6a000000-0000-4000-8000-000000000001',
    procedureCode: 'P',
    code: 'S1',
    procedureName: 'Process 1',
    name: 'Stage 1',
    position: 1,
    status: 'in_progress',
    waitingOn: null,
    waitingPartyId: null,
    waitingSince: null,
    dueDate: null,
    responsibleUserId: null,
    blockedReason: null,
    startedAt: null,
    completedOn: null,
  },
};

async function loaded() {
  const server = new ScriptedServer();
  server.changes.push(page([...aggregate(1), ...aggregate(2), stage], { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }));
  const service = phone.service(server);
  await service.start();
  await settle();
  phone.clockNow += 5_000;
  return { server, service };
}

/** What the form does on "Zapisz wpis": the detail gives the stages of the order, the model builds the command. */
async function command(service: ReturnType<Phone['service']>, patch: Partial<EntryDraft> = {}) {
  const detail = must(await service.orderDetail(ORDER_1));
  const built = buildEntryInput(
    {
      kind: 'note',
      workOrderId: ORDER_1,
      category: 'arrangement',
      stageId: null,
      stages: stageChoices(detail),
      body: 'Trasa kabla przez szacht B.',
      ...patch,
    },
    phone.clockNow,
    newId,
  );
  return must(built.ok ? built.input : null);
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

describe('entry offline (EVM-105 AC1, AC2, AC5)', () => {
  it('EVM-105 AC1: a note saved offline is in the queue before the form closes, shows in the journal as waiting, and after the network returns it is sent exactly once', async () => {
    const { server, service } = await loaded();
    phone.online = false;
    service.setOnline(false);
    const stageId = must(must(await service.orderDetail(ORDER_1)).processes[0]).stages[0]?.id ?? '';
    expect(stageId).not.toBe('');
    const input = await command(service, { stageId });
    // `enqueue` answered ok = the record is on disk (the form closes only now)
    expect(await service.enqueue(input)).toEqual({ ok: true });
    expect(await phone.queue.readAll()).toHaveLength(1);
    expect(server.pushes).toHaveLength(0);
    const waiting = must(await service.orderDetail(ORDER_1)).journal;
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ source: 'pending', kind: 'note', category: 'arrangement', body: 'Trasa kabla przez szacht B.' });

    await networkReturns(service);
    expect(service.getSnapshot().counts.unsent).toBe(0);
    expect(await phone.queue.readAll()).toEqual([]);
    const sent = server.pushes.flatMap((push) => push.mutations);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'CreateNote', commandVersion: 1 });
    expect(sent[0]?.payload).toMatchObject({ workOrderId: ORDER_1, noteCategory: 'arrangement', procedureStageId: stageId });
    // what the app sends passes the request schema of the contract
    for (const push of server.pushes) expect(zSyncMutationsRequest.safeParse(push).success).toBe(true);
    // the entry left the queue: no second item in the journal of the phone (the office entry arrives through the pull)
    expect(must(await service.orderDetail(ORDER_1)).journal.filter((entry) => entry.source !== 'synced')).toEqual([]);
  });

  it('EVM-105 AC1: when the answer of the server is lost the retry repeats the SAME mutation id - the server applies the note once', async () => {
    const { server, service } = await loaded();
    phone.online = false;
    service.setOnline(false);
    await service.enqueue(await command(service));
    server.pushScript.push(() => {
      for (const m of server.pushes[server.pushes.length - 1]?.mutations ?? []) server.applied.set(m.mutationId, 1);
      return { kind: 'network' };
    });
    await networkReturns(service);
    expect(service.getSnapshot().counts.unsent).toBe(0);
    const received = server.pushes.flatMap((push) => push.mutations.map((m) => m.mutationId));
    expect(received.length).toBeGreaterThanOrEqual(2);
    expect(new Set(received).size).toBe(1);
    // one key = one entry on the server; the repeat of the lost batch is a replay of the same key (an answer "duplicate")
    expect(server.applied.size).toBe(1);
  });

  it('EVM-105 AC2: a comment goes the same way with CreateComment (no category, no stage)', async () => {
    const { server, service } = await loaded();
    phone.online = false;
    service.setOnline(false);
    expect(await service.enqueue(await command(service, { kind: 'comment', stageId: 'whatever' }))).toEqual({ ok: true });
    expect(must(await service.orderDetail(ORDER_1)).journal[0]).toMatchObject({ source: 'pending', kind: 'comment', category: null });
    await networkReturns(service);
    const sent = server.pushes.flatMap((push) => push.mutations);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe('CreateComment');
    expect(Object.keys(sent[0]?.payload as object).sort()).toEqual(['body', 'capturedAt', 'id', 'workOrderId']);
  });

  it('EVM-105 AC5: entries saved offline survive the kill of the app (a new service on the same file) and are sent once after the restart', async () => {
    const { server, service } = await loaded();
    phone.online = false;
    service.setOnline(false);
    await service.enqueue(await command(service));
    await service.enqueue(await command(service, { kind: 'comment', body: 'Drugi, komentarz.' }));
    service.dispose();
    await phone.restart();
    const second = phone.service(server);
    phone.online = false;
    await second.start();
    await settle();
    expect(second.getSnapshot().counts.unsent).toBe(2);
    const journal = must(await second.orderDetail(ORDER_1)).journal;
    expect(journal.map((entry) => entry.source)).toEqual(['pending', 'pending']);
    expect(server.pushes).toHaveLength(0);
    await networkReturns(second);
    expect(second.getSnapshot().counts.unsent).toBe(0);
    const ids = server.pushes.flatMap((push) => push.mutations.map((m) => m.mutationId));
    expect(new Set(ids).size).toBe(2);
    expect(server.applied.size).toBe(2);
  });
});

describe('rejected entry (EVM-105 AC6)', () => {
  const rejectNext = (server: ScriptedServer, code = 'target_unavailable') => {
    server.pushScript.push(() => {
      const id = server.pushes[server.pushes.length - 1]?.mutations[0]?.mutationId ?? '';
      return { kind: 'ok', body: { serverTime: iso(NOW), results: [{ mutationId: id, outcome: 'rejected', code }] } };
    });
  };

  it('EVM-105 AC6: an entry whose order was deleted is "Wymaga uwagi" with the reason, the text and the three actions; in the journal of the order it is marked as needing attention', async () => {
    const { server, service } = await loaded();
    rejectNext(server);
    await service.enqueue(await command(service));
    await settle();
    const view = await service.queueView(true);
    const item = must(view.items[0]);
    expect(item).toMatchObject({
      state: 'attention',
      reason: 'target_unavailable',
      type: 'CreateNote',
      label: 'Trasa kabla przez szacht B.',
    });
    expect(item.actions).toEqual(['retarget', 'copy', 'discard']);
    expect(item.createdAt).toBeGreaterThan(0);
    const entry = must(await service.orderDetail(ORDER_1)).journal[0];
    expect(entry).toMatchObject({ source: 'attention', kind: 'note', body: 'Trasa kabla przez szacht B.' });
  });

  it('EVM-105 AC6: "Kopiuj treść" gives the text, "Dodaj do innego zlecenia" moves it with a new mutation id and it is sent once; the rejected one is gone', async () => {
    const { server, service } = await loaded();
    rejectNext(server);
    await service.enqueue(await command(service));
    await settle();
    const before = must((await service.queueView(true)).items[0]);
    expect(await service.copyText(before.id)).toBe('Trasa kabla przez szacht B.');
    const options = await service.retargetOptions(before.id);
    expect(options.map((option) => option.id)).toContain(ORDER_2);
    expect(await service.retarget(before.id, ORDER_2)).toEqual({ ok: true });
    phone.clockNow += 2_000;
    await phone.timers.fireAll();
    await settle();
    const sent = server.pushes.flatMap((push) => push.mutations);
    const last = must(sent[sent.length - 1]);
    expect(last.mutationId).not.toBe(before.id);
    expect(last.payload).toMatchObject({ workOrderId: ORDER_2 });
    expect((await service.queueView(true)).items).toHaveLength(0);
  });

  it('EVM-105 AC6: "Usuń z telefonu" is a separate action that removes the rejected entry (and only it)', async () => {
    const { server, service } = await loaded();
    rejectNext(server);
    await service.enqueue(await command(service));
    await settle();
    const id = must((await service.queueView(true)).items[0]).id;
    expect(await service.discard(id)).toEqual({ ok: true, dependents: 0 });
    expect(await phone.queue.readAll()).toEqual([]);
  });

  it('EVM-105 AC6: a text that the server does not accept (validation_failed) also lands in "Wymaga uwagi" with the text kept', async () => {
    const { server, service } = await loaded();
    rejectNext(server, 'validation_failed');
    await service.enqueue(await command(service));
    await settle();
    const item = must((await service.queueView(true)).items[0]);
    expect(item).toMatchObject({ state: 'attention', reason: 'validation_failed', label: 'Trasa kabla przez szacht B.' });
  });
});
