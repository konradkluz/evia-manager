import { describe, expect, it } from 'vitest';
import { noteInput } from './helpers.ts';
import { aggregate, makePull, page, resync, snapshotOf, uid, upsert, wireEntity, type PullHarness } from './pull-helpers.ts';

const wo = (n: number): string => uid('work_order', n);
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const QUICK = '0194c2a0-0000-7000-8000-0000000000e1';

async function seeded(h: PullHarness): Promise<void> {
  h.transport.changesScript.push(page(aggregate(1), { cursor: 1 }));
  await h.pull.pull();
}

describe('edges of the pull side (EVM-092 AC1, AC4, AC5, AC6)', () => {
  it('EVM-092 AC1: parallel pull calls join the running one', async () => {
    const h = makePull();
    h.transport.changesScript.push(page(aggregate(1), { cursor: 1 }));
    const [a, b] = await Promise.all([h.pull.pull(), h.pull.pull()]);
    expect(a).toBe(b);
    expect(h.transport.changeRequests).toHaveLength(1);
  });

  it('EVM-092 AC7: a failing configuration request ends the cycle with a retry; an unreadable fetch time makes the configuration stale', async () => {
    const h = makePull();
    h.transport.config = { kind: 'network' };
    expect((await h.pull.pull()).status).toBe('retry');
    const h2 = makePull();
    h2.replica.disk.data.config = { offlineContactWindowDays: 3, fetchedAt: 'yesterday' };
    h2.transport.changesScript.push(page([], { cursor: 1 }));
    await h2.pull.pull();
    expect(h2.transport.configCalls).toBe(1);
  });

  it('EVM-092 AC6: at most ten invalid changes of a page are reported', async () => {
    const h = makePull();
    h.transport.changesScript.push(
      page(
        Array.from({ length: 25 }, () => ({ op: 'nope' })),
        { cursor: 1 },
      ),
      page(aggregate(1), { cursor: 20 }),
    );
    await h.pull.pull();
    expect(h.events.filter((e) => e.kind === 'change_invalid')).toHaveLength(10);
  });

  it('EVM-092 AC1: a generation that disappeared under a running cycle (store answers "stale") ends the cycle as stale', async () => {
    const h = makePull();
    h.transport.changesScript.push(page(aggregate(1), { cursor: 1 }));
    h.replica.applyPage = () => Promise.resolve('stale');
    expect((await h.pull.pull()).status).toBe('stale');
    const h2 = makePull();
    await seeded(h2);
    h2.transport.changesScript.push(resync('periodic'), page(aggregate(2), { cursor: 5 }));
    h2.replica.promoteShadow = () => Promise.resolve('stale');
    expect((await h2.pull.pull()).status).toBe('stale');
  });

  it('EVM-092 AC5: a reference reported twice is listed once', async () => {
    const h = makePull();
    h.transport.changesScript.push(
      page([upsert('timeline_entry', 3, 1)], { cursor: 1 }),
      page([upsert('timeline_entry', 3, 2)], { cursor: 2 }),
    );
    h.transport.snapshotScript.set(wo(3), [{ kind: 'http', status: 503 }]);
    await h.pull.pull();
    h.clock.advance(60 * 60_000);
    await h.pull.pull();
    expect(h.replica.active().hydration).toHaveLength(1);
  });

  it('EVM-092 AC5: 404 of the snapshot of an object that is pending is not removed, and the list entry goes', async () => {
    const h = makePull();
    h.transport.changesScript.push(
      page([upsert('work_order', 1, 1, { id: QUICK, customerId: null, siteId: null })], { cursor: 1 }),
      page([], { cursor: 2 }),
    );
    await h.pull.pull();
    await h.core.queue.enqueue({
      type: 'CreateQuickWorkOrder',
      commandVersion: 1,
      orderingKey: QUICK,
      payload: { workOrderId: QUICK, templateId: uid('customer', 5), title: 'Quick' },
    });
    h.replica.active().hydration.push({ workOrderId: QUICK, reason: 'unknown_anchor' });
    await h.pull.pull();
    expect(h.replica.has('work_order', QUICK)).toBe(true);
    expect(h.replica.active().hydration).toEqual([]);
  });

  it('EVM-092 AC5: a store that answers "stale" to a snapshot write ends the cycle (404 and normal snapshot)', async () => {
    for (const notFound of [true, false]) {
      const h = makePull();
      h.transport.changesScript.push(page([upsert('timeline_entry', 3, 1)], { cursor: 1 }));
      if (!notFound)
        h.transport.snapshotScript.set(wo(3), [snapshotOf([wireEntity('work_order', 3, 1, { customerId: null, siteId: null })])]);
      h.replica.applySnapshot = () => Promise.resolve('stale');
      expect((await h.pull.pull()).status).toBe('stale');
    }
  });

  it('EVM-092 AC5: bad snapshot body is a transient error; unknown entities are skipped and counted; an empty snapshot is invalid and plans a resync', async () => {
    const h = makePull();
    h.transport.changesScript.push(page([upsert('timeline_entry', 3, 1)], { cursor: 1 }));
    h.transport.snapshotScript.set(wo(3), [{ kind: 'ok', body: { nothing: true } }]);
    expect((await h.pull.pull()).status).toBe('retry');

    const h2 = makePull();
    h2.transport.changesScript.push(page([upsert('timeline_entry', 3, 1)], { cursor: 1 }));
    h2.transport.snapshotScript.set(wo(3), [
      snapshotOf([wireEntity('work_order', 3, 1, { customerId: null, siteId: null }), { type: 'hologram', id: 'x', version: 1 }]),
    ]);
    expect((await h2.pull.pull()).status).toBe('complete');
    expect(h2.events).toContainEqual({ kind: 'change_unknown_skipped', count: 1 });

    const h3 = makePull();
    h3.transport.changesScript.push(page([upsert('timeline_entry', 3, 1)], { cursor: 1 }), page(aggregate(3), { cursor: 9 }));
    h3.transport.snapshotScript.set(wo(3), [snapshotOf([])]);
    await h3.pull.pull();
    expect(h3.events).toContainEqual({ kind: 'resync_scheduled', reason: 'invalid_change' });
  });

  it('EVM-092 AC6: an invalid snapshot met inside a running resync is a backoff, not another resync', async () => {
    const h = makePull();
    await seeded(h);
    h.transport.changesScript.push(
      resync('periodic'),
      page([upsert('timeline_entry', 5, 1)], { phase: 'changes', cursor: 8, hasMore: false }),
    );
    h.transport.snapshotScript.set(wo(5), [snapshotOf([wireEntity('work_order', 5, 1), wireEntity('timeline_entry', 6, 1)])]);
    const result = await h.pull.pull();
    expect(result.status).toBe('retry');
    expect(h.events).toContainEqual(expect.objectContaining({ kind: 'pull_retry_scheduled', code: 'invalid_change_in_resync' }));
    expect(h.replica.has('work_order', wo(1))).toBe(true);
  });

  it('EVM-092 AC4: a pause found just before the sweep leaves the cycle without sweeping', async () => {
    const h = makePull();
    await h.core.queue.enqueue(noteInput(wo(1)));
    const original = h.queue.readAll.bind(h.queue);
    let reads = 0;
    let busy = false;
    h.queue.readAll = async () => {
      if (!busy) reads += 1;
      if (reads === 2 && !busy) {
        busy = true;
        h.server.script.push({ kind: 'http', status: 426 });
        await h.core.engine.flush();
      }
      return original();
    };
    h.transport.changesScript.push(page([upsert('customer', 1)], { cursor: 1 }));
    const result = await h.pull.pull();
    expect(result.paused).toBe('upgrade_required');
    expect(h.replica.has('customer', uid('customer', 1))).toBe(true);
    expect(h.events.some((e) => e.kind === 'sweep_done')).toBe(false);
  });

  it('EVM-092 AC5: a pause found before the write of a snapshot or the removal of an aggregate stops the cycle before the write', async () => {
    const h = makePull();
    await h.core.queue.enqueue(noteInput(wo(9)));
    h.transport.changesScript.push(page([upsert('timeline_entry', 3, 1)], { cursor: 1 }));
    const original = h.queue.readAll.bind(h.queue);
    let reads = 0;
    let busy = false;
    h.queue.readAll = async () => {
      if (!busy) reads += 1;
      if (reads === 2 && !busy) {
        busy = true;
        h.server.script.push({ kind: 'http', status: 426 });
        await h.core.engine.flush();
      }
      return original();
    };
    const result = await h.pull.pull();
    expect(result.paused).toBe('upgrade_required');
    expect(h.replica.calls['applySnapshot']).toBeUndefined();

    const h2 = makePull();
    h2.transport.changesScript.push(page([upsert('timeline_entry', 3, 1)], { cursor: 1 }));
    h2.transport.snapshotScript.set(wo(3), [snapshotOf([wireEntity('work_order', 3, 1, { customerId: null, siteId: null })])]);
    await h2.core.queue.enqueue(noteInput(wo(9)));
    const originalVersions = h2.replica.readVersions.bind(h2.replica);
    let calls = 0;
    h2.replica.readVersions = async (generation, keys) => {
      calls += 1;
      const out = await originalVersions(generation, keys);
      if (calls === 2) {
        h2.server.script.push({ kind: 'http', status: 426 });
        await h2.core.engine.flush();
      }
      return out;
    };
    expect((await h2.pull.pull()).paused).toBe('upgrade_required');
    expect(h2.replica.calls['applySnapshot']).toBeUndefined();
  });

  it('EVM-092 AC4: after a pause and a resume while a request was in flight, the late response is dropped as stale', async () => {
    const h = makePull();
    await h.core.queue.enqueue(noteInput(wo(1)));
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.transport.changesScript.push(async () => {
      await held;
      return page(aggregate(9), { cursor: 5 });
    });
    const pulling = h.pull.pull();
    await tick();
    h.server.script.push({ kind: 'http', status: 426 });
    await h.core.engine.flush();
    expect(await h.core.engine.resume()).toBe(true);
    release();
    expect((await pulling).status).toBe('stale');
    expect(h.replica.calls['applyPage']).toBeUndefined();
  });

  it('EVM-092 AC4: a store that does not keep its contract (never starts the shadow) cannot make an endless loop', async () => {
    const h = makePull();
    await seeded(h);
    h.replica.beginShadow = () => Promise.resolve(99);
    for (let i = 0; i < 12; i += 1) h.transport.changesScript.push(page([{ op: 'nope' }], { cursor: 10 + i }));
    expect((await h.pull.pull()).status).toBe('partial');
    expect(h.replica.calls['loadState']).toBeLessThanOrEqual(20);
  });

  it('EVM-092 AC1: the page limit is clamped to 1-500 and the cursor is not sent when there is none', async () => {
    for (const [asked, sent] of [
      [0, 1],
      [9999, 500],
      [50, 50],
    ] as const) {
      const h = makePull({ options: { pageLimit: asked } });
      h.transport.changesScript.push(page([], { cursor: 1 }));
      await h.pull.pull();
      expect(h.transport.changeRequests[0]).toEqual({ limit: sent });
    }
  });
});
