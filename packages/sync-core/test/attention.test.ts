import { describe, expect, it } from 'vitest';
import { QueueError, attentionPlan, type MutationType, type QueueRecord } from '../src/index.ts';
import { USER_B, WORK_ORDER, makeCore, noteInput } from './helpers.ts';
import { aggregate, makePull, page } from './pull-helpers.ts';

const QUICK = '0194c2a0-0000-7000-8000-0000000000c1';
const OTHER = '0194c2a0-0000-7000-8000-0000000000c2';

const attention = async (
  h: ReturnType<typeof makeCore>,
  id: string,
  lastCode: string,
  state: 'needs_attention' | 'blocked' = 'needs_attention',
): Promise<void> => {
  await h.store.update(id, { state, attempts: 1, lastCode });
};

const quick = async (h: ReturnType<typeof makeCore>): Promise<QueueRecord> =>
  h.core.queue.enqueue({
    type: 'CreateQuickWorkOrder',
    commandVersion: 1,
    payload: { workOrderId: QUICK, templateId: '0194c2a0-0000-7000-8000-0000000000bb', title: 'Synthetic order' },
  });

const dependentNote = (h: ReturnType<typeof makeCore>, parent: QueueRecord, n: number): Promise<QueueRecord> =>
  h.core.queue.enqueue({
    ...noteInput(QUICK, { id: `0194c2a0-0000-7000-8000-0000000001${String(n).padStart(2, '0')}` }),
    parentMutationId: parent.mutationId,
  });

describe('attention plan (EVM-107 AC4)', () => {
  it('EVM-107 AC4: rejection code -> reason and actions per the table of flow 16; "discard" is always last', () => {
    const plan = (type: MutationType, lastCode?: string) => attentionPlan({ type, ...(lastCode === undefined ? {} : { lastCode }) });
    for (const code of ['target_unavailable', 'forbidden']) {
      for (const type of ['CreateNote', 'CreateComment'] as const) {
        expect(plan(type, code)).toEqual({ reason: 'target_unavailable', actions: ['retarget', 'copy', 'discard'] });
      }
    }
    expect(plan('CreateNote', 'validation_failed')).toEqual({ reason: 'validation_failed', actions: ['copy', 'retarget', 'discard'] });
    expect(plan('CreateComment', 'id_conflict')).toEqual({ reason: 'id_conflict', actions: ['recreate', 'discard'] });
    expect(plan('CreateQuickWorkOrder', 'id_conflict')).toEqual({ reason: 'id_conflict', actions: ['recreate', 'discard'] });
    expect(plan('CreateQuickWorkOrder', 'template_unavailable')).toEqual({
      reason: 'template_unavailable',
      actions: ['recreate', 'discard'],
    });
    expect(plan('CreateQuickWorkOrder', 'validation_failed')).toEqual({
      reason: 'validation_failed_quick',
      actions: ['recreate', 'discard'],
    });
  });

  it('EVM-107 AC4: an unknown or missing code is "unknown" with only copy and discard - never removed automatically', () => {
    for (const type of ['CreateNote', 'CreateQuickWorkOrder'] as const) {
      expect(attentionPlan({ type, lastCode: 'something_new' })).toEqual({ reason: 'unknown', actions: ['copy', 'discard'] });
      expect(attentionPlan({ type })).toEqual({ reason: 'unknown', actions: ['copy', 'discard'] });
    }
    expect(attentionPlan({ type: 'CreateNote', lastCode: 'idempotency_mismatch' }).reason).toBe('unknown');
  });
});

describe('attention operations on the queue (EVM-107 AC4)', () => {
  it('EVM-107 AC4: discard removes only after the decision, the root with all transitive dependents, in one rewrite, and reports the count', async () => {
    const h = makeCore();
    const root = await quick(h);
    const n1 = await dependentNote(h, root, 1);
    await h.core.queue.enqueue({ ...noteInput(QUICK, { id: '0194c2a0-0000-7000-8000-000000000199' }), parentMutationId: n1.mutationId });
    const unrelated = await h.core.queue.enqueue(noteInput(WORK_ORDER));
    await attention(h, root.mutationId, 'validation_failed');
    expect((await h.core.queue.groupOf(root.mutationId)).length).toBe(3);
    expect(h.store.records()).toHaveLength(4);
    await expect(h.core.attention.discard(root.mutationId)).resolves.toEqual({ removed: 3, dependents: 2 });
    expect(h.store.records().map((r) => r.mutationId)).toEqual([unrelated.mutationId]);
  });

  it('EVM-107 AC4: operations refuse entries that do not need attention, unknown entries and entries of another user', async () => {
    const h = makeCore();
    const pending = await h.core.queue.enqueue(noteInput());
    await expect(h.core.attention.discard(pending.mutationId)).rejects.toMatchObject({ code: 'not_attention' });
    await expect(h.core.attention.recreate(pending.mutationId)).rejects.toMatchObject({ code: 'not_attention' });
    await expect(h.core.attention.discard('0194c2a0-0000-7000-8000-0000000000ff')).rejects.toMatchObject({ code: 'not_found' });
    await attention(h, pending.mutationId, 'forbidden');
    h.session.userId = USER_B;
    await expect(h.core.attention.discard(pending.mutationId)).rejects.toMatchObject({ code: 'owner_mismatch' });
    h.session.userId = null;
    await expect(h.core.attention.discard(pending.mutationId)).rejects.toMatchObject({ code: 'no_session' });
    expect(h.store.records()).toHaveLength(1);
  });

  it('EVM-107 AC4: a blocked dependent can be discarded on its own, but not recreated or retargeted', async () => {
    const h = makeCore();
    const root = await quick(h);
    const dep = await dependentNote(h, root, 2);
    await attention(h, root.mutationId, 'validation_failed');
    await attention(h, dep.mutationId, 'parent_unavailable', 'blocked');
    await expect(h.core.attention.recreate(dep.mutationId)).rejects.toMatchObject({ code: 'not_attention' });
    await expect(h.core.attention.discard(dep.mutationId)).resolves.toEqual({ removed: 1, dependents: 0 });
    expect(h.store.records().map((r) => r.mutationId)).toEqual([root.mutationId]);
  });

  it('EVM-107 AC4: recreate makes a NEW mutation id (never in place), keeps the object id for a non-conflict reason and resets the state', async () => {
    const h = makeCore();
    const note = await h.core.queue.enqueue(noteInput());
    await attention(h, note.mutationId, 'validation_failed');
    const created = await h.core.attention.recreate(note.mutationId, { payload: { ...note.payload, body: 'shortened' } });
    expect(created.mutationId).not.toBe(note.mutationId);
    expect(created).toMatchObject({ objectId: note.objectId, state: 'pending', attempts: 0, createdAt: note.createdAt });
    expect(created.payload['body']).toBe('shortened');
    expect(h.store.records()).toHaveLength(1);
    expect(h.store.records()[0]?.mutationId).toBe(created.mutationId);
  });

  it('EVM-107 AC4: id_conflict always gets a new object id (also when the caller keeps the old one)', async () => {
    const h = makeCore();
    const note = await h.core.queue.enqueue(noteInput());
    await attention(h, note.mutationId, 'id_conflict');
    const created = await h.core.attention.recreate(note.mutationId, { payload: note.payload });
    expect(created.objectId).not.toBe(note.objectId);
    expect(created.payload['id']).toBe(created.objectId);
    expect(created.orderingKey).toBe(WORK_ORDER);
    const second = await h.core.queue.enqueue(noteInput(WORK_ORDER, { id: '0194c2a0-0000-7000-8000-0000000000dd' }));
    await attention(h, second.mutationId, 'id_conflict');
    const regenerated = await h.core.attention.recreate(second.mutationId);
    expect(regenerated.objectId).not.toBe(second.objectId);
  });

  it('EVM-107 AC4: recreating a quick work order with a new id moves the dependents (target, parent, ordering key) in the same transaction', async () => {
    const h = makeCore();
    const root = await quick(h);
    const n1 = await dependentNote(h, root, 1);
    const n2 = await h.core.queue.enqueue({
      ...noteInput(QUICK, { id: '0194c2a0-0000-7000-8000-000000000198' }),
      parentMutationId: n1.mutationId,
    });
    await attention(h, root.mutationId, 'id_conflict');
    const created = await h.core.attention.recreate(root.mutationId);
    expect(created.objectId).not.toBe(QUICK);
    const records = h.store.records();
    expect(records).toHaveLength(3);
    const [r, d1, d2] = records as [QueueRecord, QueueRecord, QueueRecord];
    expect(r.mutationId).toBe(created.mutationId);
    expect(d1.parentMutationId).toBe(r.mutationId);
    expect(d2.parentMutationId).toBe(d1.mutationId);
    for (const d of [d1, d2]) {
      expect(d.orderingKey).toBe(created.objectId);
      expect(d.payload['workOrderId']).toBe(created.objectId);
      expect(d.state).toBe('pending');
    }
    expect(d1.objectId).toBe(n1.objectId);
    expect(d2.objectId).toBe(n2.objectId);
    expect(new Set(records.map((x) => x.mutationId)).size).toBe(3);
    expect([root, n1, n2].some((old) => records.some((x) => x.mutationId === old.mutationId))).toBe(false);
  });

  it('EVM-107 AC4: template_unavailable keeps the id; a corrected payload that changes the id moves dependents; a payload without keys is refused', async () => {
    const h = makeCore();
    const root = await quick(h);
    await dependentNote(h, root, 3);
    await attention(h, root.mutationId, 'template_unavailable');
    const created = await h.core.attention.recreate(root.mutationId, {
      payload: { workOrderId: OTHER, templateId: '0194c2a0-0000-7000-8000-0000000000be', title: 'Synthetic order' },
    });
    expect(created.objectId).toBe(OTHER);
    expect(h.store.records()[1]?.orderingKey).toBe(OTHER);
    await attention(h, created.mutationId, 'template_unavailable');
    await expect(h.core.attention.recreate(created.mutationId, { payload: { title: 'no ids' } })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(h.core.attention.recreate(created.mutationId, { payload: 'text' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      h.core.attention.recreate(created.mutationId, { payload: { ...created.payload, title: 'x'.repeat(70_000) } }),
    ).rejects.toMatchObject({
      code: 'payload_too_large',
    });
  });

  it('EVM-107 AC4: retarget gives a note a new work order and a new mutation id; the target must differ, exist in the replica and be a UUID', async () => {
    const h = makeCore();
    const note = await h.core.queue.enqueue(noteInput());
    await attention(h, note.mutationId, 'target_unavailable');
    const visible = (id: string): boolean => id === OTHER;
    const call = (workOrderId: string) => h.core.attention.retarget(note.mutationId, { workOrderId, isVisibleWorkOrder: visible });
    await expect(call(WORK_ORDER)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(call('0194c2a0-0000-7000-8000-0000000000c9')).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(call('not-a-uuid')).rejects.toMatchObject({ code: 'invalid_input' });
    const created = await call(OTHER);
    expect(created.mutationId).not.toBe(note.mutationId);
    expect(created).toMatchObject({ orderingKey: OTHER, objectId: note.objectId, state: 'pending', attempts: 0 });
    expect(created.payload['workOrderId']).toBe(OTHER);
    expect(h.store.records().map((r) => r.mutationId)).toEqual([created.mutationId]);
  });

  it('EVM-107 AC4: a quick work order cannot be retargeted', async () => {
    const h = makeCore();
    const root = await quick(h);
    await attention(h, root.mutationId, 'validation_failed');
    await expect(h.core.attention.retarget(root.mutationId, { workOrderId: OTHER, isVisibleWorkOrder: () => true })).rejects.toBeInstanceOf(
      QueueError,
    );
  });

  it('EVM-107 AC4: a failed rewrite changes nothing and surfaces a typed storage error without data', async () => {
    const h = makeCore();
    const note = await h.core.queue.enqueue(noteInput());
    await attention(h, note.mutationId, 'validation_failed');
    h.store.failOn = { method: 'rewrite', call: 1 };
    const error = await h.core.attention.discard(note.mutationId).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'storage_failure', message: 'storage_failure' });
    expect(h.store.records()).toHaveLength(1);
    await expect(h.core.attention.discard(note.mutationId)).resolves.toEqual({ removed: 1, dependents: 0 });
  });

  it('EVM-107 AC4: operations are serialized with the sync cycle (same lock): a discard waits for the running cycle and a new cycle waits for the operation', async () => {
    const h = makeCore();
    const note = await h.core.queue.enqueue(noteInput());
    const other = await h.core.queue.enqueue(noteInput(OTHER, { id: '0194c2a0-0000-7000-8000-0000000000e1' }));
    await attention(h, other.mutationId, 'validation_failed');
    const log: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.server.script.push(async () => {
      log.push('send-start');
      await gate;
      log.push('send-end');
      return { kind: 'ok', body: { serverTime: '2026-10-29T08:00:00Z', results: [{ mutationId: note.mutationId, outcome: 'applied' }] } };
    });
    const cycle = h.core.sync();
    await Promise.resolve();
    const op = h.core.attention.discard(other.mutationId).then(() => log.push('discard'));
    const later = h.core.sync().then(() => log.push('next-cycle-done'));
    await new Promise((r) => setTimeout(r, 5));
    expect(log).toEqual(['send-start']);
    release();
    await Promise.all([cycle, op, later]);
    expect(log.indexOf('send-end')).toBeLessThan(log.indexOf('discard'));
    expect(log.indexOf('discard')).toBeLessThan(log.indexOf('next-cycle-done'));
  });
});

describe('sync cycle order and pendingItems (EVM-107 AC2)', () => {
  it('EVM-107 AC2: before the first download finished the cycle pulls first, then sends the queue, then pulls the increments (ADR-0021)', async () => {
    const h = makePull({ pullFirstUntilLoaded: true });
    await h.core.queue.enqueue(noteInput());
    const log: string[] = [];
    const original = h.transport.getChanges.bind(h.transport);
    h.transport.getChanges = (request) => {
      log.push('pull');
      return original(request);
    };
    h.server.script.push(() => {
      log.push('push');
      return { kind: 'ok', body: { serverTime: '2026-10-29T08:00:00Z', results: [] } };
    });
    h.transport.changesScript.push(page(aggregate(1), { phase: 'snapshot', cursor: 1, hasMore: false }), page([], { cursor: 2 }));
    const result = await h.core.sync();
    expect(log).toEqual(['pull', 'push', 'pull']);
    expect(result.pull?.status).toBe('complete');
  });

  it('EVM-107 AC2: when the first download fails nothing is sent and the queue stays', async () => {
    const h = makePull({ pullFirstUntilLoaded: true });
    await h.core.queue.enqueue(noteInput());
    h.transport.changesScript.push({ kind: 'network' });
    const result = await h.core.sync();
    expect(result.pull?.status).toBe('retry');
    expect(h.server.requests).toHaveLength(0);
    expect(h.queue.records()).toHaveLength(1);
    expect(result.flush.settled).toBe(0);
  });

  it('EVM-107 AC2: a paused download (401 session_revoked) sends nothing and reports the pause', async () => {
    const h = makePull({ pullFirstUntilLoaded: true });
    await h.core.queue.enqueue(noteInput());
    h.session.refreshResult = 'session_revoked';
    h.transport.changesScript.push({ kind: 'http', status: 401, code: 'session_revoked' });
    const result = await h.core.sync();
    expect(h.server.requests).toHaveLength(0);
    expect(result.flush.paused).toBe('session_revoked');
  });

  it('EVM-107 AC2: after the first download the order is push, then pull; an explicit option overrides the automatic choice', async () => {
    const h = makePull({ pullFirstUntilLoaded: true });
    h.transport.changesScript.push(page(aggregate(1), { phase: 'snapshot', cursor: 1, hasMore: false }), page([], { cursor: 2 }));
    await h.core.sync();
    await h.core.queue.enqueue(noteInput());
    const log: string[] = [];
    const original = h.transport.getChanges.bind(h.transport);
    h.transport.getChanges = (request) => {
      log.push('pull');
      return original(request);
    };
    h.server.script.push(() => {
      log.push('push');
      return { kind: 'ok', body: { serverTime: '2026-10-29T08:00:00Z', results: [] } };
    });
    h.transport.changesScript.push(page([], { cursor: 3 }), page([], { cursor: 4 }));
    await h.core.sync();
    expect(log).toEqual(['push', 'pull']);
    log.length = 0;
    h.server.script.push(() => {
      log.push('push');
      return { kind: 'ok', body: { serverTime: '2026-10-29T08:00:00Z', results: [] } };
    });
    await h.core.sync({ pullFirst: true });
    expect(log[0]).toBe('pull');
  });

  it('EVM-107 AC2: pendingItems in the request equals the sum of all unsent states: pending, retrying, blocked and needs attention', async () => {
    const h = makeCore();
    const a = await h.core.queue.enqueue(noteInput());
    const b = await h.core.queue.enqueue(noteInput(OTHER, { id: '0194c2a0-0000-7000-8000-0000000000e2' }));
    const c = await h.core.queue.enqueue(noteInput(WORK_ORDER, { id: '0194c2a0-0000-7000-8000-0000000000e3' }));
    const root = await quick(h);
    await dependentNote(h, root, 4);
    await h.store.update(b.mutationId, { state: 'needs_attention', attempts: 1, lastCode: 'forbidden' });
    await h.store.update(c.mutationId, { state: 'retrying', attempts: 1, lastCode: 'network', nextAttemptAt: 0 });
    await h.store.update(root.mutationId, { state: 'needs_attention', attempts: 1, lastCode: 'validation_failed' });
    await h.core.sync();
    expect(a).toBeDefined();
    // pending a + retrying c + needs attention b + needs attention root + dependent (blocked by the engine) = 5
    expect(h.server.requests[0]?.pendingItems).toBe(5);
    expect(Number.isInteger(h.server.requests[0]?.pendingItems)).toBe(true);
  });

  it('EVM-107 AC2: parallel triggers share one cycle (single-flight)', async () => {
    const h = makeCore();
    await h.core.queue.enqueue(noteInput());
    const results = await Promise.all([h.core.sync(), h.core.sync(), h.core.sync(), h.core.sync(), h.core.sync()]);
    expect(h.server.requests.length).toBeLessThanOrEqual(2);
    expect(results).toHaveLength(5);
    expect(h.server.applied.size).toBe(1);
  });
});
