import { describe, expect, it } from 'vitest';
import {
  SERVER_NOW,
  aggregate,
  cur,
  del,
  iso,
  makePull,
  page,
  resync,
  snapshotOf,
  uid,
  upsert,
  wireEntity,
  type PullHarness,
} from './pull-helpers.ts';

const wo = (n: number): string => uid('work_order', n);

/** Complete aggregate of work order n as a snapshot of the server returns it. */
const fullAggregate = (n: number, version = 1): unknown[] => [
  wireEntity('customer', n, 1),
  wireEntity('site', n, 1),
  wireEntity('work_order', n, version),
  wireEntity('timeline_entry', n, 1),
  wireEntity('scope_item', n, 1),
];

async function seeded(h: PullHarness): Promise<void> {
  h.transport.changesScript.push(page(aggregate(1), { cursor: 1 }));
  await h.pull.pull();
}

describe('entering the scope and completeness of references (EVM-092 AC5)', () => {
  it('EVM-092 AC5: a work order unknown locally whose customer is missing is NOT shown; its snapshot is fetched and applied in one go (scenario 5)', async () => {
    const h = makePull();
    h.transport.changesScript.push(page([upsert('work_order', 2, 1)], { cursor: 1 }));
    h.transport.snapshotScript.set(wo(2), [snapshotOf(fullAggregate(2))]);
    let visibleBeforeSnapshot: boolean | undefined;
    const original = h.transport.getWorkOrderSnapshot.bind(h.transport);
    h.transport.getWorkOrderSnapshot = (id) => {
      visibleBeforeSnapshot = h.replica.has('work_order', id);
      return original(id);
    };
    expect((await h.pull.pull()).status).toBe('complete');
    expect(visibleBeforeSnapshot).toBe(false);
    expect(h.transport.snapshotRequests).toEqual([wo(2)]);
    for (const [type, id] of [
      ['work_order', wo(2)],
      ['customer', uid('customer', 2)],
      ['site', uid('site', 2)],
      ['timeline_entry', uid('timeline_entry', 2)],
    ] as const) {
      expect(h.replica.has(type, id), type).toBe(true);
    }
    expect(h.replica.active().hydration).toEqual([]);
    expect(h.events).toContainEqual({ kind: 'hydration', reason: 'missing_reference' });
  });

  it('EVM-092 AC5: a child (timeline entry) of an unknown work order is deferred with reason unknown_anchor and not stored without its order', async () => {
    const h = makePull();
    h.transport.changesScript.push(page([upsert('timeline_entry', 3, 1)], { cursor: 1 }));
    h.transport.snapshotScript.set(wo(3), [{ kind: 'network' }]);
    const result = await h.pull.pull();
    expect(result.status).toBe('retry');
    expect(h.replica.has('timeline_entry', uid('timeline_entry', 3))).toBe(false);
    expect(h.replica.active().hydration).toEqual([{ workOrderId: wo(3), reason: 'unknown_anchor' }]);
    expect(h.replica.active().cursor).toBe(cur(1));
  });

  it('EVM-092 AC5: the hydration list survives a restart and the next cycle fetches the snapshot without any new page', async () => {
    const h = makePull();
    h.transport.changesScript.push(page([upsert('timeline_entry', 3, 1)], { cursor: 1 }));
    h.transport.snapshotScript.set(wo(3), [{ kind: 'http', status: 503 }]);
    await h.pull.pull();
    const restarted = makePull({ disk: h.replica.disk });
    restarted.transport.changesScript.push(page([], { cursor: 2 }));
    restarted.transport.snapshotScript.set(wo(3), [snapshotOf(fullAggregate(3))]);
    expect((await restarted.pull.pull()).status).toBe('complete');
    expect(restarted.replica.has('work_order', wo(3))).toBe(true);
    expect(restarted.replica.active().hydration).toEqual([]);
  });

  it('EVM-092 AC5: a known work order that starts pointing to an unknown site keeps showing its previous state until the snapshot is applied', async () => {
    const h = makePull();
    await seeded(h);
    h.transport.changesScript.push(page([upsert('work_order', 1, 2, { siteId: uid('site', 77), title: 'moved' })], { cursor: 2 }));
    h.transport.snapshotScript.set(wo(1), [{ kind: 'http', status: 429, retryAfter: '5' }]);
    const result = await h.pull.pull();
    expect(result.status).toBe('retry');
    expect(h.replica.versionOf('work_order', wo(1))).toBe(1);
    expect(h.replica.active().hydration).toHaveLength(1);
    h.clock.advance(60_000);
    h.transport.changesScript.push(page([], { cursor: 3 }));
    h.transport.snapshotScript.set(wo(1), [
      snapshotOf([wireEntity('site', 77, 1), wireEntity('work_order', 1, 2, { siteId: uid('site', 77), title: 'moved' })]),
    ]);
    expect((await h.pull.pull()).status).toBe('complete');
    expect(h.replica.versionOf('work_order', wo(1))).toBe(2);
  });

  it('EVM-092 AC5: other missing references (stage party, user of an entry) also fetch the snapshot', async () => {
    const h = makePull();
    await seeded(h);
    h.transport.changesScript.push(
      page(
        [
          upsert('procedure_stage', 1, 1, { waitingPartyId: uid('party', 5) }),
          upsert('timeline_entry', 1, 1, { authorUserId: uid('user', 5) }),
        ],
        { cursor: 2 },
      ),
    );
    h.transport.snapshotScript.set(wo(1), [
      snapshotOf([
        wireEntity('work_order', 1, 1),
        wireEntity('party', 5, 1),
        wireEntity('user', 5, 1),
        wireEntity('procedure_stage', 1, 1, { waitingPartyId: uid('party', 5) }),
        wireEntity('timeline_entry', 1, 1, { authorUserId: uid('user', 5) }),
      ]),
    ]);
    await h.pull.pull();
    expect(h.transport.snapshotRequests).toEqual([wo(1)]);
    expect(h.replica.has('party', uid('party', 5))).toBe(true);
    expect(h.replica.has('timeline_entry', uid('timeline_entry', 1))).toBe(true);
  });

  it('EVM-092 AC5: a reference that arrives in the same page, in any order, needs no snapshot (the result does not depend on the order in the page)', async () => {
    const orders = [
      [upsert('work_order', 5), upsert('site', 5), upsert('customer', 5)],
      [upsert('customer', 5), upsert('work_order', 5), upsert('site', 5)],
      [upsert('site', 5), upsert('customer', 5), upsert('work_order', 5)],
    ];
    for (const changes of orders) {
      const h = makePull();
      h.transport.changesScript.push(page(changes, { cursor: 1 }));
      await h.pull.pull();
      expect(h.transport.snapshotRequests).toEqual([]);
      expect(h.replica.has('work_order', wo(5))).toBe(true);
    }
  });

  it('EVM-092 AC5: a site whose manager party is unknown is deferred and the work orders pointing to it are fetched (one lookup)', async () => {
    const h = makePull();
    await seeded(h);
    h.transport.changesScript.push(page([upsert('site', 1, 2, { managerPartyId: uid('party', 9) })], { cursor: 2 }));
    h.transport.snapshotScript.set(wo(1), [
      snapshotOf([
        wireEntity('party', 9, 1),
        wireEntity('site', 1, 2, { managerPartyId: uid('party', 9) }),
        wireEntity('work_order', 1, 1),
      ]),
    ]);
    await h.pull.pull();
    expect(h.replica.calls['findWorkOrdersBySite']).toBe(1);
    expect(h.replica.versionOf('site', uid('site', 1))).toBe(2);
  });

  it('EVM-092 AC5: a snapshot older than the local version does not overwrite it, and one older than a tombstone does not resurrect the object', async () => {
    const h = makePull();
    h.transport.changesScript.push(page([...aggregate(1, 5), del('timeline_entry', 1, 4)], { cursor: 1 }));
    await h.pull.pull();
    h.transport.changesScript.push(page([upsert('work_order', 1, 6, { siteId: uid('site', 90) })], { cursor: 2 }));
    h.transport.snapshotScript.set(wo(1), [
      snapshotOf([
        wireEntity('site', 90, 1),
        wireEntity('work_order', 1, 3),
        wireEntity('timeline_entry', 1, 3),
        wireEntity('customer', 1, 1),
      ]),
    ]);
    await h.pull.pull();
    expect(h.replica.versionOf('work_order', wo(1))).toBe(5);
    expect(h.replica.has('timeline_entry', uid('timeline_entry', 1))).toBe(false);
  });

  it('EVM-092 AC5: 404 of the snapshot removes the aggregate and the list entry in one transaction; orphans disappear in the sweep', async () => {
    const h = makePull();
    await seeded(h);
    h.transport.changesScript.push(
      page([upsert('timeline_entry', 1, 1), upsert('work_order', 1, 2, { siteId: uid('site', 55) })], { cursor: 2 }),
    );
    h.transport.snapshotScript.set(wo(1), [{ kind: 'http', status: 404, code: 'not_found' }]);
    await h.pull.pull();
    expect(h.replica.has('work_order', wo(1))).toBe(false);
    expect(h.replica.has('timeline_entry', uid('timeline_entry', 1))).toBe(false);
    expect(h.replica.has('customer', uid('customer', 1))).toBe(false);
    expect(h.replica.has('site', uid('site', 1))).toBe(false);
    expect(h.replica.active().hydration).toEqual([]);
    expect(h.events).toContainEqual({ kind: 'hydration', reason: 'not_found' });
  });

  it('EVM-092 AC5: 404 of the snapshot of a pending object does not remove it; a pending comment to a removed order stays in the queue', async () => {
    const h = makePull();
    await seeded(h);
    await h.core.queue.enqueue({
      type: 'CreateComment',
      commandVersion: 1,
      orderingKey: wo(1),
      payload: { id: '0194c2a0-0000-7000-8000-0000000000c2', workOrderId: wo(1), body: 'synthetic', capturedAt: iso(SERVER_NOW) },
    });
    h.transport.changesScript.push(page([upsert('work_order', 1, 2, { siteId: uid('site', 55) })], { cursor: 2 }));
    await h.pull.pull();
    expect(h.replica.has('work_order', wo(1))).toBe(false);
    expect(h.replica.has('customer', uid('customer', 1))).toBe(false);
    expect(h.queue.records()).toHaveLength(1);
  });

  it('EVM-092 AC5: a snapshot that points to another work order (foreign anchor), lacks the order or has a bad entity is invalid: no write, a resync in a shadow is planned', async () => {
    const cases: unknown[][] = [
      [wireEntity('work_order', 1, 2), wireEntity('timeline_entry', 2, 1)],
      [wireEntity('customer', 1, 1)],
      [wireEntity('work_order', 1, 2), wireEntity('customer', 1, 1, { email: 'x@example.invalid' })],
    ];
    for (const entities of cases) {
      const h = makePull();
      await seeded(h);
      h.transport.changesScript.push(page([upsert('work_order', 1, 2, { siteId: uid('site', 55) })], { cursor: 2 }));
      h.transport.snapshotScript.set(wo(1), [snapshotOf(entities)]);
      h.transport.changesScript.push(page(aggregate(1), { phase: 'changes', cursor: 20, hasMore: false }));
      await h.pull.pull();
      expect(h.events).toContainEqual({ kind: 'resync_scheduled', reason: 'invalid_change' });
      expect(h.replica.versionOf('work_order', wo(1))).toBe(1);
      expect(JSON.stringify(h.events)).not.toContain('example.invalid');
    }
  });

  it('EVM-092 AC5: only ids that are UUIDs ever reach the path of the snapshot request; a bad entry on the list is never requested', async () => {
    const h = makePull();
    await seeded(h);
    h.replica.active().hydration = [
      { workOrderId: '../../admin', reason: 'unknown_anchor' },
      { workOrderId: wo(1) + '/x', reason: 'unknown_anchor' },
      { workOrderId: wo(6), reason: 'made_up' } as never,
      'junk' as never,
      null as never,
    ];
    h.transport.changesScript.push(page([], { cursor: 2 }));
    await h.pull.pull();
    expect(h.transport.snapshotRequests).toEqual([]);
  });

  it('EVM-092 AC5: the number of snapshots per cycle is limited; the rest waits on the durable list and no sweep runs on a partial cycle', async () => {
    const h = makePull({ options: { maxHydrationsPerCycle: 2 } });
    h.transport.changesScript.push(
      page([upsert('timeline_entry', 1), upsert('timeline_entry', 2), upsert('timeline_entry', 3)], { cursor: 1 }),
    );
    for (const n of [1, 2, 3]) h.transport.snapshotScript.set(wo(n), [snapshotOf(fullAggregate(n))]);
    h.replica.disk.data.owner = 'user-a-synthetic';
    h.replica.active().entities[`customer:${uid('customer', 99)}`] = {
      type: 'customer',
      id: uid('customer', 99),
      version: 1,
      fields: {},
    };
    const first = await h.pull.pull();
    expect(first.status).toBe('partial');
    expect(h.replica.has('customer', uid('customer', 99))).toBe(true);
    expect(h.replica.active().hydration).toHaveLength(1);
    h.transport.changesScript.push(page([], { cursor: 2 }));
    expect((await h.pull.pull()).status).toBe('complete');
    expect(h.replica.has('customer', uid('customer', 99))).toBe(false);
    expect(h.replica.has('work_order', wo(3))).toBe(true);
  });

  it('EVM-092 AC5: a delete marker of an order on the hydration list takes it off the list; children of an order deleted in the page are dropped without a request', async () => {
    const h = makePull();
    h.transport.changesScript.push(
      page([upsert('timeline_entry', 4, 1)], { cursor: 1 }),
      page([del('work_order', 4, 2), upsert('scope_item', 4)], { cursor: 2 }),
    );
    h.transport.snapshotScript.set(wo(4), [{ kind: 'http', status: 500 }]);
    await h.pull.pull();
    expect(h.replica.active().hydration).toHaveLength(1);
    h.clock.advance(60 * 60_000);
    await h.pull.pull();
    expect(h.replica.active().hydration).toEqual([]);
    expect(h.transport.snapshotRequests).toEqual([wo(4)]);
  });

  it('EVM-092 AC5: the sweep does not run on a cycle that did not finish (offline) and does after a complete one', async () => {
    const h = makePull();
    h.transport.changesScript.push(page([upsert('customer', 50)], { cursor: 1, hasMore: true }), { kind: 'network' });
    expect((await h.pull.pull()).status).toBe('retry');
    expect(h.replica.has('customer', uid('customer', 50))).toBe(true);
    h.clock.advance(60 * 60_000);
    h.transport.changesScript.push(page([], { cursor: 2 }));
    await h.pull.pull();
    expect(h.replica.has('customer', uid('customer', 50))).toBe(false);
    expect(h.events.some((e) => e.kind === 'sweep_done')).toBe(true);
  });

  it('EVM-092 AC5: the reference orders of one order may share a customer; the sweep keeps what a remaining order or its children point to', async () => {
    const h = makePull();
    h.transport.changesScript.push(
      page(
        [
          upsert('party', 1),
          upsert('user', 1),
          upsert('site', 1, 1, { managerPartyId: uid('party', 1) }),
          upsert('customer', 1),
          upsert('work_order', 1, 1, { coordinatorUserId: uid('user', 1) }),
          upsert('party', 2),
          upsert('user', 2),
        ],
        { cursor: 1 },
      ),
    );
    await h.pull.pull();
    expect(
      ['party:1', 'user:1', 'site:1', 'customer:1'].every((k) =>
        h.replica.has(k.split(':')[0] as 'party', uid(k.split(':')[0] as 'party', 1)),
      ),
    ).toBe(true);
    expect(h.replica.has('party', uid('party', 2))).toBe(false);
    expect(h.replica.has('user', uid('user', 2))).toBe(false);
  });
});

describe('validation of server data (EVM-092 AC6)', () => {
  it('EVM-092 AC6: an unknown value of an extensible vocabulary is stored as "unknown" (SR-MOB-10)', async () => {
    const h = makePull();
    h.transport.changesScript.push(
      page([upsert('work_order', 1, 1, { status: 'galactic_empire', customerId: null, siteId: null })], { cursor: 1 }),
    );
    await h.pull.pull();
    expect(h.replica.active().entities[`work_order:${uid('work_order', 1)}`]?.fields['status']).toBe('unknown');
    expect(h.replica.shadow()).toBeUndefined();
  });

  it('EVM-092 AC6: an invalid change is not stored and not skipped silently: valid changes of the page are applied, the cursor moves and a full resync is planned in the same transaction', async () => {
    const h = makePull();
    await seeded(h);
    h.transport.changesScript.push(
      page([upsert('customer', 7, 1), upsert('customer', 8, 1, { phone: 123 }), { op: 'upsert' }], { cursor: 2 }),
      page(aggregate(1), { phase: 'changes', cursor: 30, hasMore: false }),
    );
    expect((await h.pull.pull()).status).toBe('complete');
    expect(h.events).toContainEqual({ kind: 'change_invalid', reason: 'projection_mismatch', type: 'customer' });
    expect(h.events).toContainEqual({ kind: 'change_invalid', reason: 'malformed', type: 'unknown' });
    expect(h.events).toContainEqual({ kind: 'resync_scheduled', reason: 'invalid_change' });
    expect(h.transport.changeRequests.at(-1)?.cursor).toBeUndefined();
    expect(h.replica.has('customer', uid('customer', 8))).toBe(false);
  });

  it('EVM-092 AC6: a crash between the page with an invalid change and the start of the shadow does not lose the resync (durable intent)', async () => {
    const h = makePull();
    await seeded(h);
    h.transport.changesScript.push(page([upsert('customer', 7, 1), upsert('customer', 8, 1, { phone: 123 })], { cursor: 2 }));
    h.replica.failOn = { method: 'beginShadow', call: 1 };
    expect((await h.pull.pull()).status).toBe('retry');
    expect(h.replica.disk.data.pendingResync).toEqual({ reason: 'invalid_change' });
    expect(h.replica.active().cursor).toBe(cur(2));
    expect(h.replica.has('customer', uid('customer', 7))).toBe(true);
    const restarted = makePull({ disk: h.replica.disk });
    restarted.transport.changesScript.push(page(aggregate(5), { phase: 'changes', cursor: 40, hasMore: false }));
    expect((await restarted.pull.pull()).status).toBe('complete');
    expect(restarted.transport.changeRequests[0]?.cursor).toBeUndefined();
    expect(restarted.replica.has('work_order', wo(5))).toBe(true);
    expect(restarted.replica.disk.data.pendingResync).toBeNull();
  });

  it('EVM-092 AC6: a pending resync with an unknown reason in the store is treated as periodic; one that is not an object too', async () => {
    for (const intent of [{ reason: 'strange' }, 'junk']) {
      const h = makePull();
      await seeded(h);
      (h.replica.disk.data as { pendingResync: unknown }).pendingResync = intent;
      h.transport.changesScript.push(page(aggregate(5), { phase: 'changes', cursor: 40, hasMore: false }));
      await h.pull.pull();
      expect(h.events).toContainEqual({ kind: 'resync_scheduled', reason: 'periodic' });
    }
  });

  it('EVM-092 AC6: an unknown type is skipped without a resync and the cursor goes on; it is counted without any id', async () => {
    const h = makePull();
    h.transport.changesScript.push(
      page(
        [
          { op: 'upsert', entity: { type: 'hologram', id: 'x', version: 1, secret: 'synthetic-secret' } },
          { op: 'delete', type: 'hologram', id: uid('user', 1) },
          upsert('customer', 1),
        ],
        { cursor: 1 },
      ),
    );
    expect((await h.pull.pull()).status).toBe('complete');
    expect(h.events).toContainEqual({ kind: 'change_unknown_skipped', count: 2 });
    expect(h.replica.active().cursor).toBe(cur(1));
    expect(h.replica.shadow()).toBeUndefined();
    expect(JSON.stringify(h.events)).not.toContain('hologram');
  });

  it('EVM-092 AC6: an invalid change met while a resync is already running does not start another one: backoff, nothing applied, old replica stays', async () => {
    const h = makePull();
    await seeded(h);
    h.transport.changesScript.push(
      resync('periodic'),
      page([upsert('customer', 8, 1, { phone: 123 })], { phase: 'snapshot', cursor: 10, hasMore: true }),
    );
    const result = await h.pull.pull();
    expect(result.status).toBe('retry');
    expect(h.replica.shadow()?.cursor).toBeNull();
    expect(h.events).toContainEqual({
      kind: 'pull_retry_scheduled',
      code: 'invalid_change_in_resync',
      attempts: 1,
      delayMs: expect.any(Number) as number,
    });
    expect(h.replica.has('work_order', wo(1))).toBe(true);
  });

  it('EVM-092 AC6: a malformed page (shape, too many changes, bad cursor, bad time) is a transient error and changes nothing', async () => {
    const bad: unknown[] = [
      'not an object',
      { result: 'changes', phase: 'changes', changes: [], cursor: 'short', hasMore: false, serverTime: iso(SERVER_NOW) },
      { result: 'changes', phase: 'weird', changes: [], cursor: cur(1), hasMore: false, serverTime: iso(SERVER_NOW) },
      { result: 'changes', phase: 'changes', changes: [], cursor: cur(1), hasMore: 'no', serverTime: iso(SERVER_NOW) },
      { result: 'changes', phase: 'changes', changes: [], cursor: cur(1), hasMore: false, serverTime: 'yesterday' },
      { result: 'changes', phase: 'changes', changes: 'x', cursor: cur(1), hasMore: false, serverTime: iso(SERVER_NOW) },
      { result: 'mystery', serverTime: iso(SERVER_NOW) },
      { result: 'resync_required', reason: 7, serverTime: iso(SERVER_NOW) },
      { result: 'changes', phase: 'changes', changes: [1, 2, 3], cursor: cur(1), hasMore: false, serverTime: iso(SERVER_NOW) },
    ];
    for (const body of bad) {
      const h = makePull({ options: { pageLimit: 2 } });
      h.transport.changesScript.push({ kind: 'ok', body });
      expect((await h.pull.pull()).status).toBe('retry');
      expect(h.replica.active().cursor).toBeNull();
    }
  });
});
