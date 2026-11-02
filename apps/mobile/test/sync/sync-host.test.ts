import { SyncHost } from '../../src/sync/sync-host';
import { IDLE_SNAPSHOT } from '../../src/sync/types';
import { NOTE_WO, Phone, ScriptedServer, aggregate, notePayload, page, settle } from './harness';

let phone: Phone;
beforeEach(async () => {
  phone = new Phone();
  await phone.open();
});
afterEach(() => {
  phone.close();
});

describe('synchronization host (EVM-107 AC2, AC5; security S2, S3)', () => {
  it('EVM-107 AC5: without a store (the owner check did not pass: another user owns the queue) no service is created and nothing is sent', async () => {
    const server = new ScriptedServer();
    const created: string[] = [];
    const host = new SyncHost(
      (_store, hooks) => {
        created.push('created');
        return phone.service(server, { isOnline: hooks.isOnline, onPause: hooks.onPause });
      },
      () => null,
    );
    host.setOnline(true);
    host.startSession();
    await settle();
    expect(created).toEqual([]);
    expect(server.order).toEqual([]);
    expect(host.running).toBe(false);
    expect(host.getSnapshot()).toBe(IDLE_SNAPSHOT);
  });

  it('EVM-107 AC2: with a store one service runs per session; a new session replaces it, stop() disposes it and nothing starts afterwards', async () => {
    const server = new ScriptedServer();
    server.changes.push(page(aggregate(1), { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }));
    const services: ReturnType<Phone['service']>[] = [];
    const host = new SyncHost(
      (_store, hooks) => {
        const service = phone.service(server, { isOnline: hooks.isOnline, onPause: hooks.onPause });
        services.push(service);
        return service;
      },
      () => phone.store(),
    );
    const notifications: number[] = [];
    host.subscribe(() => notifications.push(1));
    host.setOnline(true);
    host.startSession();
    await settle();
    expect(host.running).toBe(true);
    expect(host.getSnapshot().initialLoad).toBe('done');
    expect(notifications.length).toBeGreaterThan(0);
    host.startSession();
    expect(services).toHaveLength(2);
    expect(services[0]?.isDisposed()).toBe(true);
    host.stop();
    expect(services[1]?.isDisposed()).toBe(true);
    expect(host.running).toBe(false);
    expect(host.getSnapshot()).toBe(IDLE_SNAPSHOT);
    const requests = server.order.length;
    host.foreground();
    host.trigger();
    host.setOnline(false);
    host.setOnline(true);
    await settle();
    expect(server.order.length).toBe(requests);
    host.stop();
  });

  it('EVM-107 AC2: the host delegates the queue and the operations to the current service, and answers safely when there is none', async () => {
    const server = new ScriptedServer();
    server.changes.push(page(aggregate(1), { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }));
    const host = new SyncHost(
      (_store, hooks) => phone.service(server, { isOnline: hooks.isOnline, onPause: hooks.onPause }),
      () => phone.store(),
    );
    expect(await host.queueView(true)).toEqual({ items: [], sent: [] });
    expect(await host.dependentsOf('x')).toBe(0);
    expect(await host.discard('x')).toEqual({ ok: false, code: 'no_session' });
    expect(await host.recreate('x')).toEqual({ ok: false, code: 'no_session' });
    expect(await host.retarget('x', 'y')).toEqual({ ok: false, code: 'no_session' });
    expect(await host.enqueue({ type: 'CreateNote', commandVersion: 1, payload: notePayload(1) })).toEqual({
      ok: false,
      code: 'no_session',
    });
    expect(await host.copyText('x')).toBeNull();
    expect(await host.retargetOptions(null)).toEqual([]);
    host.setOnline(true);
    host.startSession();
    await settle();
    phone.clockNow += 5_000;
    phone.online = false;
    host.setOnline(false);
    expect(await host.enqueue({ type: 'CreateNote', commandVersion: 1, payload: notePayload(2, NOTE_WO) })).toEqual({ ok: true });
    const view = await host.queueView(true);
    expect(view.items).toHaveLength(1);
    expect(await host.dependentsOf(view.items[0]?.id ?? '')).toBe(0);
    expect(await host.copyText(view.items[0]?.id ?? '')).toBe('synthetic note 2');
    expect(await host.retargetOptions(null)).toHaveLength(1);
    expect(await host.discard(view.items[0]?.id ?? '')).toEqual({ ok: false, code: 'not_attention' });
    expect(await host.recreate(view.items[0]?.id ?? '')).toEqual({ ok: false, code: 'not_attention' });
    expect(await host.retarget(view.items[0]?.id ?? '', 'z')).toEqual({ ok: false, code: 'not_attention' });
    host.stop();
  });

  it('EVM-107 AC5: a pause of the service reaches the listener of the session root, and the listener can be removed', async () => {
    const server = new ScriptedServer();
    server.changes.push({ kind: 'http', status: 426 });
    const host = new SyncHost(
      (_store, hooks) => phone.service(server, { isOnline: hooks.isOnline, onPause: hooks.onPause }),
      () => phone.store(),
    );
    const seen: string[] = [];
    const off = host.onPause((reason) => seen.push(reason));
    host.setOnline(true);
    host.startSession();
    await settle();
    expect(seen).toEqual(['upgrade_required']);
    off();
    host.stop();
  });
});
