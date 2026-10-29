import { describe, expect, it } from 'vitest';
import { FakeServer, InMemoryQueueStore, WORK_ORDER, makeCore, noteInput } from './helpers.ts';

const wo = (n: number): string => `0194c2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('engine: batches (EVM-091 AC2)', () => {
  it('EVM-091 AC2: 120 mutations go out in batches of 50, 50 and 20, in queue order, and applied ones leave the queue', async () => {
    const { core, store, server } = makeCore();
    const ids: string[] = [];
    for (let i = 0; i < 120; i += 1) ids.push((await core.queue.enqueue(noteInput(wo(i + 1)))).mutationId);
    const result = await core.engine.flush();
    expect(server.requests.map((r) => r.mutations.length)).toEqual([50, 50, 20]);
    expect(server.allMutationIds()).toEqual(ids);
    expect(result).toMatchObject({ settled: 120, attention: 0, retryScheduled: false });
    expect(store.records()).toHaveLength(0);
    expect(store.settled).toHaveLength(120);
  });

  it('EVM-091 AC2: duplicate also closes the mutation and the consumer gets the outcome, warnings and work order number in the same settle call', async () => {
    const { core, store, server } = makeCore();
    const quick = await core.queue.enqueue({
      type: 'CreateQuickWorkOrder',
      commandVersion: 1,
      objectId: WORK_ORDER,
      payload: { workOrderId: WORK_ORDER },
    });
    const note = await core.queue.enqueue(noteInput(wo(2)));
    server.script.push({
      kind: 'ok',
      body: {
        results: [
          {
            mutationId: quick.mutationId,
            outcome: 'applied',
            workOrderNumber: 'ZL/2026/0001',
            warnings: ['captured_at_out_of_range', 'Bad Warning', 5],
          },
          { mutationId: note.mutationId, outcome: 'duplicate' },
        ],
      },
    });
    await core.engine.flush();
    expect(store.settled).toEqual([
      {
        mutationId: quick.mutationId,
        info: { outcome: 'applied', warnings: ['captured_at_out_of_range'], workOrderNumber: 'ZL/2026/0001' },
      },
      { mutationId: note.mutationId, info: { outcome: 'duplicate', warnings: [] } },
    ]);
  });

  it('EVM-091 AC2: a work order number of the wrong shape and a non-array warnings field are dropped, the mutation is still closed', async () => {
    const { core, store, server } = makeCore();
    const a = await core.queue.enqueue(noteInput(wo(1)));
    server.script.push({
      kind: 'ok',
      body: { results: [{ mutationId: a.mutationId, outcome: 'applied', workOrderNumber: 'has space', warnings: 'x' }] },
    });
    await core.engine.flush();
    expect(store.settled[0]?.info).toEqual({ outcome: 'applied', warnings: [] });
  });

  it('EVM-091 AC2: the batch also respects the byte budget (50 x 64 KB would exceed 1 MB) and keeps the order', async () => {
    const { core, server } = makeCore();
    const ids: string[] = [];
    for (let i = 0; i < 30; i += 1) ids.push((await core.queue.enqueue(noteInput(wo(i + 1), { body: 'x'.repeat(60_000) }))).mutationId);
    await core.engine.flush();
    for (const request of server.requests) {
      expect(Buffer.byteLength(JSON.stringify(request.mutations))).toBeLessThanOrEqual(900_000 + 100);
    }
    expect(server.requests.length).toBeGreaterThan(1);
    expect(server.allMutationIds()).toEqual(ids);
  });

  it('EVM-091 AC2: the request carries only the contract envelope plus pendingItems, never local metadata', async () => {
    const { core, server } = makeCore();
    await core.queue.enqueue(noteInput(wo(1)));
    await core.queue.enqueue(noteInput(wo(2)));
    server.script.push({ kind: 'network' });
    await core.engine.flush();
    const request = server.requests[0];
    expect(Object.keys(request ?? {}).sort()).toEqual(['mutations', 'pendingItems']);
    expect(request?.pendingItems).toBe(2);
    for (const m of request?.mutations ?? []) expect(Object.keys(m).sort()).toEqual(['commandVersion', 'mutationId', 'payload', 'type']);
  });

  it('EVM-091 AC1: FIFO within an object — a later mutation of the same work order does not overtake an earlier one that waits for a retry', async () => {
    const { core, server, clock } = makeCore();
    const first = await core.queue.enqueue(noteInput(WORK_ORDER));
    server.script.push({ kind: 'http', status: 503 });
    await core.engine.flush();
    const second = await core.queue.enqueue(noteInput(WORK_ORDER));
    const other = await core.queue.enqueue(noteInput(wo(9)));
    await core.engine.flush();
    expect(server.requests[1]?.mutations.map((m) => m.mutationId)).toEqual([other.mutationId]);
    clock.advance(10 * 60_000);
    await core.engine.flush();
    expect(server.requests[2]?.mutations.map((m) => m.mutationId)).toEqual([first.mutationId, second.mutationId]);
  });

  it('EVM-091 AC1: a dependent mutation waits for the result of its parent and goes in a later batch', async () => {
    const { core, server, store } = makeCore();
    const parent = await core.queue.enqueue({
      type: 'CreateQuickWorkOrder',
      commandVersion: 1,
      objectId: WORK_ORDER,
      payload: { workOrderId: WORK_ORDER },
    });
    const child = await core.queue.enqueue({ ...noteInput(WORK_ORDER), parentMutationId: parent.mutationId });
    await core.engine.flush();
    expect(server.requests.map((r) => r.mutations.map((m) => m.mutationId))).toEqual([[parent.mutationId], [child.mutationId]]);
    expect(store.records()).toHaveLength(0);
  });

  it('EVM-091 AC1: a rejection of an independent mutation does not block other mutations of the same work order', async () => {
    const { core, server, store } = makeCore();
    const bad = await core.queue.enqueue(noteInput(WORK_ORDER));
    server.rejectCodes.set(bad.mutationId, 'validation_failed');
    const later = await core.queue.enqueue(noteInput(WORK_ORDER));
    await core.engine.flush();
    expect(store.records().map((r) => [r.mutationId, r.state])).toEqual([[bad.mutationId, 'needs_attention']]);
    expect(server.applied.has(later.mutationId)).toBe(true);
  });

  it('EVM-091 AC1: an enqueue during a flush is sent too, without changing the order of the batch already sent', async () => {
    const { core, server } = makeCore();
    const first = await core.queue.enqueue(noteInput(wo(1)));
    let late: string | undefined;
    server.script.push(async (request) => {
      late = (await core.queue.enqueue(noteInput(wo(2)))).mutationId;
      return {
        kind: 'ok',
        body: { results: request.mutations.map((m) => ({ mutationId: m.mutationId, outcome: 'applied' })) },
      };
    });
    await core.engine.flush();
    expect(server.requests[0]?.mutations.map((m) => m.mutationId)).toEqual([first.mutationId]);
    expect(server.allMutationIds()).toEqual([first.mutationId, late]);
  });

  it('EVM-091 AC1: parallel triggers join one flush (single-flight); an enqueue after the last read is picked up by a re-run', async () => {
    const { core, server } = makeCore();
    await core.queue.enqueue(noteInput(wo(1)));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.script.push(async (request) => {
      await gate;
      return { kind: 'ok', body: { results: request.mutations.map((m) => ({ mutationId: m.mutationId, outcome: 'applied' })) } };
    });
    const a = core.engine.flush();
    const b = core.engine.flush();
    expect(a).toBe(b);
    const late = await core.queue.enqueue(noteInput(wo(2)));
    release();
    await a;
    expect(server.allMutationIds()).toHaveLength(2);
    expect(server.allMutationIds()[1]).toBe(late.mutationId);
    const again = await core.engine.flush();
    expect(again.settled).toBe(0);
  });
});

describe('engine: lost response does not duplicate (EVM-091 AC3)', () => {
  it('EVM-091 AC3: the server processed the batch, the response was lost; the retry sends the identical envelope and duplicate closes it', async () => {
    const { core, store, server, clock } = makeCore();
    const a = await core.queue.enqueue(noteInput(wo(1)));
    const b = await core.queue.enqueue(noteInput(wo(2)));
    server.loseNextResponse = true;
    const first = await core.engine.flush();
    expect(first.retryScheduled).toBe(true);
    expect(store.records().map((r) => [r.state, r.lastCode])).toEqual([
      ['retrying', 'network'],
      ['retrying', 'network'],
    ]);
    clock.advance(10 * 60_000);
    const second = await core.engine.flush();
    expect(second).toMatchObject({ settled: 2, retryScheduled: false });
    expect(server.requests[1]?.mutations).toEqual(server.requests[0]?.mutations);
    expect(server.requests[1]?.mutations.map((m) => m.mutationId)).toEqual([a.mutationId, b.mutationId]);
    expect(store.settled.map((s) => s.info.outcome)).toEqual(['duplicate', 'duplicate']);
    expect(store.records()).toHaveLength(0);
    expect(server.applied.size).toBe(2);
  });

  it('EVM-091 AC3: a process killed in the middle of a flush — a new instance on the same store resends with the same mutation ids', async () => {
    const store = new InMemoryQueueStore();
    const server = new FakeServer();
    const first = makeCore({ store, server });
    const a = await first.core.queue.enqueue(noteInput(wo(1)));
    const b = await first.core.queue.enqueue(noteInput(wo(2)));
    store.failOn = { method: 'settle', call: 2 };
    await expect(first.core.engine.flush()).rejects.toMatchObject({ code: 'storage_failure' });
    expect(store.records().map((r) => r.mutationId)).toEqual([b.mutationId]);
    store.failOn = undefined;
    const second = makeCore({ store, server });
    await second.core.engine.flush();
    expect(server.requests[1]?.mutations).toEqual([JSON.parse(JSON.stringify(server.requests[0]?.mutations[1])) as never]);
    expect(server.requests[1]?.mutations[0]?.mutationId).toBe(b.mutationId);
    expect(store.records()).toHaveLength(0);
    expect(server.applied.has(a.mutationId)).toBe(true);
  });

  it('EVM-091 AC3: an envelope is immutable — a mutation with an older commandVersion is resent byte for byte', async () => {
    const { core, server, clock } = makeCore();
    const old = await core.queue.enqueue({ ...noteInput(wo(1)), commandVersion: 1 });
    server.script.push({ kind: 'http', status: 500 });
    await core.engine.flush();
    clock.advance(10 * 60_000);
    await core.engine.flush();
    expect(JSON.stringify(server.requests[1]?.mutations)).toBe(JSON.stringify(server.requests[0]?.mutations));
    expect(server.requests[1]?.mutations[0]).toMatchObject({ mutationId: old.mutationId, commandVersion: 1 });
  });
});
