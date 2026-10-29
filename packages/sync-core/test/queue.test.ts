import { describe, expect, it } from 'vitest';
import { CLIENT_ID_PATTERN, QueueError, type QueueRecord } from '../src/index.ts';
import { parseEntry } from '../src/validate.ts';
import { FakeSession, InMemoryQueueStore, USER_A, USER_B, WORK_ORDER, makeCore, noteInput } from './helpers.ts';

const quickOrder = (workOrderId = WORK_ORDER) => ({
  type: 'CreateQuickWorkOrder',
  commandVersion: 1,
  objectId: workOrderId,
  payload: { workOrderId, templateId: '0194c2a0-0000-7000-8000-0000000000bb', title: 'Synthetic order' },
});

describe('queue: saving (EVM-091 AC1)', () => {
  it('EVM-091 AC1: a mutation gets object id, UUIDv7 mutation id, type, commandVersion and owner, and is saved before enqueue resolves', async () => {
    const { core, store } = makeCore();
    const record = await core.queue.enqueue(noteInput());
    expect(record.mutationId).toMatch(CLIENT_ID_PATTERN);
    expect(record.objectId).toMatch(CLIENT_ID_PATTERN);
    expect(record).toMatchObject({
      type: 'CreateNote',
      commandVersion: 1,
      ownerUserId: USER_A,
      state: 'pending',
      attempts: 0,
      orderingKey: WORK_ORDER,
    });
    expect(store.records()).toHaveLength(1);
    for (const type of ['CreateComment', 'CreateQuickWorkOrder']) {
      const r = await core.queue.enqueue({ ...noteInput(), type });
      expect(r.type).toBe(type);
    }
  });

  it('EVM-091 AC1: the owner comes from the session, never from the caller, and without a session nothing is saved', async () => {
    const { core, store, session } = makeCore();
    const forged = { ...noteInput(), ownerUserId: USER_B } as ReturnType<typeof noteInput>;
    expect((await core.queue.enqueue(forged)).ownerUserId).toBe(USER_A);
    session.userId = null;
    await expect(core.queue.enqueue(noteInput())).rejects.toMatchObject({ code: 'no_session' });
    expect(store.records()).toHaveLength(1);
  });

  it('EVM-091 AC1: the stored envelope is a copy, so changing the input afterwards does not change the queue', async () => {
    const { core, store } = makeCore();
    const input = noteInput();
    await core.queue.enqueue(input);
    input.payload['body'] = 'changed later';
    expect(store.records()[0]?.payload['body']).toBe('synthetic note');
  });

  it('EVM-091 AC1: invalid input is refused with a typed error that carries no data', async () => {
    const { core, store } = makeCore();
    const bad = [
      { ...noteInput(), type: 'DeleteEverything' },
      { ...noteInput(), commandVersion: 0 },
      { ...noteInput(), commandVersion: 1001 },
      { ...noteInput(), commandVersion: 1.5 },
      { ...noteInput(), payload: 'text' },
      { ...noteInput(), payload: [1] },
      { ...noteInput(), payload: null },
      { ...noteInput(), objectId: 'not-a-uuid' },
      { ...noteInput(), orderingKey: 'not-a-uuid' },
      { ...noteInput(), parentMutationId: 'nope' },
      { ...noteInput(), payload: { big: 10n } },
    ];
    for (const input of bad) {
      const error = await core.queue.enqueue(input as never).catch((e: unknown) => e);
      expect(error, JSON.stringify(Object.keys(input))).toBeInstanceOf(QueueError);
      expect((error as QueueError).code).toBe('invalid_input');
      expect((error as QueueError).message).toBe('invalid_input');
    }
    expect(store.records()).toHaveLength(0);
  });

  it('EVM-091 AC1, AC2: a mutation over 64 KB is refused at enqueue (SR-SYNC-06) and never reaches the queue', async () => {
    const { core, store } = makeCore();
    await expect(core.queue.enqueue(noteInput(WORK_ORDER, { body: 'x'.repeat(70_000) }))).rejects.toMatchObject({
      code: 'payload_too_large',
    });
    expect(store.records()).toHaveLength(0);
    await expect(core.queue.enqueue(noteInput(WORK_ORDER, { body: 'x'.repeat(60_000) }))).resolves.toBeDefined();
  });

  it('EVM-091 AC1: a storage failure becomes a typed error without the cause', async () => {
    const { core, store } = makeCore();
    store.failOn = { method: 'append', call: 1 };
    const error = await core.queue.enqueue(noteInput()).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'storage_failure', message: 'storage_failure' });
    expect((error as Error).cause).toBeUndefined();
  });

  it('EVM-091 AC1: a dependent mutation records its parent; a parent no longer in the queue means the dependency is satisfied', async () => {
    const { core } = makeCore();
    const parent = await core.queue.enqueue(quickOrder());
    const child = await core.queue.enqueue({ ...noteInput(), parentMutationId: parent.mutationId });
    expect(child.parentMutationId).toBe(parent.mutationId);
    const orphan = await core.queue.enqueue({ ...noteInput(), parentMutationId: '0194c2a0-0000-7000-8000-00000000ffff' });
    expect(orphan.parentMutationId).toBeUndefined();
  });

  it('EVM-091 AC1: a parent owned by another user is refused (SR-MOB-13)', async () => {
    const store = new InMemoryQueueStore();
    const a = makeCore({ store });
    const parent = await a.core.queue.enqueue(quickOrder());
    const b = makeCore({ store, session: new FakeSession(USER_B) });
    await expect(b.core.queue.enqueue({ ...noteInput(), parentMutationId: parent.mutationId })).rejects.toMatchObject({
      code: 'owner_mismatch',
    });
  });

  it('EVM-091 AC1: the queue survives a restart — a new instance on the same store sees the same entries in the same order', async () => {
    const store = new InMemoryQueueStore();
    const first = makeCore({ store });
    const a = await first.core.queue.enqueue(noteInput());
    const b = await first.core.queue.enqueue(quickOrder('0194c2a0-0000-7000-8000-000000000002'));
    const second = makeCore({ store });
    const entries = await second.core.queue.entries();
    expect(entries.map((e) => (e.valid ? e.record.mutationId : ''))).toEqual([a.mutationId, b.mutationId]);
  });
});

describe('queue: validation after reading (EVM-091 AC1; SR-MOB-10)', () => {
  const good = (): QueueRecord => ({
    mutationId: '0194c2a0-0000-7000-8000-000000000010',
    type: 'CreateNote',
    commandVersion: 1,
    payload: { a: 1 },
    objectId: WORK_ORDER,
    orderingKey: WORK_ORDER,
    createdAt: 1,
    ownerUserId: USER_A,
    state: 'pending',
    attempts: 0,
  });

  it('EVM-091 AC1: a valid entry parses with optional fields kept', () => {
    const full = { ...good(), parentMutationId: '0194c2a0-0000-7000-8000-000000000011', lastCode: 'network', nextAttemptAt: 5 };
    expect(parseEntry(full)).toEqual({ ok: true, record: full });
    expect(parseEntry(good())).toEqual({ ok: true, record: good() });
  });

  it('EVM-091 AC1: damaged entries become corrupt_record or unknown_type, keep only a valid id and never throw', () => {
    const throwing = {
      ...good(),
      payload: {
        get boom(): never {
          throw new Error('boom');
        },
      },
    };
    const cases: [unknown, string, boolean][] = [
      [null, 'corrupt_record', false],
      ['text', 'corrupt_record', false],
      [[], 'corrupt_record', false],
      [{}, 'corrupt_record', false],
      [{ ...good(), mutationId: 'bad' }, 'corrupt_record', false],
      [{ ...good(), type: 5 }, 'corrupt_record', true],
      [{ ...good(), type: 'UpdateStageStatus' }, 'unknown_type', true],
      [{ ...good(), commandVersion: 0 }, 'corrupt_record', true],
      [{ ...good(), payload: null }, 'corrupt_record', true],
      [{ ...good(), payload: [] }, 'corrupt_record', true],
      [{ ...good(), objectId: 1 }, 'corrupt_record', true],
      [{ ...good(), orderingKey: 'x' }, 'corrupt_record', true],
      [{ ...good(), parentMutationId: 'x' }, 'corrupt_record', true],
      [{ ...good(), createdAt: -1 }, 'corrupt_record', true],
      [{ ...good(), ownerUserId: '' }, 'corrupt_record', true],
      [{ ...good(), state: 'sending' }, 'corrupt_record', true],
      [{ ...good(), state: 3 }, 'corrupt_record', true],
      [{ ...good(), attempts: -1 }, 'corrupt_record', true],
      [{ ...good(), lastCode: 'Has Spaces And Name' }, 'corrupt_record', true],
      [{ ...good(), nextAttemptAt: 'soon' }, 'corrupt_record', true],
      [{ ...good(), payload: { body: 'x'.repeat(70_000) } }, 'corrupt_record', true],
      [throwing, 'corrupt_record', true],
    ];
    for (const [raw, code, hasId] of cases) {
      const parsed = parseEntry(raw);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.code).toBe(code);
        expect(parsed.mutationId !== undefined).toBe(hasId);
      }
    }
  });

  it('EVM-091 AC1: entries() reports damaged records in place and does not drop them', async () => {
    const { core, store } = makeCore();
    await core.queue.enqueue(noteInput());
    store.data.push({ garbage: true }, { ...good(), type: 'FutureType' });
    const entries = await core.queue.entries();
    expect(entries.map((e) => (e.valid ? 'ok' : e.code))).toEqual(['ok', 'corrupt_record', 'unknown_type']);
    expect(store.data).toHaveLength(3);
  });
});
