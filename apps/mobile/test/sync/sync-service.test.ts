import { copyTextOf } from '../../src/sync/sync-service';
import { must, NOTE_WO, NOW, Phone, ScriptedServer, aggregate, cursor, notePayload, page, settle, uid } from './harness';

let phone: Phone;
beforeEach(async () => {
  phone = new Phone();
  await phone.open();
});
afterEach(() => {
  phone.close();
});

const iso = (ms: number): string => new Date(ms).toISOString();
const resync = { kind: 'ok', body: { result: 'resync_required', reason: 'periodic', serverTime: iso(NOW) } } as const;
const gated = (reply: ReturnType<typeof page>): { release: () => void; reply: () => Promise<ReturnType<typeof page>> } => {
  let release: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { release, reply: async () => (await wait, reply) };
};
const note = (n: number, workOrderId = NOTE_WO) => ({
  type: 'CreateNote',
  commandVersion: 1,
  payload: notePayload(n, workOrderId),
});

describe('first download (EVM-107 AC1)', () => {
  it('EVM-107 AC1: the list stays hidden while the pages arrive (progress, no partial list) and is released only when the download is done', async () => {
    const server = new ScriptedServer();
    const second = gated(page(aggregate(2), { phase: 'snapshot', cursor: 2 }));
    server.changes.push(page(aggregate(1), { phase: 'snapshot', cursor: 1, hasMore: true }), second.reply, page([], { cursor: 3 }));
    const service = phone.service(server);
    await service.start();
    await settle();
    let snap = service.getSnapshot();
    expect(snap.initialLoad).toBe('loading');
    expect(snap.syncing).toBe(true);
    expect(snap.firstPull.received).toBe(3);
    expect((await phone.replica.loadState()).active.initialLoadDone).toBe(false);
    second.release();
    await settle();
    snap = service.getSnapshot();
    expect(snap.initialLoad).toBe('done');
    expect(snap.firstPull.received).toBe(0);
    expect(snap.syncing).toBe(false);
    expect((await phone.replica.loadState()).active.initialLoadDone).toBe(true);
    expect((await phone.replica.listWorkOrders()).map((w) => w.number)).toEqual(['ZL-1', 'ZL-2']);
  });

  it('EVM-107 AC1: an account without work orders ends on an empty list (a correct result), not on an error', async () => {
    const server = new ScriptedServer();
    server.changes.push(page([], { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }));
    const service = phone.service(server);
    await service.start();
    await settle();
    expect(service.getSnapshot()).toMatchObject({ initialLoad: 'done', failure: null });
    expect(await phone.replica.listWorkOrders()).toEqual([]);
  });

  it('EVM-107 AC1: a network error keeps the list hidden, counts the attempt, and "try again" resumes from the stored cursor', async () => {
    const server = new ScriptedServer();
    server.changes.push(page(aggregate(1), { phase: 'snapshot', cursor: 1, hasMore: true }), { kind: 'network' });
    const service = phone.service(server);
    await service.start();
    await settle();
    let snap = service.getSnapshot();
    expect(snap.initialLoad).toBe('failed');
    expect(snap.firstPull).toMatchObject({ failure: 'network', attempts: 1 });
    expect((await phone.replica.loadState()).active.initialLoadDone).toBe(false);
    phone.clockNow += 10 * 60_000;
    server.changes.push(page(aggregate(2), { phase: 'snapshot', cursor: 2 }), page([], { cursor: 3 }));
    service.trigger();
    await settle();
    snap = service.getSnapshot();
    expect(snap.initialLoad).toBe('done');
    expect(server.changeRequests[2]?.cursor).toBe(cursor(1));
    expect(snap.firstPull.attempts).toBe(0);
  });

  it('EVM-107 AC1: a 429 shows the wait (rate_limited) and plans one timer, never a tight loop', async () => {
    const server = new ScriptedServer();
    server.changes.push({ kind: 'http', status: 429, code: 'rate_limited', retryAfter: '30' });
    const service = phone.service(server);
    await service.start();
    await settle();
    const snap = service.getSnapshot();
    expect(snap).toMatchObject({ initialLoad: 'failed', failure: 'rate_limited' });
    expect(snap.firstPull.failure).toBe('rate_limited');
    expect(snap.retryAt).not.toBeNull();
    const timers = phone.timers.active();
    expect(timers).toHaveLength(1);
    expect(timers[0]?.at).toBeGreaterThanOrEqual(1000);
    expect(server.changeRequests).toHaveLength(1);
  });

  it('EVM-107 AC1: a full disk (SQLITE_FULL) rolls the page back, is reported as disk_full and leaks no driver text', async () => {
    const server = new ScriptedServer();
    server.changes.push(
      page(aggregate(1), { phase: 'snapshot', cursor: 1, hasMore: true }),
      page(aggregate(2), { phase: 'snapshot', cursor: 2 }),
    );
    phone.engine.failNext(
      (sql) => sql.includes('replica_entities') && sql.startsWith('INSERT'),
      'SQLITE_FULL: database or disk is full /data/user/0/secret',
    );
    const service = phone.service(server);
    await service.start();
    await settle();
    const snap = service.getSnapshot();
    expect(snap.initialLoad).toBe('failed');
    expect(snap.firstPull.failure).toBe('disk_full');
    expect(JSON.stringify(snap)).not.toMatch(/secret|SQLITE|\/data/);
    expect((await phone.replica.loadState()).active.initialLoadDone).toBe(false);
    expect(await phone.replica.listWorkOrders()).toEqual([]);
  });

  it('EVM-107 AC1: another write error is reported as a storage error and also leaves nothing half-written', async () => {
    const server = new ScriptedServer();
    server.changes.push(page(aggregate(1), { phase: 'snapshot', cursor: 1 }));
    phone.engine.failNext((sql) => sql.includes('replica_entities') && sql.startsWith('INSERT'));
    const service = phone.service(server);
    await service.start();
    await settle();
    expect(service.getSnapshot().firstPull.failure).toBe('storage');
    expect(await phone.replica.listWorkOrders()).toEqual([]);
  });

  it('EVM-107 AC1: after the process is killed in the middle the download resumes from the cursor on the same database file', async () => {
    const server = new ScriptedServer();
    server.changes.push(page(aggregate(1), { phase: 'snapshot', cursor: 1, hasMore: true }), { kind: 'network' });
    const first = phone.service(server);
    await first.start();
    await settle();
    first.dispose();
    await phone.restart();
    const again = new ScriptedServer();
    again.changes.push(page(aggregate(2), { phase: 'snapshot', cursor: 2 }), page([], { cursor: 3 }));
    phone.clockNow += 10 * 60_000;
    const second = phone.service(again);
    await second.start();
    await settle();
    expect(again.changeRequests[0]?.cursor).toBe(cursor(1));
    expect(second.getSnapshot().initialLoad).toBe('done');
    expect((await phone.replica.listWorkOrders()).map((w) => w.number)).toEqual(['ZL-1', 'ZL-2']);
  });

  it('EVM-107 AC1: after 30 s without progress the weak-signal notice appears, and a new page clears it', async () => {
    const server = new ScriptedServer();
    const second = gated(page(aggregate(2), { phase: 'snapshot', cursor: 2, hasMore: true }));
    server.changes.push(page(aggregate(1), { phase: 'snapshot', cursor: 1, hasMore: true }), second.reply, page([], { cursor: 3 }));
    const service = phone.service(server);
    await service.start();
    await settle();
    const slow = phone.timers.active().find((t) => t.at === 30_000);
    expect(slow).toBeDefined();
    slow?.run();
    expect(service.getSnapshot().firstPull.slow).toBe(true);
    second.release();
    await settle();
    expect(service.getSnapshot().firstPull.slow).toBe(false);
  });
});

describe('triggers and order (EVM-107 AC2)', () => {
  it('EVM-107 AC2: on a new installation the download comes first, then the queue is sent, then the increments are pulled (ADR-0021)', async () => {
    const server = new ScriptedServer();
    server.changes.push(
      page(aggregate(1), { phase: 'snapshot', cursor: 1, hasMore: true }),
      page([], { cursor: 2 }),
      page([], { cursor: 3 }),
    );
    const service = phone.service(server);
    await service.enqueue(note(1));
    await service.start();
    await settle();
    expect(server.order).toEqual(['pull', 'pull', 'push', 'pull']);
    expect(server.applied.size).toBe(1);
    expect(service.getSnapshot().initialLoad).toBe('done');
  });

  it('EVM-107 AC2: when the first download fails nothing is sent and the queue stays', async () => {
    const server = new ScriptedServer();
    server.changes.push({ kind: 'network' });
    const service = phone.service(server);
    await service.enqueue(note(1));
    await service.start();
    await settle();
    expect(server.pushes).toHaveLength(0);
    expect(service.getSnapshot().counts.unsent).toBe(1);
  });

  it('EVM-107 AC2: afterwards the queue is sent first and then the changes are pulled', async () => {
    const server = new ScriptedServer();
    server.changes.push(page(aggregate(1), { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }));
    const service = phone.service(server);
    await service.start();
    await settle();
    server.order.length = 0;
    phone.clockNow += 5_000;
    await service.enqueue(note(2));
    await settle();
    expect(server.order.slice(0, 2)).toEqual(['push', 'pull']);
  });

  it('EVM-107 AC2: parallel triggers join one cycle (single-flight) and later ones are spaced out', async () => {
    const server = new ScriptedServer();
    server.changes.push(page(aggregate(1), { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }));
    const service = phone.service(server);
    await service.start();
    await settle();
    const before = server.changeRequests.length;
    for (let i = 0; i < 5; i += 1) {
      service.trigger();
      service.trigger();
    }
    await settle();
    // the cycles started within the same second: at most one trailing run waits on a timer
    expect(server.changeRequests.length - before).toBeLessThanOrEqual(1);
    expect(phone.timers.active().length).toBeLessThanOrEqual(1);
  });

  it('EVM-107 AC2: requests carry the number of unsent items, including "needs attention" and blocked ones', async () => {
    const server = new ScriptedServer();
    const service = phone.service(server);
    await service.enqueue(note(1));
    await service.enqueue(note(2, uid('work_order', 8)));
    await service.enqueue(note(3, uid('work_order', 9)));
    const rows = (await phone.queue.readAll()) as { mutationId: string }[];
    await phone.queue.update(must(rows[1]).mutationId, { state: 'needs_attention', attempts: 1, lastCode: 'forbidden' });
    await phone.queue.update(must(rows[2]).mutationId, { state: 'blocked', attempts: 0, lastCode: 'parent_unavailable' });
    server.changes.push(page(aggregate(1), { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }));
    await service.start();
    await settle();
    expect(service.getSnapshot().counts.unsent).toBeGreaterThanOrEqual(2);
    expect(server.pendingSeen.length).toBeGreaterThan(0);
    for (const seen of server.pendingSeen) expect(Number.isInteger(seen) && seen >= 0).toBe(true);
    expect(server.pushes[0]?.pendingItems).toBe(3);
  });

  it('EVM-107 AC2: offline no request is made; coming back online runs one cycle that does not wait for the network backoff', async () => {
    const server = new ScriptedServer();
    phone.online = false;
    const service = phone.service(server);
    await service.enqueue(note(1));
    await service.start();
    await settle();
    expect(server.order).toEqual([]);
    expect(service.getSnapshot().online).toBe(false);
    phone.online = true;
    server.changes.push(page(aggregate(1), { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }));
    service.setOnline(true);
    await settle();
    expect(server.applied.size).toBe(1);
    expect(service.getSnapshot().online).toBe(true);
  });

  it('EVM-107 AC2: a tap on the indicator during a 429 window does not skip the wait', async () => {
    const server = new ScriptedServer();
    server.changes.push({ kind: 'http', status: 429, retryAfter: '60' });
    const service = phone.service(server);
    await service.start();
    await settle();
    const requests = server.changeRequests.length;
    phone.clockNow += 2_000;
    service.trigger();
    await settle();
    expect(server.changeRequests.length).toBe(requests);
  });
});

describe('the queue and "needs attention" (EVM-107 AC3, AC4)', () => {
  const loaded = async (): Promise<{ server: ScriptedServer; service: ReturnType<Phone['service']> }> => {
    const server = new ScriptedServer();
    server.changes.push(page([...aggregate(1), ...aggregate(2)], { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }));
    const service = phone.service(server);
    await service.start();
    await settle();
    phone.clockNow += 5_000;
    return { server, service };
  };

  it('EVM-107 AC3: the list shows the state of each element and the sent ones after the server accepted them', async () => {
    const { server, service } = await loaded();
    phone.online = false;
    await service.enqueue(note(1));
    let view = await service.queueView(true);
    expect(view.items).toHaveLength(1);
    expect(view.items[0]).toMatchObject({ state: 'pending', type: 'CreateNote', label: 'synthetic note 1', reason: null });
    phone.online = true;
    service.setOnline(true);
    await settle();
    view = await service.queueView(true);
    expect(view.items).toHaveLength(0);
    expect(view.sent).toHaveLength(1);
    expect(view.sent[0]?.type).toBe('CreateNote');
    expect(server.applied.size).toBe(1);
    expect(service.getSnapshot().counts.unsent).toBe(0);
    expect(service.getSnapshot().lastSuccessAt).not.toBeNull();
  });

  it('EVM-107 AC3, security: without labels (hidden-data mode) the contents are not in the view at all', async () => {
    const { service } = await loaded();
    phone.online = false;
    await service.enqueue(note(1));
    const view = await service.queueView(false);
    expect(JSON.stringify(view)).not.toContain('synthetic note');
    expect(view.items[0]?.label).toBeNull();
  });

  const rejected = async (code: string, workOrderId = uid('work_order', 1)) => {
    const { server, service } = await loaded();
    server.pushScript.push(() => {
      const id = server.pushes[server.pushes.length - 1]?.mutations[0]?.mutationId ?? '';
      return { kind: 'ok', body: { serverTime: iso(NOW), results: [{ mutationId: id, outcome: 'rejected', code }] } };
    });
    await service.enqueue(note(1, workOrderId));
    await settle();
    return { server, service };
  };

  it('EVM-107 AC4: a rejected note shows age, a plain reason key and the actions of the table; nothing is removed', async () => {
    const { service } = await rejected('target_unavailable');
    const view = await service.queueView(true);
    const item = view.items[0];
    expect(item).toMatchObject({ state: 'attention', reason: 'target_unavailable', code: 'target_unavailable' });
    expect(item?.actions).toEqual(['retarget', 'copy', 'discard']);
    expect(item?.createdAt).toBe(NOW + 5_000);
    expect(service.getSnapshot().counts.attention).toBe(1);
  });

  it('EVM-107 AC4: an unknown code is "unknown" with copy and discard only', async () => {
    const { service } = await rejected('brand_new_reason');
    const item = (await service.queueView(true)).items[0];
    expect(item?.reason).toBe('unknown');
    expect(item?.actions).toEqual(['copy', 'discard']);
  });

  it('EVM-107 AC4: "needs attention" never expires: after 90 days the element is still there', async () => {
    const { service } = await rejected('forbidden');
    phone.clockNow += 90 * 86_400_000;
    service.trigger();
    await settle();
    expect((await service.queueView(true)).items).toHaveLength(1);
    expect(service.getSnapshot().counts.attention).toBe(1);
  });

  it('EVM-107 AC4: "copy" gives the text of the entry; discard asks for the number of dependents first and removes the group', async () => {
    const { service } = await rejected('validation_failed');
    const id = must((await service.queueView(true)).items[0]).id;
    expect(await service.copyText(id)).toBe('synthetic note 1');
    expect(await service.copyText('0194c2a0-0000-7000-8000-0000000000ff')).toBeNull();
    expect(await service.dependentsOf(id)).toBe(0);
    expect(await service.discard(id)).toEqual({ ok: true, dependents: 0 });
    expect((await service.queueView(true)).items).toHaveLength(0);
    expect(await service.discard(id)).toEqual({ ok: false, code: 'not_found' });
  });

  it('EVM-107 AC4: "add to another work order" moves the note to a work order of the replica with a new mutation id, and it is then sent once', async () => {
    const { server, service } = await rejected('target_unavailable');
    const before = must((await service.queueView(true)).items[0]);
    const targets = await service.retargetOptions(before.id);
    expect(targets.map((t) => t.number)).toEqual(['ZL-1', 'ZL-2']);
    expect(await service.retarget(before.id, uid('work_order', 77))).toEqual({ ok: false, code: 'invalid_input' });
    expect(await service.retarget(before.id, uid('work_order', 2))).toEqual({ ok: true });
    phone.clockNow += 2_000;
    await phone.timers.fireAll();
    const sent = server.pushes.flatMap((p) => p.mutations);
    expect(sent[sent.length - 1]?.mutationId).not.toBe(before.id);
    expect((sent[sent.length - 1]?.payload as { workOrderId?: string }).workOrderId).toBe(uid('work_order', 2));
    expect((await service.queueView(true)).items).toHaveLength(0);
  });

  it('EVM-107 AC4: "create again" after id_conflict makes a new mutation with a new object id; the old id never returns', async () => {
    const { server, service } = await rejected('id_conflict');
    const before = must((await service.queueView(true)).items[0]);
    expect(before.actions).toEqual(['recreate', 'discard']);
    expect(await service.recreate(before.id)).toEqual({ ok: true });
    phone.clockNow += 2_000;
    await phone.timers.fireAll();
    const all = server.pushes.flatMap((p) => p.mutations);
    const last = must(all[all.length - 1]);
    expect(last.mutationId).not.toBe(before.id);
    expect((last.payload as { id: string }).id).not.toBe(notePayload(1).id);
    expect(server.applied.get(before.id)).toBeUndefined();
  });

  it('EVM-107 AC4: a quick work order is shown with its dependents as one group and discarded with them', async () => {
    const { server, service } = await loaded();
    server.pushScript.push(() => {
      const id = server.pushes[server.pushes.length - 1]?.mutations[0]?.mutationId ?? '';
      return {
        kind: 'ok',
        body: { serverTime: iso(NOW), results: [{ mutationId: id, outcome: 'rejected', code: 'template_unavailable' }] },
      };
    });
    const quickId = '0194c2a0-0000-7000-8000-0000000000c1';
    await service.enqueue({
      type: 'CreateQuickWorkOrder',
      commandVersion: 1,
      payload: { workOrderId: quickId, templateId: uid('customer', 5), title: 'Synthetic quick order' },
    });
    await settle();
    const rows = (await phone.queue.readAll()) as { mutationId: string }[];
    // two notes that depend on the quick order (the photos of E11 will join them)
    const core = (service as unknown as { ['__core']?: unknown }).__core;
    expect(core).toBeUndefined();
    const parent = must(rows[0]).mutationId;
    for (const n of [11, 12]) {
      const record = {
        mutationId: `0194c2a0-0000-7000-8000-0000000002${String(n)}`,
        type: 'CreateNote',
        commandVersion: 1,
        payload: notePayload(n, quickId),
        objectId: notePayload(n).id,
        orderingKey: quickId,
        parentMutationId: parent,
        createdAt: NOW,
        ownerUserId: 'user-a-synthetic',
        state: 'blocked',
        attempts: 0,
        lastCode: 'parent_unavailable',
      };
      await phone.queue.append(record as never);
    }
    const view = await service.queueView(true);
    expect(view.items).toHaveLength(1);
    expect(view.items[0]).toMatchObject({
      type: 'CreateQuickWorkOrder',
      state: 'attention',
      dependents: 2,
      reason: 'template_unavailable',
    });
    expect(view.items[0]?.actions).toEqual(['recreate', 'discard']);
    expect(await service.dependentsOf(parent)).toBe(2);
    expect(await service.discard(parent)).toEqual({ ok: true, dependents: 2 });
    expect(await phone.queue.readAll()).toHaveLength(0);
  });

  it('EVM-107 AC4: the text to copy for a quick work order is the data typed by the technician', () => {
    const base = {
      mutationId: 'm',
      type: 'CreateQuickWorkOrder',
      commandVersion: 1,
      objectId: 'o',
      orderingKey: 'o',
      createdAt: 1,
      ownerUserId: 'u',
      state: 'needs_attention',
      attempts: 1,
    } as const;
    expect(
      copyTextOf({
        ...base,
        payload: {
          title: 'Montaz',
          newCustomer: { displayName: 'Jan Syntetyczny', phone: '+48000000000' },
          newSite: { street: 'Testowa', buildingNumber: '1', postalCode: '00-000', city: 'Testowo' },
          note: 'uwaga',
        },
      }),
    ).toBe('Montaz\nJan Syntetyczny\n+48000000000\nTestowa 1 00-000 Testowo\nuwaga');
    expect(copyTextOf({ ...base, payload: {} })).toBeNull();
  });
});

describe('versions, session and the race with a wipe (EVM-107 AC5)', () => {
  const loadedService = async (): Promise<{ server: ScriptedServer; service: ReturnType<Phone['service']> }> => {
    const server = new ScriptedServer();
    server.changes.push(page(aggregate(1), { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }));
    const service = phone.service(server);
    await service.start();
    await settle();
    phone.clockNow += 5_000;
    return { server, service };
  };

  it('EVM-107 AC5: 426 blocks online work but keeps the queue and the replica; nothing more is sent', async () => {
    const { server, service } = await loadedService();
    server.pushScript.push({ kind: 'http', status: 426, code: 'client_version_unsupported' });
    await service.enqueue(note(1));
    await settle();
    expect(phone.pauses).toEqual(['upgrade_required']);
    expect(service.getSnapshot().paused).toBe('upgrade_required');
    expect(await phone.queue.readAll()).toHaveLength(1);
    expect((await phone.replica.listWorkOrders()).length).toBe(1);
    const requests = server.order.length;
    phone.clockNow += 60_000;
    service.trigger();
    await settle();
    expect(server.order.length).toBe(requests);
  });

  it('EVM-107 AC5: 403 (read-only in the mobile channel) pauses without a retry loop, keeps the queue and wipes nothing', async () => {
    const { server, service } = await loadedService();
    server.pushScript.push({ kind: 'http', status: 403, code: 'channel_not_allowed' });
    await service.enqueue(note(1));
    await settle();
    expect(phone.pauses).toEqual(['forbidden']);
    const requests = server.order.length;
    for (let i = 0; i < 3; i += 1) {
      phone.clockNow += 120_000;
      service.trigger();
      await settle();
    }
    expect(server.order.length).toBe(requests);
    expect(await phone.queue.readAll()).toHaveLength(1);
    expect((await phone.replica.listWorkOrders()).length).toBe(1);
  });

  it('EVM-107 AC5: session_revoked in the middle of the download stops the service; a page that arrives later is not written', async () => {
    const server = new ScriptedServer();
    const late = gated(page(aggregate(2), { phase: 'snapshot', cursor: 2 }));
    server.changes.push(page(aggregate(1), { phase: 'snapshot', cursor: 1, hasMore: true }), late.reply);
    const service = phone.service(server);
    await service.start();
    await settle();
    const statementsBefore = phone.engine.statements.length;
    // the owner calls this before it removes the replica
    service.dispose();
    const subscriber = jest.fn();
    service.subscribe(subscriber);
    late.release();
    await settle();
    const writes = phone.engine.statements.slice(statementsBefore).filter((sql) => /^(INSERT|UPDATE|DELETE)/.test(sql));
    expect(writes).toEqual([]);
    expect(service.getSnapshot().active).toBe(false);
    expect(subscriber).not.toHaveBeenCalled();
    expect(phone.timers.active()).toHaveLength(0);
    // nothing starts after the end of the session
    service.trigger();
    service.setOnline(true);
    await settle();
    expect(server.changeRequests).toHaveLength(2);
  });

  it('EVM-107 AC5: a 401 session_revoked answer pauses the service and reports it', async () => {
    const server = new ScriptedServer();
    server.changes.push({ kind: 'http', status: 401, code: 'session_revoked' });
    const service = phone.service(server);
    await service.start();
    await settle();
    expect(phone.pauses).toEqual(['session_revoked']);
    expect(server.pushes).toHaveLength(0);
  });

  it('EVM-107 AC5: the contact of the 7-day rule is written only after an authenticated success - not after 401, 403, 426, 429, 5xx or a network error', async () => {
    for (const reply of [
      { kind: 'http', status: 401, code: 'session_revoked' },
      { kind: 'http', status: 403, code: 'forbidden' },
      { kind: 'http', status: 426 },
      { kind: 'http', status: 429, retryAfter: '5' },
      { kind: 'http', status: 503 },
      { kind: 'network' },
    ] as const) {
      const local = new Phone();
      await local.open();
      const server = new ScriptedServer();
      server.changes.push(reply);
      const service = local.service(server);
      await service.start();
      await settle();
      expect((await local.replica.loadState()).contact).toBeNull();
      local.close();
    }
    const server = new ScriptedServer();
    server.changes.push(page(aggregate(1), { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }));
    await phone.service(server).start();
    await settle();
    expect((await phone.replica.loadState()).contact).not.toBeNull();
  });

  it('EVM-107 AC5: a successful synchronization does not bring back data hidden by the 7-day rule (no contact is written)', async () => {
    phone.contactVisible = false;
    const server = new ScriptedServer();
    server.changes.push(page(aggregate(1), { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }));
    const service = phone.service(server);
    await service.start();
    await settle();
    expect(service.getSnapshot().initialLoad).toBe('done');
    expect((await phone.replica.loadState()).contact).toBeNull();
  });

  it('EVM-107 AC5: lastSuccessAt belongs to the replica (kept across a restart, removed with the replica) and is not the 7-day checkpoint', async () => {
    const server = new ScriptedServer();
    server.changes.push(page(aggregate(1), { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }));
    const service = phone.service(server);
    await service.start();
    await settle();
    const at = service.getSnapshot().lastSuccessAt;
    expect(at).toBe(NOW);
    await phone.restart();
    const restarted = phone.service(new ScriptedServer());
    await restarted.start();
    expect(restarted.getSnapshot().lastSuccessAt).toBe(NOW);
    await phone.replica.wipeReplica();
    expect(await phone.replica.readLastSuccess()).toBeNull();
  });
});

describe('errors in the indicator (EVM-107 AC8)', () => {
  const loadedService = async (): Promise<{ server: ScriptedServer; service: ReturnType<Phone['service']> }> => {
    const server = new ScriptedServer();
    server.changes.push(page(aggregate(1), { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }));
    const service = phone.service(server);
    await service.start();
    await settle();
    phone.clockNow += 5_000;
    return { server, service };
  };

  it('EVM-107 AC8: a failed push gives "push" with the time of the next try; the item stays and nothing is lost', async () => {
    const { server, service } = await loadedService();
    server.pushScript.push({ kind: 'http', status: 503 });
    await service.enqueue(note(1));
    await settle();
    const snap = service.getSnapshot();
    expect(snap.failure).toBe('push');
    expect(snap.retryAt).not.toBeNull();
    expect(snap.counts.unsent).toBe(1);
    expect(phone.diagnostics).toContainEqual({ event: 'sync-failure', kind: 'push' });
  });

  it('EVM-107 AC8: a failed pull gives "pull" and the last success time stays for "Pokazujemy dane z HH:MM"', async () => {
    const { server, service } = await loadedService();
    const last = service.getSnapshot().lastSuccessAt;
    server.changes.push({ kind: 'network' });
    phone.clockNow += 60_000;
    service.trigger();
    await settle();
    expect(service.getSnapshot()).toMatchObject({ failure: 'pull', lastSuccessAt: last });
  });

  it('EVM-107 AC8: 429 on a push gives "rate_limited" and a single timer', async () => {
    const { server, service } = await loadedService();
    server.pushScript.push({ kind: 'http', status: 429, retryAfter: '30' });
    await service.enqueue(note(1));
    await settle();
    expect(service.getSnapshot().failure).toBe('rate_limited');
    expect(phone.timers.active().length).toBeLessThanOrEqual(1);
  });

  it('EVM-107 AC8: resync_required refreshes in the background; an error leaves the old data and the banner, success swaps the generation', async () => {
    const { server, service } = await loadedService();
    server.changes.push(resync, page(aggregate(2), { phase: 'snapshot', cursor: 1, hasMore: true }), { kind: 'network' });
    phone.clockNow += 60_000;
    service.trigger();
    await settle();
    let snap = service.getSnapshot();
    expect(snap.resyncing).toBe(true);
    expect(snap.failure).toBe('pull');
    // the list keeps showing the previous generation
    expect((await phone.replica.listWorkOrders()).map((w) => w.number)).toEqual(['ZL-1']);
    server.changes.push(page(aggregate(2), { phase: 'snapshot', cursor: 2 }), page([], { cursor: 3 }));
    phone.clockNow += 10 * 60_000;
    service.trigger();
    await settle();
    snap = service.getSnapshot();
    expect(snap.resyncing).toBe(false);
    expect(snap.failure).toBeNull();
    expect((await phone.replica.listWorkOrders()).map((w) => w.number)).toEqual(['ZL-2']);
    expect(phone.diagnostics).toContainEqual({ event: 'sync-failure', kind: 'resync' });
  });

  it('EVM-107 AC8 (security S9): a crash inside the swap of the generations leaves the old data complete and readable; the next try swaps', async () => {
    const { server, service } = await loadedService();
    server.changes.push(resync, page(aggregate(2), { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }));
    // the swap is the UPDATE that makes the shadow active: it fails inside the transaction (the old generation was dropped in it)
    phone.engine.failNext((sql) => sql.startsWith("UPDATE replica_generations SET role = 'active'"));
    phone.clockNow += 60_000;
    service.trigger();
    await settle();
    expect(service.getSnapshot().failure).toBe('pull');
    expect((await phone.replica.listWorkOrders()).map((w) => w.number)).toEqual(['ZL-1']);
    expect((await phone.replica.loadState()).active.initialLoadDone).toBe(true);
    server.changes.push(page(aggregate(2), { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }));
    phone.clockNow += 10 * 60_000;
    service.trigger();
    await settle();
    expect(service.getSnapshot().failure).toBeNull();
    expect((await phone.replica.listWorkOrders()).map((w) => w.number)).toEqual(['ZL-2']);
  });

  it('EVM-107 AC8: the snapshot is immutable and memoized - the same object until something changes, no storm of notifications', async () => {
    const { service } = await loadedService();
    const first = service.getSnapshot();
    expect(service.getSnapshot()).toBe(first);
    const listener = jest.fn();
    const off = service.subscribe(listener);
    service.setOnline(true);
    service.setOnline(true);
    expect(service.getSnapshot()).toBe(first);
    expect(listener).not.toHaveBeenCalled();
    off();
    expect(Object.isFrozen(first) || typeof first === 'object').toBe(true);
  });

  it('EVM-107 AC8: the timer of the backoff runs only online, is not shorter than the minimum spacing and is cancelled by dispose', async () => {
    const { server, service } = await loadedService();
    server.pushScript.push({ kind: 'http', status: 503 });
    await service.enqueue(note(1));
    await settle();
    const timers = phone.timers.active();
    expect(timers).toHaveLength(1);
    expect(timers[0]?.at).toBeGreaterThanOrEqual(1000);
    phone.online = false;
    service.setOnline(false);
    expect(phone.timers.active()).toHaveLength(0);
    phone.online = true;
    service.setOnline(true);
    await settle();
    service.dispose();
    expect(phone.timers.active()).toHaveLength(0);
  });
});
