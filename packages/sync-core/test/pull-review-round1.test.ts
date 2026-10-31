import { describe, expect, it } from 'vitest';
import { MAX_INVALID_RESYNCS } from '../src/index.ts';
import { FakeSession, USER_A, USER_B, noteInput } from './helpers.ts';
import { SERVER_NOW, aggregate, del, iso, makePull, page, resync, uid, upsert, wireEntity, type PullHarness } from './pull-helpers.ts';

const HOUR = 3_600_000;
const wo = (n: number): string => uid('work_order', n);
const snapshotOk = (entities: unknown[]): { kind: 'ok'; body: unknown } => ({
  kind: 'ok',
  body: { serverTime: iso(SERVER_NOW), entities },
});

async function seeded(h: PullHarness): Promise<void> {
  h.transport.changesScript.push(page(aggregate(1), { cursor: 1 }));
  await h.pull.pull();
}

const badCustomer = (): ReturnType<typeof page> =>
  page([upsert('customer', 8, 1, { phone: 123 })], { phase: 'snapshot', cursor: 10, hasMore: true });

describe('tolerant reader by default (EVM-092 AC6)', () => {
  it('EVM-092 AC6: an extra field in an upsert, in the envelope and in a delete is applied without it, with no resync and no invalid event', async () => {
    const h = makePull();
    h.transport.changesScript.push(page([...aggregate(1), upsert('scope_item', 1, 1)], { cursor: 1 }));
    await h.pull.pull();
    h.clock.advance(HOUR);
    const envelope = { ...upsert('work_order', 2, 1), futureEnvelopeField: 'x' };
    const tombstone = { ...del('scope_item', 1, 2), futureEnvelopeField: 'x' };
    h.transport.changesScript.push(
      page(
        [
          upsert('customer', 2, 1, { futureProjectionField: 'synthetic-extra' }),
          upsert('site', 2, 1),
          envelope,
          tombstone,
          upsert('site', 1, 2, { futureProjectionField: 1 }),
        ],
        { cursor: 2 },
      ),
    );
    const result = await h.pull.pull();
    expect(result.status).toBe('complete');
    expect(h.replica.has('customer', uid('customer', 2))).toBe(true);
    expect(h.replica.has('work_order', wo(2))).toBe(true);
    expect(h.replica.has('scope_item', uid('scope_item', 1))).toBe(false);
    expect(h.replica.versionOf('site', uid('site', 1))).toBe(2);
    expect(JSON.stringify(h.replica.active().entities)).not.toContain('synthetic-extra');
    expect(h.events.some((e) => e.kind === 'change_invalid' || e.kind === 'resync_scheduled')).toBe(false);
    expect(h.replica.disk.data.pendingResync).toBeNull();
  });

  it('EVM-092 AC6: a wrongly typed field still makes the change invalid (resync planned), also with extra fields around it', async () => {
    const h = makePull();
    await seeded(h);
    h.transport.changesScript.push(page([upsert('customer', 8, 1, { phone: 5, futureProjectionField: 1 })], { cursor: 2 }));
    await h.pull.pull();
    expect(h.events).toContainEqual({ kind: 'change_invalid', reason: 'projection_mismatch', type: 'customer' });
    expect(h.events).toContainEqual({ kind: 'resync_scheduled', reason: 'invalid_change' });
  });

  it('EVM-092 AC6: a snapshot entity with an extra field is stored without it', async () => {
    const h = makePull();
    h.transport.changesScript.push(page([upsert('timeline_entry', 5, 1)], { cursor: 1 }));
    h.transport.snapshotScript.set(wo(5), [snapshotOk([wireEntity('work_order', 5, 1, { futureProjectionField: 1 })])]);
    await h.pull.pull();
    expect(h.replica.has('work_order', wo(5))).toBe(true);
    expect(h.events.some((e) => e.kind === 'change_invalid')).toBe(false);
  });
});

describe('first download is not shown as a partial list (EVM-092 AC1)', () => {
  it('EVM-092 AC1: initialLoadDone stays false until the feed ends, survives a lost network and never falls back on later multi-page increments', async () => {
    const h = makePull();
    expect(await h.pull.initialLoadDone()).toBe(false);
    h.transport.changesScript.push(page(aggregate(1), { phase: 'snapshot', cursor: 1, hasMore: true }), { kind: 'network' });
    expect((await h.pull.pull()).status).toBe('retry');
    expect(await h.pull.initialLoadDone()).toBe(false);

    h.clock.advance(HOUR);
    h.transport.changesScript.push(page(aggregate(2), { phase: 'changes', cursor: 2, hasMore: false }));
    expect((await h.pull.pull()).status).toBe('complete');
    expect(await h.pull.initialLoadDone()).toBe(true);

    h.clock.advance(HOUR);
    h.transport.changesScript.push(page(aggregate(3), { cursor: 3, hasMore: true }), { kind: 'network' });
    await h.pull.pull();
    expect(h.replica.active().complete).toBe(false);
    expect(await h.pull.initialLoadDone()).toBe(true);
  });

  it('EVM-092 AC1: a download with a snapshot still to fetch is not done; it is done after the snapshot', async () => {
    const h = makePull();
    h.transport.changesScript.push(page([upsert('timeline_entry', 5, 1)], { cursor: 1 }));
    h.transport.snapshotScript.set(wo(5), [{ kind: 'network' }]);
    await h.pull.pull();
    expect(await h.pull.initialLoadDone()).toBe(false);
    h.clock.advance(HOUR);
    h.transport.snapshotScript.set(wo(5), [snapshotOk([wireEntity('work_order', 5, 1)])]);
    h.transport.changesScript.push(page([], { cursor: 2 }));
    await h.pull.pull({ networkRestored: true });
    expect(await h.pull.initialLoadDone()).toBe(true);
  });

  it('EVM-092 AC1: a promoted shadow generation counts as downloaded', async () => {
    const h = makePull();
    await seeded(h);
    h.transport.changesScript.push(resync('periodic'), page(aggregate(2), { phase: 'changes', cursor: 5, hasMore: false }));
    h.clock.advance(HOUR);
    await h.pull.pull();
    expect(await h.pull.initialLoadDone()).toBe(true);
  });
});

describe('replica of another user is hidden at once (EVM-092 AC4)', () => {
  it('EVM-092 AC4: user B on the replica of user A without network sees no data, before any wipe', async () => {
    const session = new FakeSession(USER_A);
    const first = makePull({ session });
    await seeded(first);
    session.userId = USER_B;
    const second = makePull({ disk: first.replica.disk, queue: first.queue, session });
    expect(await second.pull.visibility()).toEqual({ visible: false, reason: 'owner_mismatch' });
    expect(second.events).toContainEqual({ kind: 'data_hidden', reason: 'owner_mismatch' });
    expect(second.replica.has('work_order', wo(1))).toBe(true);
  });

  it('EVM-092 AC4: the owner still sees own data', async () => {
    const h = makePull();
    await seeded(h);
    expect((await h.pull.visibility()).visible).toBe(true);
  });
});

describe('read-path failures do not stop sending (EVM-092 AC4)', () => {
  it('EVM-092 AC4: 404 on the feed holds only the pull; flush still sends the queue; resume clears the hold', async () => {
    const h = makePull();
    await h.core.queue.enqueue(noteInput(wo(1)));
    h.transport.changesScript.push({ kind: 'http', status: 404 });
    const result = await h.pull.pull();
    expect(result.paused).toBe('unexpected_response');
    const flush = await h.core.engine.flush();
    expect(flush.paused).toBeUndefined();
    expect(h.server.requests).toHaveLength(1);
    expect(h.queue.records()).toHaveLength(0);
    expect((await h.pull.pull()).paused).toBe('unexpected_response');
    expect(h.transport.changeRequests).toHaveLength(1);
    expect(await h.core.resume()).toBe(true);
    h.transport.changesScript.push(page(aggregate(1), { cursor: 1 }));
    expect((await h.pull.pull()).status).toBe('complete');
  });

  it('EVM-092 AC4: sync() keeps pushing while the pull is held', async () => {
    const h = makePull();
    h.transport.changesScript.push({ kind: 'http', status: 404 });
    await h.core.sync();
    await h.core.queue.enqueue(noteInput(wo(1)));
    const cycle = await h.core.sync();
    expect(cycle.flush.paused).toBeUndefined();
    expect(h.server.requests).toHaveLength(1);
    expect(cycle.pull?.paused).toBe('unexpected_response');
  });
});

describe('a resync that keeps failing is escalated (EVM-092 AC4, AC6)', () => {
  it('EVM-092 AC6: after MAX_INVALID_RESYNCS rounds the pull is held with a replica_stale signal; flush works; resume restarts', async () => {
    const h = makePull();
    await seeded(h);
    h.transport.changesScript.push(resync('periodic'), badCustomer());
    for (let round = 1; round < MAX_INVALID_RESYNCS; round += 1) {
      expect((await h.pull.pull()).status).toBe('retry');
      h.clock.advance(HOUR);
      h.transport.changesScript.push(badCustomer());
    }
    const held = await h.pull.pull();
    expect(held.status).toBe('paused');
    expect(held.paused).toBe('replica_stale');
    expect(h.events).toContainEqual({ kind: 'signal', signal: 'replica_stale' });
    expect(h.pull.hold).toBe('replica_stale');
    const requests = h.transport.changeRequests.length;
    h.clock.advance(HOUR);
    expect((await h.pull.pull()).paused).toBe('replica_stale');
    expect(h.transport.changeRequests).toHaveLength(requests);

    await h.core.queue.enqueue(noteInput(wo(1)));
    expect((await h.core.engine.flush()).paused).toBeUndefined();
    expect(h.server.requests).toHaveLength(1);

    expect(await h.core.resume()).toBe(true);
    expect(h.pull.hold).toBeUndefined();
    h.transport.changesScript.push(page(aggregate(9), { phase: 'changes', cursor: 40, hasMore: false }));
    expect((await h.pull.pull()).status).toBe('complete');
    expect(h.replica.has('work_order', wo(9))).toBe(true);
  });

  it('EVM-092 AC6: a successful cycle resets the counter', async () => {
    const h = makePull();
    await seeded(h);
    h.transport.changesScript.push(resync('periodic'), badCustomer());
    await h.pull.pull();
    h.clock.advance(HOUR);
    h.transport.changesScript.push(page(aggregate(2), { phase: 'changes', cursor: 20, hasMore: false }));
    expect((await h.pull.pull()).status).toBe('complete');
    h.clock.advance(HOUR);
    h.transport.changesScript.push(resync('periodic'), badCustomer());
    expect((await h.pull.pull()).status).toBe('retry');
  });
});
