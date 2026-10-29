import { zSyncMutationResult, zSyncMutationsRequest, zSyncMutationsResponse } from '@evia/contracts/zod';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EngineEvent, QueueRecord, SyncRequest } from '../src/index.ts';
import { KEY_FIELDS } from '../src/validate.ts';
import { FakeServer, InMemoryQueueStore, USER_A, makeCore } from './helpers.ts';

const wo = (n: number): string => `0194c2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const uuid = (n: number): string => `0194c2a0-0000-7000-8000-${String(n + 4096).padStart(12, '0')}`;

/** Synthetic personal data and strings that imitate secrets (the test set of AC7). */
const PII = {
  name: 'Janina Syntetyczna',
  phone: '+48 600 100 200',
  street: 'ul. Nieistniejaca 13/7',
  note: 'Klient prosi o telefon przed wizyta',
  token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJl',
  installSecret: 'inst_sk_synthetic_0123456789abcdef',
};
const PII_VALUES = Object.values(PII);

function piiPayload(i: number): Record<string, unknown> {
  return {
    id: uuid(i + 300),
    workOrderId: wo(i),
    templateId: uuid(i),
    title: `Zlecenie ${PII.name}`,
    newCustomer: { id: uuid(i + 100), kind: 'person', displayName: PII.name, phone: PII.phone },
    newSite: { id: uuid(i + 200), siteType: 'other', street: PII.street, buildingNumber: '1', postalCode: '00-001', city: 'Testowo' },
    note: `${PII.note} ${PII.token} ${PII.installSecret}`,
  };
}

describe('diagnostics without personal data (EVM-091 AC7; SR-LOG-08, SR-PRIV-09)', () => {
  it('EVM-091 AC7: events from every path (success, retry, rejection, block, pause, corrupt, foreign) contain only ids, enums and numbers', async () => {
    const store = new InMemoryQueueStore();
    const { core, server, events, clock } = makeCore({ store });
    const parent = await core.queue.enqueue({ type: 'CreateQuickWorkOrder', commandVersion: 1, objectId: wo(1), payload: piiPayload(1) });
    await core.queue.enqueue({
      type: 'CreateNote',
      commandVersion: 1,
      orderingKey: wo(1),
      parentMutationId: parent.mutationId,
      payload: { ...piiPayload(2), workOrderId: wo(1) },
    });
    for (let i = 3; i <= 8; i += 1)
      await core.queue.enqueue({ type: 'CreateComment', commandVersion: 1, orderingKey: wo(i), payload: piiPayload(i) });
    store.data.push({ mutationId: 'broken', payload: PII });
    store.data.push({ ...(store.data[0] as object), mutationId: '0194c2a0-0000-7000-8000-00000000f001', ownerUserId: 'someone-else' });
    server.script.push({ kind: 'http', status: 503, code: PII.token });
    await core.engine.flush();
    clock.advance(10 * 60_000);
    const ids = store.records().map((r) => r.mutationId);
    server.rejectCodes.set(parent.mutationId, 'target_unavailable');
    server.script.push({
      kind: 'ok',
      body: {
        results: [
          { mutationId: ids[2], outcome: 'rejected', code: PII.name },
          { mutationId: ids[3], outcome: 'applied', warnings: [PII.note], workOrderNumber: PII.phone },
        ],
      },
    });
    await core.engine.flush();
    clock.advance(10 * 60_000);
    await core.engine.flush();
    await core.queue.enqueue({ type: 'CreateComment', commandVersion: 1, orderingKey: wo(9), payload: piiPayload(9) });
    server.script.push({ kind: 'http', status: 401, code: 'session_revoked' });
    clock.advance(60 * 60_000);
    await core.engine.flush();
    const text = JSON.stringify(events);
    for (const value of PII_VALUES) expect(text, value).not.toContain(value);
    expect(text).not.toContain('Syntetyczna');
    expect(text).not.toContain('someone-else');
    const kinds = new Set(events.map((e) => e.kind));
    for (const kind of [
      'batch_sent',
      'retry_scheduled',
      'needs_attention',
      'blocked',
      'paused',
      'signal',
      'corrupt_record',
      'mutation_settled',
    ]) {
      expect(kinds.has(kind as EngineEvent['kind']), kind).toBe(true);
    }
    for (const event of events) {
      for (const [key, value] of Object.entries(event)) {
        expect(['string', 'number'], `${event.kind}.${key}`).toContain(typeof value);
        if (typeof value === 'string' && key !== 'kind') expect(value, `${event.kind}.${key}`).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      }
    }
  });

  it('EVM-091 AC7: errors (typed codes, causes, thrown transport errors) serialize without payload or envelope data', async () => {
    const { core, store, server } = makeCore();
    const errors: unknown[] = [];
    store.failOn = { method: 'append', call: 1 };
    errors.push(
      await core.queue
        .enqueue({ type: 'CreateNote', commandVersion: 1, orderingKey: wo(1), payload: piiPayload(1) })
        .catch((e: unknown) => e),
    );
    errors.push(
      await core.queue
        .enqueue({ type: 'CreateNote', commandVersion: 1, payload: { id: uuid(1), workOrderId: wo(1), body: PII.note.repeat(5000) } })
        .catch((e: unknown) => e),
    );
    errors.push(await core.queue.enqueue({ type: PII.name, commandVersion: 1, payload: piiPayload(1) }).catch((e: unknown) => e));
    await core.queue.enqueue({ type: 'CreateNote', commandVersion: 1, orderingKey: wo(1), payload: piiPayload(1) });
    store.failOn = { method: 'update', call: 1 };
    server.script.push(() => {
      throw new Error(`failed for ${PII.name} ${PII.token}`);
    });
    errors.push(await core.engine.flush().catch((e: unknown) => e));
    expect(errors).toHaveLength(4);
    for (const error of errors) {
      const text = `${String(error)} ${JSON.stringify(error, Object.getOwnPropertyNames(error))} ${(error as Error).stack ?? ''}`;
      for (const value of PII_VALUES) expect(text, value).not.toContain(value);
      expect((error as Error).cause).toBeUndefined();
      expect((error as { code: string }).code).toMatch(/^[a-z_]+$/);
    }
  });

  it('EVM-091 AC7: a server code outside the pattern, with free text, never reaches the events', async () => {
    const { core, server, events } = makeCore();
    const a = await core.queue.enqueue({ type: 'CreateNote', commandVersion: 1, orderingKey: wo(1), payload: piiPayload(1) });
    server.script.push({
      kind: 'ok',
      body: { results: [{ mutationId: a.mutationId, outcome: 'rejected', code: `detail: ${PII.name}`, message: PII.note }] },
    });
    await core.engine.flush();
    expect(JSON.stringify(events)).not.toContain(PII.name);
    expect(events.find((e) => e.kind === 'needs_attention')).toMatchObject({ code: 'unknown' });
  });
});

describe('compatibility with the sync contract (EVM-091; EVM-090)', () => {
  it('EVM-091 AC2: batches built by the core pass the contract request schema (strict envelope, pendingItems), also at the limits', async () => {
    const { core, server } = makeCore();
    for (let i = 1; i <= 60; i += 1) {
      await core.queue.enqueue({
        type: 'CreateQuickWorkOrder',
        commandVersion: 1,
        objectId: wo(i),
        payload: { workOrderId: wo(i), templateId: uuid(i), title: 'Synthetic' },
      });
    }
    for (let i = 1; i <= 5; i += 1) {
      await core.queue.enqueue({
        type: 'CreateNote',
        commandVersion: 1000,
        orderingKey: wo(i),
        payload: { id: uuid(i + 300), workOrderId: wo(i), noteCategory: 'other', body: 'synthetic', capturedAt: '2026-10-29T08:00:00Z' },
      });
      await core.queue.enqueue({
        type: 'CreateComment',
        commandVersion: 1,
        orderingKey: wo(i),
        payload: { id: uuid(i + 400), workOrderId: wo(i), body: 'synthetic', capturedAt: '2026-10-29T08:00:00Z' },
      });
    }
    const captured: SyncRequest[] = [];
    server.script.push(
      ...Array.from({ length: 3 }, () => (request: SyncRequest) => {
        captured.push(request);
        return { kind: 'ok' as const, body: { results: request.mutations.map((m) => ({ mutationId: m.mutationId, outcome: 'applied' })) } };
      }),
    );
    await core.engine.flush();
    expect(captured.length).toBeGreaterThanOrEqual(2);
    for (const request of captured) {
      const parsed = zSyncMutationsRequest.safeParse(request);
      expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 2))).toBe(true);
      expect(parsed.data).toEqual(request);
      expect(request.mutations.length).toBeLessThanOrEqual(50);
    }
  });

  it('EVM-091 AC2, AC5: every outcome and code the contract allows maps without loss: applied/duplicate close, conflict/rejected keep the code', async () => {
    const codes = ['id_conflict', 'forbidden', 'target_unavailable', 'validation_failed', 'idempotency_mismatch', 'template_unavailable'];
    const { core, server, store } = makeCore();
    const records: QueueRecord[] = [];
    for (let i = 1; i <= 9; i += 1)
      records.push(
        await core.queue.enqueue({
          type: 'CreateNote',
          commandVersion: 1,
          orderingKey: wo(i),
          payload: { id: uuid(i + 300), workOrderId: wo(i), n: i },
        }),
      );
    const results = [
      {
        mutationId: records[0]?.mutationId,
        outcome: 'applied',
        warnings: ['captured_at_out_of_range', 'idempotency_expired'],
        workOrderNumber: 'ZL/1',
      },
      { mutationId: records[1]?.mutationId, outcome: 'duplicate' },
      ...codes.map((code, i) => ({
        mutationId: records[i + 2]?.mutationId,
        outcome: code === 'id_conflict' ? 'conflict' : 'rejected',
        code,
      })),
      { mutationId: records[8]?.mutationId, outcome: 'rejected', code: 'idempotency_in_progress' },
    ];
    const body = { serverTime: '2026-10-29T08:00:00Z', results };
    expect(zSyncMutationsResponse.safeParse(body).success).toBe(true);
    for (const r of results) expect(zSyncMutationResult.safeParse(r).success).toBe(true);
    server.script.push({ kind: 'ok', body });
    await core.engine.flush();
    expect(store.settled.map((s) => s.info.outcome)).toEqual(['applied', 'duplicate']);
    expect(store.records().map((r) => r.lastCode)).toEqual([...codes, 'idempotency_in_progress']);
    expect(USER_A).toBeDefined();
  });
});

describe('payload key fields exist in the contract (EVM-091 AC1)', () => {
  it('EVM-091 AC1: the fields that give objectId and orderingKey are required properties of each payload schema', () => {
    const yaml = readFileSync(new URL('../../contracts/openapi/components/sync.yaml', import.meta.url), 'utf8');
    for (const [type, fields] of Object.entries(KEY_FIELDS)) {
      const start = yaml.indexOf(`\n${type}Payload:\n`);
      expect(start, type).toBeGreaterThanOrEqual(0);
      const rest = yaml.slice(start + 1);
      const end = rest.slice(1).search(/\n[A-Za-z]/);
      const block = end < 0 ? rest : rest.slice(0, end + 1);
      const required =
        /\n {2}required: \[([^\]]*)\]/
          .exec(block)?.[1]
          ?.split(',')
          .map((x) => x.trim()) ?? [];
      for (const field of new Set([fields.objectId, fields.orderingKey])) {
        expect(required, `${type}.${field} required`).toContain(field);
        expect(block, `${type}.${field} property`).toMatch(new RegExp(`\n {4}${field}:\n`));
      }
    }
  });
});

describe('server double idempotency (sanity of the test double)', () => {
  it('EVM-091 AC3: the double answers duplicate for a repeated mutation id', async () => {
    const server = new FakeServer();
    const request: SyncRequest = {
      mutations: [{ mutationId: wo(1), type: 'CreateNote', commandVersion: 1, payload: {} }],
      pendingItems: 1,
    };
    const first = await server.sendBatch(request);
    const second = await server.sendBatch(request);
    expect(JSON.stringify(first)).toContain('applied');
    expect(JSON.stringify(second)).toContain('duplicate');
  });
});
