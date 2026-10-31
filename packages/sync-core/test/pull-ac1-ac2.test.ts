import { describe, expect, it } from 'vitest';
import { aggregate, cur, del, makePull, page, uid, upsert, wireEntity } from './pull-helpers.ts';

const firstPages = (h: ReturnType<typeof makePull>): void => {
  h.transport.changesScript.push(
    page([...aggregate(1), ...aggregate(2)], { phase: 'snapshot', cursor: 1, hasMore: true }),
    page(aggregate(3), { phase: 'snapshot', cursor: 2, hasMore: true }),
    page([upsert('timeline_entry', 1)], { phase: 'changes', cursor: 3, hasMore: false }),
  );
};

describe('first download (EVM-092 AC1)', () => {
  it('EVM-092 AC1: a fresh store is filled by snapshot pages and then the changes phase; each request continues from the stored cursor', async () => {
    const h = makePull();
    firstPages(h);
    const result = await h.pull.pull();
    expect(result.status).toBe('complete');
    expect(h.transport.changeRequests.map((r) => r.cursor)).toEqual([undefined, cur(1), cur(2)]);
    expect(h.transport.changeRequests[0]?.limit).toBe(200);
    expect([1, 2, 3].every((n) => h.replica.has('work_order', uid('work_order', n)))).toBe(true);
    expect(h.replica.has('timeline_entry', uid('timeline_entry', 1))).toBe(true);
    expect(h.replica.active().cursor).toBe(cur(3));
    expect(h.replica.active().complete).toBe(true);
    expect(h.events.filter((e) => e.kind === 'pull_page_applied').map((e) => (e as { phase: string }).phase)).toEqual([
      'snapshot',
      'snapshot',
      'changes',
    ]);
  });

  it('EVM-092 AC1: a page is applied together with its cursor in one transaction; a crash in the middle leaves neither a partial page nor a moved cursor', async () => {
    const h = makePull();
    firstPages(h);
    h.replica.failOn = { method: 'applyPage', call: 2 };
    const result = await h.pull.pull();
    expect(result.status).toBe('retry');
    expect(h.replica.active().cursor).toBe(cur(1));
    expect(h.replica.has('work_order', uid('work_order', 3))).toBe(false);
    expect(h.replica.has('customer', uid('customer', 3))).toBe(false);
    expect(h.replica.has('work_order', uid('work_order', 2))).toBe(true);
  });

  it('EVM-092 AC1: after a restart the retry reaches exactly the same state as an uninterrupted run (idempotent)', async () => {
    const clean = makePull();
    firstPages(clean);
    await clean.pull.pull();

    const crashed = makePull();
    firstPages(crashed);
    crashed.replica.failOn = { method: 'applyPage', call: 3 };
    await crashed.pull.pull();
    const restarted = makePull({ disk: crashed.replica.disk });
    restarted.transport.changesScript.push(page([upsert('timeline_entry', 1)], { phase: 'changes', cursor: 3, hasMore: false }));
    await restarted.pull.pull();
    expect(restarted.transport.changeRequests[0]?.cursor).toBe(cur(2));
    expect(restarted.replica.image()).toBe(clean.replica.image());
  });

  it('EVM-092 AC1: a network error mid-download keeps the applied pages and resumes from the cursor; a repeated page changes nothing', async () => {
    const h = makePull();
    h.transport.changesScript.push(page(aggregate(1), { phase: 'snapshot', cursor: 1, hasMore: true }), { kind: 'network' });
    const first = await h.pull.pull();
    expect(first.status).toBe('retry');
    expect(h.replica.active().cursor).toBe(cur(1));
    h.clock.advance(10 * 60_000);
    h.transport.changesScript.push(
      page(aggregate(1), { phase: 'snapshot', cursor: 2, hasMore: true }), // the server repeats the content (lost response)
      page([], { phase: 'changes', cursor: 3, hasMore: false }),
    );
    const second = await h.pull.pull();
    expect(second.status).toBe('complete');
    expect(h.replica.versionOf('work_order', uid('work_order', 1))).toBe(1);
  });

  it('EVM-092 AC1: a page that repeats the cursor while claiming more pages is a malformed page (no endless loop)', async () => {
    const h = makePull();
    h.transport.changesScript.push(
      page(aggregate(1), { phase: 'snapshot', cursor: 1, hasMore: true }),
      page([], { phase: 'snapshot', cursor: 1, hasMore: true }),
    );
    h.replica.active().cursor = cur(1);
    const result = await h.pull.pull();
    expect(result.status).toBe('retry');
  });

  it('EVM-092 AC1: the limit of pages per cycle ends the cycle as partial and the state continues in the next one', async () => {
    const h = makePull({ options: { maxPagesPerCycle: 2 } });
    firstPages(h);
    expect((await h.pull.pull()).status).toBe('partial');
    expect(h.replica.active().complete).toBe(false);
    expect((await h.pull.pull()).status).toBe('complete');
  });

  it('EVM-092 AC1: a final snapshot-phase page without more pages is not complete: the next cycle continues from its cursor', async () => {
    const h = makePull();
    h.transport.changesScript.push(page(aggregate(1), { phase: 'snapshot', cursor: 1, hasMore: false }));
    expect((await h.pull.pull()).status).toBe('partial');
    expect(h.replica.active().complete).toBe(false);
  });
});

describe('increments (EVM-092 AC2)', () => {
  async function seeded(): Promise<ReturnType<typeof makePull>> {
    const h = makePull();
    h.transport.changesScript.push(page([...aggregate(1, 5), upsert('timeline_entry', 1, 2), upsert('scope_item', 1, 1)], { cursor: 1 }));
    await h.pull.pull();
    return h;
  }
  const wo = uid('work_order', 1);

  it('EVM-092 AC2: a newer version replaces the object, an older or equal one never does', async () => {
    const h = await seeded();
    h.transport.changesScript.push(
      page([upsert('work_order', 1, 6, { title: 'newer' })], { cursor: 2 }),
      page([upsert('work_order', 1, 4, { title: 'older' }), upsert('work_order', 1, 6, { title: 'equal' })], { cursor: 3 }),
    );
    h.clock.advance(1);
    await h.pull.pull();
    await h.pull.pull();
    expect(h.replica.active().entities[`work_order:${wo}`]?.fields['title']).toBe('newer');
    expect(h.replica.versionOf('work_order', wo)).toBe(6);
  });

  it('EVM-092 AC2: a delete removes the object and its children (cascade) and leaves a tombstone', async () => {
    const h = await seeded();
    h.transport.changesScript.push(page([del('work_order', 1, 6)], { cursor: 2 }));
    await h.pull.pull();
    expect(h.replica.has('work_order', wo)).toBe(false);
    expect(h.replica.has('timeline_entry', uid('timeline_entry', 1))).toBe(false);
    expect(h.replica.has('scope_item', uid('scope_item', 1))).toBe(false);
    expect(h.replica.active().tombstones[`work_order:${wo}`]).toBe(6);
  });

  it('EVM-092 AC2: a delete older than the local version is ignored; a delete without a version applies', async () => {
    const h = await seeded();
    h.transport.changesScript.push(page([del('timeline_entry', 1, 1)], { cursor: 2 }), page([del('timeline_entry', 1)], { cursor: 3 }));
    await h.pull.pull();
    expect(h.replica.has('timeline_entry', uid('timeline_entry', 1))).toBe(true);
    await h.pull.pull();
    expect(h.replica.has('timeline_entry', uid('timeline_entry', 1))).toBe(false);
  });

  it('EVM-092 AC2: after delete v5 an older upsert v4 (page and snapshot) does not bring the object back; v6 restores it', async () => {
    const h = await seeded();
    h.transport.changesScript.push(
      page([del('work_order', 1, 5)], { cursor: 2 }),
      page([upsert('work_order', 1, 4)], { cursor: 3 }),
      page([upsert('work_order', 1, 5)], { cursor: 4 }),
    );
    await h.pull.pull();
    await h.pull.pull();
    await h.pull.pull();
    expect(h.replica.has('work_order', wo)).toBe(false);
    h.transport.changesScript.push(page(aggregate(1, 6), { cursor: 5 }));
    await h.pull.pull();
    expect(h.replica.versionOf('work_order', wo)).toBe(6);
  });

  it('EVM-092 AC2: inside one page, delete then a stale upsert then a newer upsert end in the newest state', async () => {
    const h = await seeded();
    h.transport.changesScript.push(page([del('work_order', 1, 9), upsert('work_order', 1, 7), upsert('work_order', 1, 10)], { cursor: 2 }));
    await h.pull.pull();
    expect(h.replica.versionOf('work_order', wo)).toBe(10);
  });

  it('EVM-092 AC2: a page is read with one version lookup (no N+1) and one lookup is enough for references', async () => {
    const h = makePull();
    h.transport.changesScript.push(page([...aggregate(1), ...aggregate(2), ...aggregate(3)], { cursor: 1 }));
    await h.pull.pull();
    expect(h.replica.calls['readVersions']).toBe(1);
    expect(h.replica.calls['applyPage']).toBe(1);
  });

  it('EVM-092 AC2: unknown fields of a wire entity are not stored (explicit field list)', async () => {
    const h = makePull({ options: { strictProjection: false } });
    h.transport.changesScript.push(page([upsert('customer', 1, 1, { email: 'x@example.invalid', nip: '0000000000' })], { cursor: 1 }));
    await h.pull.pull();
    const stored = JSON.stringify(h.replica.active().entities);
    expect(stored).not.toContain('example.invalid');
    expect(Object.keys(wireEntity('customer', 1, 1))).toContain('phone');
  });
});
