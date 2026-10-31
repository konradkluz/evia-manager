import { describe, expect, it } from 'vitest';
import type { TransportResponse } from '../src/index.ts';
import { WORK_ORDER, makeCore, noteInput } from './helpers.ts';

const wo = (n: number): string => `0194c2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const quick = { type: 'CreateQuickWorkOrder', commandVersion: 1, objectId: WORK_ORDER, payload: { workOrderId: WORK_ORDER } };

describe('engine: transient errors (EVM-091 AC4)', () => {
  const transient: [string, TransportResponse, string][] = [
    ['no network', { kind: 'network' }, 'network'],
    ['5xx', { kind: 'http', status: 503 }, 'server_error'],
    ['429', { kind: 'http', status: 429, retryAfter: '120' }, 'rate_limited'],
    ['408', { kind: 'http', status: 408 }, 'timeout'],
    ['200 with a broken body', { kind: 'ok', body: 'nonsense' }, 'invalid_response'],
    ['200 with a null body', { kind: 'ok', body: null }, 'invalid_response'],
  ];

  for (const [name, response, code] of transient) {
    it(`EVM-091 AC4: ${name} keeps the mutation, marks it retrying with the code and a next attempt time for the indicator`, async () => {
      const { core, store, server, clock, events } = makeCore();
      const a = await core.queue.enqueue(noteInput(wo(1)));
      const b = await core.queue.enqueue(noteInput(wo(2)));
      server.script.push(response);
      const result = await core.engine.flush();
      expect(result.retryScheduled).toBe(true);
      expect(store.records().map((r) => r.mutationId)).toEqual([a.mutationId, b.mutationId]);
      for (const r of store.records()) {
        expect(r).toMatchObject({ state: 'retrying', attempts: 1, lastCode: code });
        expect(r.nextAttemptAt).toBeGreaterThan(clock.now() - 1);
      }
      const status = await core.engine.status();
      expect(status).toMatchObject({ retrying: 2, pending: 0, needsAttention: 0 });
      expect(status.nextAttemptAt).toBe(store.records()[0]?.nextAttemptAt);
      expect(events.some((e) => e.kind === 'retry_scheduled' && e.code === code)).toBe(true);
    });
  }

  it('EVM-091 AC4: a throwing transport counts as a network failure and the thrown message never leaves the engine', async () => {
    const { core, store, server, events } = makeCore();
    await core.queue.enqueue(noteInput());
    server.script.push(() => {
      throw new Error('TypeError: Network request failed for jan.kowalski@example.invalid');
    });
    await core.engine.flush();
    expect(store.records()[0]?.lastCode).toBe('network');
    expect(JSON.stringify(events)).not.toContain('kowalski');
  });

  it('EVM-091 AC4: no attempt is made before nextAttemptAt, and after it the same mutations go out again in the same order', async () => {
    const { core, server, clock } = makeCore();
    const a = await core.queue.enqueue(noteInput(wo(1)));
    const b = await core.queue.enqueue(noteInput(wo(2)));
    server.script.push({ kind: 'network' });
    await core.engine.flush();
    await core.engine.flush();
    expect(server.requests).toHaveLength(1);
    const wait = (await core.engine.status()).nextAttemptAt ?? 0;
    clock.ms = wait;
    await core.engine.flush();
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1]?.mutations.map((m) => m.mutationId)).toEqual([a.mutationId, b.mutationId]);
  });

  it('EVM-091 AC4: the delay grows with the attempts up to a cap and uses jitter from the random port', async () => {
    const { core, server, clock, events } = makeCore({ options: { baseDelayMs: 1000, maxDelayMs: 60_000 } });
    await core.queue.enqueue(noteInput());
    for (let i = 0; i < 12; i += 1) {
      server.script.push({ kind: 'network' });
      await core.engine.flush();
      clock.ms = (await core.engine.status()).nextAttemptAt ?? clock.ms;
    }
    const delays = events.flatMap((e) => (e.kind === 'retry_scheduled' ? [e.delayMs] : []));
    expect(delays).toHaveLength(12);
    expect(Math.max(...delays)).toBeLessThanOrEqual(60_000);
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(1000);
    expect(delays.slice(-4).some((d, _index, all) => d !== all[0])).toBe(true);
    expect((await core.engine.status()).retrying).toBe(1);
    expect(events.filter((e) => e.kind === 'retry_scheduled').map((e) => (e as { attempts: number }).attempts)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it('EVM-091 AC4: Retry-After (seconds or HTTP-date) is a lower bound for the next attempt and is clamped to the maximum', async () => {
    const { core, server, store, clock } = makeCore({ options: { maxRetryAfterMs: 600_000 } });
    await core.queue.enqueue(noteInput(wo(1)));
    server.script.push({ kind: 'http', status: 429, retryAfter: '300' });
    await core.engine.flush();
    expect((store.records()[0]?.nextAttemptAt ?? 0) - clock.now()).toBeGreaterThanOrEqual(300_000);
    clock.ms = store.records()[0]?.nextAttemptAt ?? 0;
    server.script.push({ kind: 'http', status: 503, retryAfter: 'Thu, 29 Oct 2026 08:20:00 GMT' });
    await core.engine.flush();
    expect((store.records()[0]?.nextAttemptAt ?? 0) - clock.now()).toBe(600_000);
    clock.ms = store.records()[0]?.nextAttemptAt ?? 0;
    server.script.push({ kind: 'http', status: 503, retryAfter: '-4' });
    await core.engine.flush();
    expect((store.records()[0]?.nextAttemptAt ?? 0) - clock.now()).toBeLessThan(600_000);
  });

  it('EVM-091 AC4: network restored retries mutations that wait on a network error now, but never ones waiting on Retry-After', async () => {
    const { core, server, store } = makeCore();
    const a = await core.queue.enqueue(noteInput(wo(1)));
    server.script.push({ kind: 'network' });
    await core.engine.flush();
    expect((await core.engine.flush()).settled).toBe(0);
    expect((await core.engine.flush({ networkRestored: true })).settled).toBe(1);
    expect(server.applied.has(a.mutationId)).toBe(true);
    const b = await core.queue.enqueue(noteInput(wo(2)));
    server.script.push({ kind: 'http', status: 429, retryAfter: '60' });
    await core.engine.flush();
    expect((await core.engine.flush({ networkRestored: true })).settled).toBe(0);
    expect(store.records().map((r) => r.mutationId)).toEqual([b.mutationId]);
  });

  it('EVM-091 AC4: results missing for part of the batch leave those mutations retrying, the rest is closed; results for unsent ids are ignored', async () => {
    const { core, server, store, events } = makeCore();
    const a = await core.queue.enqueue(noteInput(wo(1)));
    const b = await core.queue.enqueue(noteInput(wo(2)));
    server.script.push({
      kind: 'ok',
      body: {
        results: [
          { mutationId: b.mutationId, outcome: 'applied' },
          { mutationId: '0194c2a0-0000-7000-8000-00000000dead', outcome: 'applied' },
          { mutationId: b.mutationId, outcome: 'rejected', code: 'forbidden' },
          'junk',
        ],
      },
    });
    await core.engine.flush();
    expect(store.records().map((r) => [r.mutationId, r.state, r.lastCode])).toEqual([[a.mutationId, 'retrying', 'missing_result']]);
    expect(store.settled.map((s) => s.mutationId)).toEqual([b.mutationId]);
    expect(events.filter((e) => e.kind === 'ignored_result')).toHaveLength(3);
  });

  it('EVM-091 AC4: rejected idempotency_in_progress is transient — the mutation stays in the queue with a backoff, not on the attention list', async () => {
    const { core, server, store } = makeCore();
    const a = await core.queue.enqueue(noteInput(wo(1)));
    server.rejectCodes.set(a.mutationId, 'idempotency_in_progress');
    const result = await core.engine.flush();
    expect(result).toMatchObject({ attention: 0, retryScheduled: true });
    expect(store.records()[0]).toMatchObject({ state: 'retrying', lastCode: 'idempotency_in_progress' });
  });

  it('EVM-091 AC4: an in-progress result and a missing result in one response are both scheduled for a retry and the engine stops', async () => {
    const { core, server, store } = makeCore();
    const a = await core.queue.enqueue(noteInput(wo(1)));
    const b = await core.queue.enqueue(noteInput(wo(2)));
    server.script.push({
      kind: 'ok',
      body: { results: [{ mutationId: a.mutationId, outcome: 'rejected', code: 'idempotency_in_progress' }] },
    });
    await core.engine.flush();
    expect(store.records().map((r) => [r.mutationId, r.lastCode])).toEqual([
      [a.mutationId, 'idempotency_in_progress'],
      [b.mutationId, 'missing_result'],
    ]);
  });
});

describe('engine: attention list (EVM-091 AC5)', () => {
  it('EVM-091 AC5: rejected and conflict keep the mutation and its data with a code; known codes pass, unknown codes and outcomes become unknown', async () => {
    const { core, server, store } = makeCore();
    const ids: string[] = [];
    for (let i = 1; i <= 7; i += 1) ids.push((await core.queue.enqueue(noteInput(wo(i)))).mutationId);
    const body = (id: string | undefined, outcome: string, code?: string): object => ({
      mutationId: id,
      outcome,
      ...(code === undefined ? {} : { code }),
    });
    server.script.push({
      kind: 'ok',
      body: {
        results: [
          body(ids[0], 'rejected', 'validation_failed'),
          body(ids[1], 'conflict', 'id_conflict'),
          body(ids[2], 'conflict'),
          body(ids[3], 'rejected', 'brand_new_code'),
          body(ids[4], 'rejected'),
          body(ids[5], 'maybe_applied'),
          body(ids[6], 'rejected', 'idempotency_mismatch'),
        ],
      },
    });
    const result = await core.engine.flush();
    expect(result.attention).toBe(7);
    expect(store.records().map((r) => [r.state, r.lastCode])).toEqual([
      ['needs_attention', 'validation_failed'],
      ['needs_attention', 'id_conflict'],
      ['needs_attention', 'id_conflict'],
      ['needs_attention', 'unknown'],
      ['needs_attention', 'unknown'],
      ['needs_attention', 'unknown'],
      ['needs_attention', 'idempotency_mismatch'],
    ]);
    expect(store.records()[0]?.payload['body']).toBe('synthetic note');
    expect(await core.engine.status()).toMatchObject({ needsAttention: 7, pending: 0 });
    expect((await core.engine.flush()).settled).toBe(0);
    expect(server.requests).toHaveLength(1);
  });

  it('EVM-091 AC5: forbidden and target_unavailable keep the data and hold the dependents, which are marked blocked (also transitively)', async () => {
    for (const code of ['forbidden', 'target_unavailable']) {
      const { core, server, store, events } = makeCore();
      const parent = await core.queue.enqueue(quick);
      const child = await core.queue.enqueue({ ...noteInput(WORK_ORDER), parentMutationId: parent.mutationId });
      const grandchild = await core.queue.enqueue({ ...noteInput(WORK_ORDER), parentMutationId: child.mutationId });
      const independent = await core.queue.enqueue(noteInput(wo(5)));
      server.rejectCodes.set(parent.mutationId, code);
      await core.engine.flush();
      expect(store.records().map((r) => [r.mutationId, r.state, r.lastCode])).toEqual([
        [parent.mutationId, 'needs_attention', code],
        [child.mutationId, 'blocked', 'parent_unavailable'],
        [grandchild.mutationId, 'blocked', 'parent_unavailable'],
      ]);
      expect(server.applied.has(independent.mutationId)).toBe(true);
      expect(server.applied.has(child.mutationId)).toBe(false);
      expect(await core.engine.status()).toMatchObject({ needsAttention: 1, blocked: 2 });
      expect(events.filter((e) => e.kind === 'blocked')).toHaveLength(2);
    }
  });

  it('EVM-091 AC5: a blocked mutation is released when its parent leaves the attention state', async () => {
    const { core, server, store } = makeCore();
    const parent = await core.queue.enqueue(quick);
    const child = await core.queue.enqueue({ ...noteInput(WORK_ORDER), parentMutationId: parent.mutationId });
    server.rejectCodes.set(parent.mutationId, 'target_unavailable');
    await core.engine.flush();
    expect(store.records()[1]?.state).toBe('blocked');
    await store.update(parent.mutationId, { state: 'pending', attempts: 0 });
    server.rejectCodes.clear();
    await core.engine.flush();
    expect(server.applied.has(child.mutationId)).toBe(true);
    expect(store.records()).toHaveLength(0);
  });

  it('EVM-091 AC5: 400 and 413 for a batch are split into single sends so one bad mutation does not block the queue', async () => {
    for (const [status, code] of [
      [400, 'envelope_rejected'],
      [413, 'payload_too_large'],
    ] as const) {
      const { core, server, store } = makeCore();
      const ids: string[] = [];
      for (let i = 1; i <= 3; i += 1) ids.push((await core.queue.enqueue(noteInput(wo(i)))).mutationId);
      server.script.push(
        { kind: 'http', status },
        (request) => ({
          kind: 'ok',
          body: { results: request.mutations.map((m) => ({ mutationId: m.mutationId, outcome: 'applied' })) },
        }),
        { kind: 'http', status },
        (request) => ({
          kind: 'ok',
          body: { results: request.mutations.map((m) => ({ mutationId: m.mutationId, outcome: 'applied' })) },
        }),
      );
      await core.engine.flush();
      expect(server.requests.map((r) => r.mutations.length)).toEqual([3, 1, 1, 1]);
      expect(store.records().map((r) => [r.mutationId, r.state, r.lastCode])).toEqual([[ids[1], 'needs_attention', code]]);
      expect(store.settled.map((s) => s.mutationId)).toEqual([ids[0], ids[2]]);
    }
  });

  it('EVM-091 AC5: a single mutation rejected with 400 goes to the attention list; a transient failure while splitting stops the flush', async () => {
    const { core, server, store } = makeCore();
    const a = await core.queue.enqueue(noteInput(wo(1)));
    server.script.push({ kind: 'http', status: 400 });
    await core.engine.flush();
    expect(store.records()[0]).toMatchObject({ mutationId: a.mutationId, state: 'needs_attention', lastCode: 'envelope_rejected' });
    const b = await core.queue.enqueue(noteInput(wo(2)));
    const c = await core.queue.enqueue(noteInput(wo(3)));
    server.script.push({ kind: 'http', status: 400 }, { kind: 'http', status: 502 });
    const result = await core.engine.flush();
    expect(result.retryScheduled).toBe(true);
    expect(store.records().map((r) => [r.mutationId, r.state])).toEqual([
      [a.mutationId, 'needs_attention'],
      [b.mutationId, 'retrying'],
      [c.mutationId, 'pending'],
    ]);
  });

  it('EVM-091 AC5: a damaged entry goes to the attention list as corrupt_record, is not sent, not removed and does not block the others', async () => {
    const { core, server, store, events } = makeCore();
    store.data.push({ mutationId: 'x', secret: 'synthetic' });
    const ok = await core.queue.enqueue(noteInput());
    await core.engine.flush();
    await core.engine.flush();
    expect(server.allMutationIds()).toEqual([ok.mutationId]);
    expect(store.data).toHaveLength(1);
    expect(await core.engine.status()).toMatchObject({ corrupt: 1, needsAttention: 1 });
    expect(events.filter((e) => e.kind === 'corrupt_record')).toEqual([{ kind: 'corrupt_record', index: 0 }]);
  });

  it('EVM-091 AC5: a store failure while updating a state surfaces as a typed error without the cause', async () => {
    const { core, store, server } = makeCore();
    await core.queue.enqueue(noteInput());
    server.script.push({ kind: 'network' });
    store.failOn = { method: 'update', call: 1 };
    const error = await core.engine.flush().catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'storage_failure', message: 'storage_failure' });
    expect((error as Error).cause).toBeUndefined();
  });
});
