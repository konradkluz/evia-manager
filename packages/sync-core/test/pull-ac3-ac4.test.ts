import { describe, expect, it } from 'vitest';
import { FakeSession, USER_A, USER_B } from './helpers.ts';
import {
  FakeReplica,
  SERVER_NOW,
  aggregate,
  cur,
  del,
  iso,
  makePull,
  page,
  resync,
  uid,
  upsert,
  type PullHarness,
} from './pull-helpers.ts';

const QUICK = '0194c2a0-0000-7000-8000-0000000000e1';
const COMMENT = '0194c2a0-0000-7000-8000-0000000000c1';
const wo1 = uid('work_order', 1);

async function seed(h: PullHarness): Promise<void> {
  h.transport.changesScript.push(page([...aggregate(1), ...aggregate(2)], { cursor: 1 }));
  await h.pull.pull();
}

async function pendingComment(h: PullHarness, workOrderId = wo1): Promise<void> {
  await h.core.queue.enqueue({
    type: 'CreateComment',
    commandVersion: 1,
    orderingKey: workOrderId,
    payload: { id: COMMENT, workOrderId, body: 'synthetic comment', capturedAt: iso(SERVER_NOW) },
  });
}

describe('pending objects are protected (EVM-092 AC3)', () => {
  it('EVM-092 AC3: a delete of the work order removes the server copy but the pending comment and its mutation stay untouched', async () => {
    const h = makePull();
    await seed(h);
    await pendingComment(h);
    const before = JSON.stringify(h.queue.data);
    h.transport.changesScript.push(page([del('work_order', 1, 1)], { cursor: 2 }));
    await h.pull.pull();
    expect(h.replica.has('work_order', wo1)).toBe(false);
    expect(JSON.stringify(h.queue.data)).toBe(before);
    expect(h.queue.records()).toHaveLength(1);
  });

  it('EVM-092 AC3: the push side then answers target_unavailable and the comment goes to "needs attention", not away (scenario 1)', async () => {
    const h = makePull();
    await seed(h);
    await pendingComment(h);
    h.transport.changesScript.push(page([del('work_order', 1, 1)], { cursor: 2 }));
    await h.pull.pull();
    const record = h.queue.records()[0];
    h.server.rejectCodes.set(record?.mutationId ?? '', 'target_unavailable');
    await h.core.engine.flush();
    expect(h.queue.records()[0]?.state).toBe('needs_attention');
    expect(h.queue.records()[0]?.lastCode).toBe('target_unavailable');
  });

  it('EVM-092 AC3: forbidden also lands on "needs attention" and the data stay', async () => {
    const h = makePull();
    await seed(h);
    await pendingComment(h);
    h.server.rejectCodes.set(h.queue.records()[0]?.mutationId ?? '', 'forbidden');
    await h.core.engine.flush();
    expect(h.queue.records()[0]?.lastCode).toBe('forbidden');
  });

  it('EVM-092 AC3: a delete marker whose id is a pending object (confirmed by the server, result lost) is not applied', async () => {
    const h = makePull();
    h.transport.changesScript.push(page([upsert('work_order', 1, 1, { id: QUICK, customerId: null, siteId: null })], { cursor: 1 }));
    await h.pull.pull();
    await h.core.queue.enqueue({
      type: 'CreateQuickWorkOrder',
      commandVersion: 1,
      orderingKey: QUICK,
      payload: { workOrderId: QUICK, templateId: uid('customer', 5), title: 'Quick' },
    });
    h.transport.changesScript.push(page([{ op: 'delete', type: 'work_order', id: QUICK }], { cursor: 2 }));
    await h.pull.pull();
    expect(h.replica.has('work_order', QUICK)).toBe(true);
    expect(h.queue.records()).toHaveLength(1);
  });

  it('EVM-092 AC3: a closed work order older than N days leaves the scope, unless a pending mutation belongs to it; the boundary is N days by server time (scenario 3)', async () => {
    const h = makePull();
    const day = 86_400_000;
    const closed = (n: number, ageDays: number) =>
      upsert('work_order', n, 1, { status: 'settled', closedAt: iso(SERVER_NOW - ageDays * day), customerId: null, siteId: null });
    h.transport.changesScript.push(page([closed(1, 29), closed(2, 30), closed(3, 31), closed(4, 31)], { cursor: 1 }));
    await h.core.queue.enqueue({
      type: 'CreateNote',
      commandVersion: 1,
      orderingKey: uid('work_order', 4),
      payload: { id: COMMENT, workOrderId: uid('work_order', 4), body: 'synthetic note' },
    });
    await h.pull.pull();
    expect([1, 2, 3, 4].map((n) => h.replica.has('work_order', uid('work_order', n)))).toEqual([true, true, false, true]);
    expect(h.queue.records()).toHaveLength(1);
  });

  it('EVM-092 AC3: the time rule uses the server time, not the phone clock (phone one year ahead)', async () => {
    const h = makePull();
    h.clock.advance(365 * 86_400_000);
    h.transport.changesScript.push(
      page(
        [upsert('work_order', 1, 1, { status: 'cancelled', closedAt: iso(SERVER_NOW - 5 * 86_400_000), customerId: null, siteId: null })],
        { cursor: 1 },
      ),
    );
    await h.pull.pull();
    expect(h.replica.has('work_order', wo1)).toBe(true);
  });

  it('EVM-092 AC3: an existing customer and site referenced by a pending quick work order are not removed as orphans (scenario 2)', async () => {
    const h = makePull();
    h.transport.changesScript.push(page([upsert('customer', 7), upsert('site', 7), upsert('customer', 8)], { cursor: 1 }));
    await h.core.queue.enqueue({
      type: 'CreateQuickWorkOrder',
      commandVersion: 1,
      orderingKey: QUICK,
      payload: {
        workOrderId: QUICK,
        templateId: uid('customer', 5),
        title: 'Quick',
        customerId: uid('customer', 7),
        siteId: uid('site', 7),
      },
    });
    await h.pull.pull();
    expect(h.replica.has('customer', uid('customer', 7))).toBe(true);
    expect(h.replica.has('site', uid('site', 7))).toBe(true);
    expect(h.replica.has('customer', uid('customer', 8))).toBe(false);
  });

  it('EVM-092 AC3: resync_required leaves the queue byte for byte and the old replica readable until the new one is complete (scenario 2)', async () => {
    const h = makePull();
    await seed(h);
    await pendingComment(h);
    const before = JSON.stringify(h.queue.data);
    h.transport.changesScript.push(resync('periodic'), page(aggregate(3), { phase: 'snapshot', cursor: 5, hasMore: true }), {
      kind: 'network',
    });
    const result = await h.pull.pull();
    expect(result.status).toBe('retry');
    expect(h.replica.has('work_order', uid('work_order', 1))).toBe(true);
    expect(h.replica.has('work_order', uid('work_order', 3))).toBe(false);
    expect(JSON.stringify(h.queue.data)).toBe(before);
  });

  it('EVM-092 AC3: the source of pending objects ignores other users and corrupt entries', async () => {
    const session = new FakeSession(USER_A);
    const h = makePull({ session });
    h.queue.data.push({ not: 'a record' });
    await pendingComment(h);
    session.userId = USER_B;
    h.transport.changesScript.push(page([{ op: 'delete', type: 'timeline_entry', id: COMMENT }], { cursor: 1 }));
    expect((await h.pull.pull()).status).toBe('complete');
  });
});

describe('resync in a shadow generation (EVM-092 AC4)', () => {
  for (const [serverReason, mapped] of [
    ['periodic', 'periodic'],
    ['cursor_expired', 'cursor_expired'],
    ['cursor_invalid', 'cursor_invalid'],
    ['scope_changed', 'scope_changed'],
    ['reason_from_the_future', 'periodic'],
  ] as const) {
    it(`EVM-092 AC4: resync_required "${serverReason}" downloads a new replica from zero beside the old one and swaps it in once complete`, async () => {
      const h = makePull();
      await seed(h);
      h.transport.changesScript.push(
        resync(serverReason),
        page(aggregate(3), { phase: 'snapshot', cursor: 10, hasMore: true }),
        page([], { phase: 'changes', cursor: 11, hasMore: false }),
      );
      const result = await h.pull.pull();
      expect(result.status).toBe('complete');
      expect(h.transport.changeRequests.map((r) => r.cursor).slice(1)).toEqual([cur(1), undefined, cur(10)]);
      expect(h.events).toContainEqual({ kind: 'resync_scheduled', reason: mapped });
      expect(h.events).toContainEqual({ kind: 'resync_completed' });
      expect(h.replica.has('work_order', uid('work_order', 1))).toBe(false);
      expect(h.replica.has('work_order', uid('work_order', 3))).toBe(true);
      expect(h.replica.active().cursor).toBe(cur(11));
    });
  }

  it('EVM-092 AC4: while the shadow is being downloaded the old replica is neither changed nor deleted, and the swap is atomic', async () => {
    const h = makePull();
    await seed(h);
    const before = h.replica.image();
    h.transport.changesScript.push(resync('periodic'), page(aggregate(3), { phase: 'snapshot', cursor: 10, hasMore: true }), {
      kind: 'network',
    });
    await h.pull.pull();
    expect(h.replica.image()).toBe(before);
    expect(h.replica.shadow()?.cursor).toBe(cur(10));
    h.clock.advance(60 * 60_000);
    h.transport.changesScript.push(page([], { phase: 'changes', cursor: 11, hasMore: false }));
    h.replica.failOn = { method: 'promoteShadow', call: 1 };
    expect((await h.pull.pull()).status).toBe('retry');
    expect(h.replica.image()).toBe(before);
    expect(h.replica.shadow()?.complete).toBe(true);
  });

  it('EVM-092 AC4: an interrupted shadow continues from the cursor of the new generation after a restart; a crash at the swap leaves the old replica', async () => {
    const h = makePull();
    await seed(h);
    h.transport.changesScript.push(resync('periodic'), page(aggregate(3), { phase: 'snapshot', cursor: 10, hasMore: true }), {
      kind: 'network',
    });
    await h.pull.pull();
    const restarted = makePull({ disk: h.replica.disk, queue: h.queue });
    restarted.transport.changesScript.push(page([], { phase: 'changes', cursor: 11, hasMore: false }));
    expect((await restarted.pull.pull()).status).toBe('complete');
    expect(restarted.transport.changeRequests[0]?.cursor).toBe(cur(10));
    expect(restarted.replica.has('work_order', uid('work_order', 3))).toBe(true);
    expect(restarted.replica.shadow()).toBeUndefined();
  });

  it('EVM-092 AC4: the shadow also gets increments of the stream; the active replica takes none while a resync is in progress', async () => {
    const h = makePull();
    await seed(h);
    h.transport.changesScript.push(resync('periodic'), page(aggregate(3), { phase: 'snapshot', cursor: 10, hasMore: true }), {
      kind: 'network',
    });
    await h.pull.pull();
    h.clock.advance(60 * 60_000);
    h.transport.changesScript.push(page([upsert('work_order', 1, 9)], { phase: 'snapshot', cursor: 12, hasMore: true }), {
      kind: 'network',
    });
    await h.pull.pull();
    expect(h.replica.versionOf('work_order', wo1)).toBe(1);
  });

  it('EVM-092 AC4: a locally unreadable cursor (outside the pattern) starts a shadow resync without sending that cursor, reason cursor_invalid', async () => {
    const h = makePull();
    await seed(h);
    h.replica.active().cursor = 'not a cursor!';
    h.transport.changesScript.push(page(aggregate(3), { phase: 'changes', cursor: 20, hasMore: false }));
    expect((await h.pull.pull()).status).toBe('complete');
    expect(h.transport.changeRequests.map((r) => r.cursor).slice(1)).toEqual([undefined]);
    expect(h.events).toContainEqual({ kind: 'resync_scheduled', reason: 'cursor_invalid' });
    expect(JSON.stringify(h.events)).not.toContain('not a cursor');
  });

  it('EVM-092 AC4: a non-string stored cursor and a corrupt shadow cursor restart the download', async () => {
    const h = makePull();
    await seed(h);
    h.replica.active().cursor = 42;
    h.transport.changesScript.push(page(aggregate(3), { phase: 'snapshot', cursor: 20, hasMore: true }), { kind: 'network' });
    await h.pull.pull();
    (h.replica.shadow() as { cursor: unknown }).cursor = { evil: true };
    h.clock.advance(60 * 60_000);
    h.transport.changesScript.push(page(aggregate(4), { phase: 'changes', cursor: 30, hasMore: false }));
    expect((await h.pull.pull()).status).toBe('complete');
    expect(h.transport.changeRequests[3]?.cursor).toBeUndefined();
    expect(h.replica.has('work_order', uid('work_order', 4))).toBe(true);
  });

  it('EVM-092 AC4: 400 invalid_cursor is a security event of the server: unexpected_response pause, no resync loop', async () => {
    const h = makePull();
    await seed(h);
    h.transport.changesScript.push({ kind: 'http', status: 400, code: 'invalid_cursor' });
    const result = await h.pull.pull();
    expect(result.status).toBe('paused');
    expect(result.paused).toBe('unexpected_response');
    expect(h.replica.shadow()).toBeUndefined();
    expect(h.transport.changeRequests).toHaveLength(2);
  });

  it('EVM-092 AC4: a server that answers resync_required forever does not make an endless loop in one cycle', async () => {
    const h = makePull();
    await seed(h);
    for (let i = 0; i < 10; i += 1) h.transport.changesScript.push(resync('periodic'));
    expect((await h.pull.pull()).status).toBe('retry');
    expect(h.transport.changeRequests.length).toBeLessThanOrEqual(6);
  });

  it('EVM-092 AC4: access_changed removes the replica at once (both generations, cursors, lists), keeps the queue and downloads anew into the active generation', async () => {
    const h = makePull();
    await seed(h);
    await pendingComment(h);
    const queueBefore = JSON.stringify(h.queue.data);
    h.transport.changesScript.push(resync('access_changed'), { kind: 'network' });
    const result = await h.pull.pull();
    expect(result.status).toBe('retry');
    expect(Object.keys(h.replica.active().entities)).toHaveLength(0);
    expect(h.replica.active().cursor).toBeNull();
    expect(JSON.stringify(h.queue.data)).toBe(queueBefore);
    expect(h.events).toContainEqual({ kind: 'replica_wiped', reason: 'access_changed' });
    h.clock.advance(60 * 60_000);
    h.transport.changesScript.push(page(aggregate(9), { phase: 'changes', cursor: 40, hasMore: false }));
    await h.pull.pull();
    expect(h.transport.changeRequests.at(-1)?.cursor).toBeUndefined();
    expect(h.replica.has('work_order', uid('work_order', 9))).toBe(true);
    expect(h.replica.has('work_order', wo1)).toBe(false);
    expect(h.replica.has('customer', uid('customer', 1))).toBe(false);
  });

  it('EVM-092 AC4: access_changed during a running shadow removes the shadow too', async () => {
    const h = makePull();
    await seed(h);
    h.transport.changesScript.push(resync('periodic'), page(aggregate(3), { phase: 'snapshot', cursor: 10, hasMore: true }), {
      kind: 'network',
    });
    await h.pull.pull();
    h.clock.advance(60 * 60_000);
    h.transport.changesScript.push(resync('access_changed'), { kind: 'network' });
    await h.pull.pull();
    expect(h.replica.shadow()).toBeUndefined();
    expect(Object.keys(h.replica.active().entities)).toHaveLength(0);
  });

  it('EVM-092 AC4: a failed wipe at access_changed is a store failure and nothing new is downloaded', async () => {
    const h = makePull();
    await seed(h);
    h.replica.failOn = { method: 'wipeReplica', call: 1 };
    h.transport.changesScript.push(resync('access_changed'));
    expect((await h.pull.pull()).status).toBe('retry');
    expect(h.transport.changeRequests).toHaveLength(2);
    expect(h.events).toContainEqual({ kind: 'pull_failed', code: 'store_failure' });
  });
});

describe('replica stores', () => {
  it('EVM-092 AC4: the fake store used by these tests rolls back a crashed transaction completely', async () => {
    const replica = new FakeReplica();
    replica.failOn = { method: 'saveConfig', call: 1 };
    await expect(replica.saveConfig({ x: 1 })).rejects.toThrow();
    expect(replica.disk.data.config).toBeNull();
    await replica.discardShadow();
  });
});
