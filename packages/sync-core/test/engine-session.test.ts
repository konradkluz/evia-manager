import { describe, expect, it } from 'vitest';
import { FakeSession, InMemoryQueueStore, USER_A, USER_B, makeCore, noteInput } from './helpers.ts';

const wo = (n: number): string => `0194c2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('engine: session and version (EVM-091 AC6)', () => {
  it('EVM-091 AC6: 401 session_revoked leaves the queue untouched, pauses, signals "drop the replica, keep the queue" once and sends nothing more', async () => {
    const { core, store, server, events } = makeCore();
    await core.queue.enqueue(noteInput(wo(1)));
    await core.queue.enqueue(noteInput(wo(2)));
    const before = JSON.stringify(store.data);
    server.script.push({ kind: 'http', status: 401, code: 'session_revoked' });
    const result = await core.engine.flush();
    expect(result.paused).toBe('session_revoked');
    expect(JSON.stringify(store.data)).toBe(before);
    await core.engine.flush();
    await core.engine.flush();
    expect(server.requests).toHaveLength(1);
    expect(events.filter((e) => e.kind === 'signal' && e.signal === 'session_revoked')).toHaveLength(1);
    expect(server.script).toHaveLength(0);
  });

  it('EVM-091 AC6: resume after session_revoked works only for the same userId after a full sign-in; another user is refused (SR-MOB-13)', async () => {
    const { core, store, server, session, events } = makeCore();
    await core.queue.enqueue(noteInput(wo(1)));
    server.script.push({ kind: 'http', status: 401, code: 'session_revoked' });
    await core.engine.flush();
    session.userId = null;
    expect(await core.engine.resume()).toBe(false);
    session.userId = USER_B;
    expect(await core.engine.resume()).toBe(false);
    expect(events.some((e) => e.kind === 'signal' && e.signal === 'owner_mismatch')).toBe(true);
    expect((await core.engine.flush()).paused).toBe('session_revoked');
    expect(server.requests).toHaveLength(1);
    session.userId = USER_A;
    expect(await core.engine.resume()).toBe(true);
    expect(await core.engine.resume()).toBe(true);
    await core.engine.flush();
    expect(store.records()).toHaveLength(0);
  });

  it('EVM-091 AC6: 401 device_wipe_required signals a full wipe once, sends nothing more, does not refresh and cannot be resumed or overridden', async () => {
    const { core, store, server, session, events } = makeCore();
    await core.queue.enqueue(noteInput(wo(1)));
    server.script.push({ kind: 'http', status: 401, code: 'device_wipe_required' });
    await core.engine.flush();
    expect(session.refreshCalls).toBe(0);
    expect(await core.engine.resume()).toBe(false);
    session.userId = USER_A;
    await core.engine.flush();
    server.script.push({ kind: 'http', status: 426 });
    await core.engine.flush();
    expect(server.requests).toHaveLength(1);
    expect(events.filter((e) => e.kind === 'signal' && e.signal === 'device_wipe_required')).toHaveLength(1);
    expect((await core.engine.status()).paused).toBe('device_wipe_required');
    expect(store.records()).toHaveLength(1);
  });

  it('EVM-091 AC6: 426 pauses the queue and keeps it; the signal is raised once; resume is possible after the update', async () => {
    const { core, store, server, events } = makeCore();
    await core.queue.enqueue(noteInput(wo(1)));
    server.script.push({ kind: 'http', status: 426 });
    const result = await core.engine.flush();
    expect(result.paused).toBe('upgrade_required');
    expect(events.filter((e) => e.kind === 'signal' && e.signal === 'upgrade_required')).toHaveLength(1);
    expect(store.records()[0]?.state).toBe('pending');
    await core.engine.flush();
    expect(server.requests).toHaveLength(1);
    expect(await core.engine.resume()).toBe(true);
    await core.engine.flush();
    expect(store.records()).toHaveLength(0);
  });

  it('EVM-091 AC6: 401 without a code triggers exactly one refresh and one resend of the same batch', async () => {
    const { core, server, session, store } = makeCore();
    await core.queue.enqueue(noteInput(wo(1)));
    server.script.push({ kind: 'http', status: 401 });
    await core.engine.flush();
    expect(session.refreshCalls).toBe(1);
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1]).toEqual(server.requests[0]);
    expect(store.records()).toHaveLength(0);
  });

  it('EVM-091 AC6: a second 401 after the refresh stops with auth_required — no loop, queue intact', async () => {
    const { core, server, session, store, events } = makeCore();
    await core.queue.enqueue(noteInput(wo(1)));
    server.script.push({ kind: 'http', status: 401 }, { kind: 'http', status: 401, code: 'unauthenticated' });
    const result = await core.engine.flush();
    expect(result.paused).toBe('auth_required');
    expect(session.refreshCalls).toBe(1);
    expect(server.requests).toHaveLength(2);
    expect(store.records()).toHaveLength(1);
    expect(events.filter((e) => e.kind === 'signal' && e.signal === 'auth_required')).toHaveLength(1);
    expect(await core.engine.resume()).toBe(true);
  });

  it('EVM-091 AC6: a refresh answered with session_revoked behaves like session_revoked (queue kept, replica to be dropped)', async () => {
    const { core, server, session, store, events } = makeCore();
    await core.queue.enqueue(noteInput(wo(1)));
    session.refreshResult = 'session_revoked';
    server.script.push({ kind: 'http', status: 401 });
    const result = await core.engine.flush();
    expect(result.paused).toBe('session_revoked');
    expect(events.some((e) => e.kind === 'signal' && e.signal === 'session_revoked')).toBe(true);
    expect(store.records()).toHaveLength(1);
    expect(server.requests).toHaveLength(1);
  });

  it('EVM-100 AC5: a refresh answered with device_wipe_required pauses with the terminal wipe signal (not session_revoked), queue untouched, no resume', async () => {
    const { core, server, session, store, events } = makeCore();
    await core.queue.enqueue(noteInput(wo(1)));
    session.refreshResult = 'device_wipe_required';
    server.script.push({ kind: 'http', status: 401 });
    const result = await core.engine.flush();
    expect(result.paused).toBe('device_wipe_required');
    expect(events.filter((e) => e.kind === 'signal' && e.signal === 'device_wipe_required')).toHaveLength(1);
    expect(events.some((e) => e.kind === 'signal' && e.signal === 'session_revoked')).toBe(false);
    expect(store.records()).toHaveLength(1);
    expect(server.requests).toHaveLength(1);
    expect(await core.engine.resume()).toBe(false);
    expect(session.refreshCalls).toBe(1);
  });

  it('EVM-091 AC6: a refresh that is unavailable or throws stops with auth_required without dropping anything', async () => {
    for (const mode of ['unavailable', 'throws'] as const) {
      const { core, server, session, store } = makeCore();
      await core.queue.enqueue(noteInput(wo(1)));
      if (mode === 'unavailable') session.refreshResult = 'unavailable';
      else session.refresh = () => Promise.reject(new Error('token refresh failed for synthetic-token-123'));
      server.script.push({ kind: 'http', status: 401 });
      const result = await core.engine.flush();
      expect(result.paused).toBe('auth_required');
      expect(store.records()).toHaveLength(1);
    }
  });

  it('EVM-091 AC6: parallel flush triggers that meet a 401 share one refresh (single-flight)', async () => {
    const { core, server, session } = makeCore();
    await core.queue.enqueue(noteInput(wo(1)));
    let release: () => void = () => undefined;
    session.refreshDelay = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.script.push({ kind: 'http', status: 401 });
    const flushes = [core.engine.flush(), core.engine.flush(), core.engine.flush()];
    await Promise.resolve();
    release();
    await Promise.all(flushes);
    expect(session.refreshCalls).toBe(1);
    expect(server.requests).toHaveLength(2);
  });

  it('EVM-091 AC6: without a session nothing is sent and the engine asks for sign-in', async () => {
    const { core, server, session, events } = makeCore();
    await core.queue.enqueue(noteInput(wo(1)));
    session.userId = null;
    const result = await core.engine.flush();
    expect(result.paused).toBe('auth_required');
    expect(server.requests).toHaveLength(0);
    expect(events.some((e) => e.kind === 'signal' && e.signal === 'auth_required')).toBe(true);
  });

  it('EVM-091 AC6: 403 for the whole batch pauses without deleting or looping; so does an unexpected status', async () => {
    for (const [status, reason] of [
      [403, 'forbidden'],
      [404, 'unexpected_response'],
      [415, 'unexpected_response'],
      [302, 'unexpected_response'],
    ] as const) {
      const { core, server, store } = makeCore();
      await core.queue.enqueue(noteInput(wo(1)));
      server.script.push({ kind: 'http', status });
      const result = await core.engine.flush();
      expect(result.paused).toBe(reason);
      await core.engine.flush();
      expect(server.requests).toHaveLength(1);
      expect(store.records()).toHaveLength(1);
      expect(await core.engine.resume()).toBe(true);
    }
  });

  it('EVM-091 AC6: mutations of another user are never sent and stay untouched; the SR-MOB-13 signal is raised once', async () => {
    const store = new InMemoryQueueStore();
    const a = makeCore({ store });
    const mineA = await a.core.queue.enqueue(noteInput(wo(1)));
    const b = makeCore({ store, session: new FakeSession(USER_B), server: a.server, seed: 99 });
    const mineB = await b.core.queue.enqueue(noteInput(wo(2)));
    const snapshotA = JSON.stringify(store.records().find((r) => r.mutationId === mineA.mutationId));
    await b.core.engine.flush();
    await b.core.engine.flush();
    expect(a.server.allMutationIds()).toEqual([mineB.mutationId]);
    expect(JSON.stringify(store.records().find((r) => r.mutationId === mineA.mutationId))).toBe(snapshotA);
    expect(b.events.filter((e) => e.kind === 'signal' && e.signal === 'owner_mismatch')).toHaveLength(1);
    expect(await b.core.engine.status()).toMatchObject({ ownerUserId: USER_B, foreign: 1, pending: 0 });
  });

  it('EVM-091 AC6: the owner is checked before every batch — a session change in the middle of a flush switches the mutations that are sent', async () => {
    const store = new InMemoryQueueStore();
    const a = makeCore({ store, options: { maxBatchSize: 1 } });
    const first = await a.core.queue.enqueue(noteInput(wo(1)));
    const b = makeCore({ store, server: a.server, session: new FakeSession(USER_B), seed: 99 });
    const second = await b.core.queue.enqueue(noteInput(wo(2)));
    a.server.script.push((request) => {
      a.session.userId = USER_B;
      return { kind: 'ok', body: { results: request.mutations.map((m) => ({ mutationId: m.mutationId, outcome: 'applied' })) } };
    });
    await a.core.engine.flush();
    expect(a.server.allMutationIds()).toEqual([first.mutationId, second.mutationId]);
  });

  it('EVM-091 AC6: the status gives the age and the counts for the indicator (oldest entry, retrying, pending)', async () => {
    const { core, server, clock } = makeCore();
    await core.queue.enqueue(noteInput(wo(1)));
    const created = clock.now();
    clock.advance(60_000);
    await core.queue.enqueue(noteInput(wo(2)));
    const status = await core.engine.status();
    expect(status).toMatchObject({ pending: 2, oldestCreatedAt: created, ownerUserId: USER_A });
    expect(status.nextAttemptAt).toBeUndefined();
    server.script.push({ kind: 'network' });
    await core.engine.flush();
    expect((await core.engine.status()).retrying).toBe(2);
  });

  it('EVM-091 AC6: a failing event sink never breaks synchronization', async () => {
    const { core, store } = makeCore();
    const broken = makeCore({ store });
    const failing = (await import('../src/index.ts')).createSyncCore({
      store,
      transport: broken.server,
      clock: broken.clock,
      random: { getRandomValues: (b) => b.fill(1) },
      session: broken.session,
      events: {
        emit: () => {
          throw new Error('sink exploded');
        },
      },
    });
    await failing.queue.enqueue(noteInput(wo(3)));
    const result = await failing.engine.flush();
    expect(result.settled).toBe(1);
    expect(core).toBeDefined();
  });
});
