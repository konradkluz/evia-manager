/**
 * `POST /api/v1/sync/mutations` against the real application and PostgreSQL (EVM-098). Synthetic data only: the texts are made up, the people are fixtures.
 */
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { IDEMPOTENCY_RETENTION_MS } from '../../src/platform/idempotency/idempotency.ts';
import type { IdentityApp } from '../support/identity-app.ts';
import { enrolledAccount } from '../support/login-flows.ts';
import { MOBILE, newPhone, setDeviceState, signedInPhone, type Phone } from '../support/mobile-flows.ts';
import { insertProcedure } from '../support/procedure-fixtures.ts';
import { bootSync, counter, DAY, editor } from '../support/sync-harness.ts';
import { insertEntries } from '../support/timeline-fixtures.ts';
import { addTotp, totpAccount, type TotpAccount } from '../support/totp-flows.ts';
import { uuidv7 } from '../support/uuid.ts';
import { insertWorkOrders, numberOf, type WorkOrderSpec } from '../support/work-order-fixtures.ts';

const PATH = '/api/v1/sync/mutations';

let current: IdentityApp;
afterEach(async () => {
  await current.close();
});

async function boot(): Promise<IdentityApp> {
  current = (await bootSync()).app;
  return current;
}

const admin = () => current.database.admin;
const problemOf = (response: Response): string => (response.body as { code: string }).code;
interface Result {
  readonly mutationId: string;
  readonly outcome: string;
  readonly code?: string;
  readonly warnings?: string[];
}
const resultsOf = (response: Response): Result[] => (response.body as { results: Result[] }).results;
const noStore = (response: Response): void => {
  expect(response.headers['cache-control']).toBe('no-store');
};

let sequence = 0;
async function order(spec: Partial<WorkOrderSpec> = {}): Promise<string> {
  sequence += 1;
  const number = numberOf(2026, 500 + sequence);
  const ids = await insertWorkOrders(admin(), [{ number, ...spec }]);
  return ids.get(number) ?? '';
}

const capturedNow = (): string => new Date(current.clock.now().getTime() - 60_000).toISOString();
const note = (workOrderId: string, payload: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  mutationId: uuidv7(),
  type: 'CreateNote',
  commandVersion: 1,
  payload: {
    id: uuidv7(),
    workOrderId,
    noteCategory: 'site_visit',
    body: 'Sprawdzono miejsce pod wallbox.',
    capturedAt: capturedNow(),
    ...payload,
  },
  ...extra,
});
const comment = (workOrderId: string, payload: Record<string, unknown> = {}) => ({
  mutationId: uuidv7(),
  type: 'CreateComment',
  commandVersion: 1,
  payload: { id: uuidv7(), workOrderId, body: 'Klient prosi o telefon przed wizytą.', capturedAt: capturedNow(), ...payload },
});
type Mutation = ReturnType<typeof note>;
const entryIdOf = (mutation: { payload: Record<string, unknown> }): string => String(mutation.payload['id']);

const push = (phone: Phone, body: unknown, headers: Record<string, string> = {}) => phone.post(PATH, body, phone.authorised(headers));

async function entryRow(id: string): Promise<Record<string, unknown> | undefined> {
  const { rows } = await sql<Record<string, unknown>>`
    select id, work_order_id, kind, note_category, body, procedure_stage_id, origin, captured_at, created_at, created_by, created_via_device_id, version
    from timeline.timeline_entries where id = ${id}`.execute(admin());
  return rows[0];
}
const entryCount = async (): Promise<number> =>
  Number(
    (await sql<{ n: string }>`select count(*)::text as n from timeline.timeline_entries where kind <> 'event'`.execute(admin())).rows[0]?.n,
  );
const records = async (): Promise<Array<Record<string, unknown>>> =>
  (await sql<Record<string, unknown>>`select * from platform.idempotency_records order by created_at, idempotency_key`.execute(admin()))
    .rows;
const pendingOf = async (deviceId: string | undefined): Promise<number> =>
  Number(
    (await sql<{ n: number }>`select pending_items_reported as n from identity.devices where id = ${deviceId ?? ''}`.execute(admin()))
      .rows[0]?.n,
  );
const auditOf = async (action: string): Promise<Array<Record<string, unknown>>> =>
  (
    await sql<Record<string, unknown>>`
      select actor_user_id, session_id, action, outcome, object_type, object_id, device_id, work_order_id, command_type, trace_id
      from audit.events where action = ${action} order by occurred_at, id`.execute(admin())
  ).rows;

async function administratorPhone(app: IdentityApp): Promise<{ account: TotpAccount; phone: Phone }> {
  const enrolled = await enrolledAccount(app, { role: 'administrator' });
  const secret = await addTotp(app, enrolled);
  const account = { ...enrolled, secret } as unknown as TotpAccount;
  return { account, phone: await signedInPhone(app, account) };
}

describe('the batch: order, own transactions and results (EVM-098 AC1)', () => {
  it('EVM-098 AC1 the mutations run in the order of the request and each one has its result in that order; a rejected one does not stop the next ones', async () => {
    const app = await boot();
    const orderId = await order();
    const { phone } = await editor(app);
    const first = note(orderId);
    const blank = comment(orderId, { body: ' \t\r\n ' });
    const third = comment(orderId);
    const quick = {
      mutationId: uuidv7(),
      type: 'CreateQuickWorkOrder',
      commandVersion: 1,
      payload: { workOrderId: uuidv7(), templateId: uuidv7(), title: 'Szybkie' },
    };
    const unknownType = { mutationId: uuidv7(), type: 'DeleteEverything', commandVersion: 1, payload: {} };
    const tooLong = note(orderId, { body: 'a'.repeat(10_001) });
    const exact = note(orderId, { body: 'ą'.repeat(10_000) });
    const oversized = note(orderId, { body: 'b'.repeat(64 * 1024) });
    const unknownVersion = note(orderId, {}, { commandVersion: 2 });
    const stranger = note(orderId, { authorId: uuidv7() });
    const batch = [first, blank, third, quick, unknownType, tooLong, exact, oversized, unknownVersion, stranger];
    const response = await push(phone, { mutations: batch });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    noStore(response);
    expect(resultsOf(response)).toEqual([
      { mutationId: first.mutationId, outcome: 'applied' },
      { mutationId: blank.mutationId, outcome: 'rejected', code: 'validation_failed' },
      { mutationId: third.mutationId, outcome: 'applied' },
      { mutationId: quick.mutationId, outcome: 'rejected', code: 'validation_failed' },
      { mutationId: unknownType.mutationId, outcome: 'rejected', code: 'validation_failed' },
      { mutationId: tooLong.mutationId, outcome: 'rejected', code: 'validation_failed' },
      { mutationId: exact.mutationId, outcome: 'applied' },
      { mutationId: oversized.mutationId, outcome: 'rejected', code: 'validation_failed' },
      { mutationId: unknownVersion.mutationId, outcome: 'rejected', code: 'validation_failed' },
      { mutationId: stranger.mutationId, outcome: 'rejected', code: 'validation_failed' },
    ]);
    expect(Date.parse((response.body as { serverTime: string }).serverTime)).toBe(app.clock.now().getTime());
    expect(await entryCount()).toBe(3);
    // a record of idempotency exists for the applied mutations only
    expect((await records()).map((record) => record['idempotency_key']).sort()).toEqual(
      [first, third, exact].map((m) => m.mutationId).sort(),
    );
    // the server time orders the journal: each mutation has its own transaction and its own moment of the clock of the app
    for (const applied of [first, third, exact]) expect(await entryRow(entryIdOf(applied))).toMatchObject({ created_at: app.clock.now() });
  });

  it('EVM-098 AC1 a bad envelope is 400 validation_failed for the whole batch, with nothing written - not even pendingItems', async () => {
    const app = await boot();
    const orderId = await order();
    const { phone } = await editor(app);
    const valid = note(orderId);
    const bodies: unknown[] = [
      { mutations: [], pendingItems: 5 },
      { mutations: Array.from({ length: 51 }, () => note(orderId)), pendingItems: 5 },
      { mutations: [{ ...valid, mutationId: 'not-a-uuid' }], pendingItems: 5 },
      { mutations: [{ ...valid, mutationId: '0193a000-0000-4000-8000-000000000a01' }], pendingItems: 5 },
      { mutations: [valid], pendingItems: 1_000_001 },
      { mutations: [valid], pendingItems: 5, deviceId: uuidv7() },
      { pendingItems: 5 },
    ];
    for (const body of bodies) {
      const response = await push(phone, body);
      expect(response.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(problemOf(response)).toBe('validation_failed');
      noStore(response);
    }
    expect(await entryCount()).toBe(0);
    expect(await records()).toEqual([]);
    expect(await pendingOf(phone.deviceId)).toBe(0);
  });

  it('EVM-098 AC1 a body over 1 MB is 413 payload_too_large (the parser answers before the guard and the bucket); a batch below 1 MB is not narrowed by a route limit', async () => {
    const app = await boot();
    const orderId = await order();
    const { phone } = await editor(app);
    const big = Array.from({ length: 50 }, () => note(orderId, { body: 'c'.repeat(9_000) }));
    const accepted = await push(phone, { mutations: big });
    expect(Buffer.byteLength(JSON.stringify({ mutations: big }))).toBeGreaterThan(400 * 1024);
    expect(accepted.status).toBe(200);
    expect(resultsOf(accepted).every((result) => result['outcome'] === 'applied')).toBe(true);
    const before = await entryCount();
    const huge = Array.from({ length: 20 }, () => note(orderId, { body: 'd'.repeat(60_000) }));
    const refused = await push(phone, { mutations: huge, pendingItems: 9 });
    expect(refused.status).toBe(413);
    expect(problemOf(refused)).toBe('payload_too_large');
    noStore(refused);
    expect(await entryCount()).toBe(before);
    expect(await pendingOf(phone.deviceId)).toBe(0);
  });

  it('EVM-098 AC1 AC4 the same mutationId twice in one batch: the second is a duplicate with the same content and an idempotency_mismatch with another', async () => {
    const app = await boot();
    const orderId = await order();
    const { phone } = await editor(app);
    const mutation = note(orderId);
    const changed = { ...mutation, payload: { ...mutation.payload, body: 'Inna treść.' } };
    const response = await push(phone, { mutations: [mutation, mutation, changed] });
    expect(resultsOf(response)).toEqual([
      { mutationId: mutation.mutationId, outcome: 'applied' },
      { mutationId: mutation.mutationId, outcome: 'duplicate' },
      { mutationId: mutation.mutationId, outcome: 'rejected', code: 'idempotency_mismatch' },
    ]);
    expect(await entryCount()).toBe(1);
  });
});

describe('the entry and the comment (EVM-098 AC2; SR-AUTHZ-04, SR-INPUT-02)', () => {
  it('EVM-098 AC2 a note and a comment are entries of the order under the identifier of the phone; the author and the device come from the session, the order of the journal from the clock of the server', async () => {
    const app = await boot();
    const orderId = await order();
    const process = await insertProcedure(admin(), orderId, { stages: [{}] });
    const { account, phone } = await editor(app);
    const captured = '2026-10-01T07:59:00.000Z';
    const withStage = note(orderId, { procedureStageId: process.stageIds[0], capturedAt: captured, body: '  Wpis  z\r\ntelefonu  ' });
    const plain = comment(orderId, { capturedAt: '2026-10-01T09:59:00+02:00' });
    const response = await push(phone, { mutations: [withStage, plain] });
    expect(resultsOf(response).map((result) => result['outcome'])).toEqual(['applied', 'applied']);
    expect(await entryRow(entryIdOf(withStage))).toEqual({
      id: entryIdOf(withStage),
      work_order_id: orderId,
      kind: 'note',
      note_category: 'site_visit',
      // the rules of the panel: the text is normalised the same way
      body: 'Wpis  z\ntelefonu',
      procedure_stage_id: process.stageIds[0],
      origin: 'mobile',
      captured_at: new Date(captured),
      created_at: app.clock.now(),
      created_by: account.user.id,
      created_via_device_id: phone.deviceId,
      version: 1,
    });
    expect(await entryRow(entryIdOf(plain))).toMatchObject({
      kind: 'comment',
      note_category: null,
      origin: 'mobile',
      captured_at: new Date('2026-10-01T07:59:00.000Z'),
      created_via_device_id: phone.deviceId,
    });
  });

  it('EVM-098 AC2 the entry is in the journal of the panel and looks like one written there, but for its origin', async () => {
    const app = await boot();
    const orderId = await order();
    const { account, phone } = await editor(app);
    const fromPhone = comment(orderId, { capturedAt: app.clock.now().toISOString() });
    expect(resultsOf(await push(phone, { mutations: [fromPhone] }))[0]?.['outcome']).toBe('applied');
    const panelId = uuidv7();
    const created = await account.panel.post(
      `/api/v1/work-orders/${orderId}/timeline`,
      { id: panelId, kind: 'comment', body: 'Klient prosi o telefon przed wizytą.' },
      { 'Idempotency-Key': uuidv7() },
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const list = await account.panel.get(`/api/v1/work-orders/${orderId}/timeline`);
    expect(list.status).toBe(200);
    const items = (list.body as { items: Array<Record<string, unknown>> }).items;
    const mobile = items.find((item) => item['id'] === entryIdOf(fromPhone));
    const web = items.find((item) => item['id'] === panelId);
    expect(mobile).toBeDefined();
    expect(Object.keys(mobile ?? {}).sort()).toEqual(Object.keys(web ?? {}).sort());
    expect(mobile).toMatchObject({ kind: 'comment', origin: 'mobile', body: 'Klient prosi o telefon przed wizytą.' });
    expect(web).toMatchObject({ origin: 'web' });
    const strip = (item: Record<string, unknown> | undefined) =>
      Object.fromEntries(Object.entries(item ?? {}).filter(([key]) => !['id', 'origin', 'capturedAt', 'createdAt'].includes(key)));
    expect(strip(mobile)).toEqual(strip(web));
    // the device is never part of the answer
    expect(JSON.stringify(list.body)).not.toContain(phone.deviceId ?? '');
  });

  it('EVM-098 AC2 a settled and a cancelled order take an entry; a stage of another order, a missing stage and a note without a category are validation_failed with nothing written', async () => {
    const app = await boot();
    const settled = await order({ status: 'settled', closedAt: new Date('2026-09-30T08:00:00Z') });
    const cancelled = await order({ status: 'cancelled', closedAt: new Date('2026-09-30T08:00:00Z') });
    const other = await order();
    const foreignStage = (await insertProcedure(admin(), other, { stages: [{}] })).stageIds[0];
    const { phone } = await editor(app);
    const toSettled = note(settled);
    const toCancelled = comment(cancelled);
    const wrongStage = note(settled, { procedureStageId: foreignStage });
    const missingStage = note(settled, { procedureStageId: uuidv7() });
    const noCategory = { ...note(settled), payload: { ...note(settled).payload, noteCategory: undefined } };
    const response = await push(phone, { mutations: [toSettled, toCancelled, wrongStage, missingStage, noCategory] });
    expect(resultsOf(response).map((result) => [result['outcome'], result['code']])).toEqual([
      ['applied', undefined],
      ['applied', undefined],
      ['rejected', 'validation_failed'],
      ['rejected', 'validation_failed'],
      ['rejected', 'validation_failed'],
    ]);
    for (const refused of [wrongStage, missingStage]) expect(await entryRow(entryIdOf(refused))).toBeUndefined();
    expect(await records()).toHaveLength(2);
  });
});

describe('the identifier: INSERT only (EVM-098 AC3; CWE-639, CWE-915)', () => {
  it('EVM-098 AC3 an existing identifier - own, of somebody else, deleted, an event, of another order, of another kind - is the same conflict id_conflict, changes nothing and leaves no record', async () => {
    const app = await boot();
    const orderId = await order();
    const other = await order();
    const { account, phone } = await editor(app);
    const colleague = await totpAccount(app, { role: 'editor' });
    const [own = '', foreign = '', deleted = '', ownComment = ''] = await insertEntries(admin(), orderId, account.user.id, [
      { body: 'Własny wpis' },
      { body: 'Cudzy wpis', authorUserId: colleague.user.id },
      { body: 'Usunięty wpis', deletedAt: '2026-10-01T08:00:00Z' },
      { kind: 'comment', body: 'Własny komentarz' },
    ]);
    const [elsewhere = ''] = await insertEntries(admin(), other, account.user.id, [{ body: 'Wpis innego zlecenia' }]);
    const [event = ''] = await insertEntries(admin(), orderId, account.user.id, [{ kind: 'event' }]);
    const before = await sql`select * from timeline.timeline_entries order by id`.execute(admin());
    const ids = [own, foreign, deleted, elsewhere, event, ownComment];
    const mutations = ids.map((id) => note(orderId, { id }));
    const response = await push(phone, { mutations });
    expect(response.status).toBe(200);
    expect(resultsOf(response)).toEqual(
      mutations.map((mutation) => ({ mutationId: mutation.mutationId, outcome: 'conflict', code: 'id_conflict' })),
    );
    expect((await sql`select * from timeline.timeline_entries order by id`.execute(admin())).rows).toEqual(before.rows);
    expect(await records()).toEqual([]);
    expect(await auditOf('sync.mutation_applied')).toEqual([]);
  });

  it('EVM-098 AC3 two mutations of one batch with the same identifier of an entry: the first is applied, the second is a conflict', async () => {
    const app = await boot();
    const orderId = await order();
    const { phone } = await editor(app);
    const first = note(orderId);
    const second = comment(orderId, { id: entryIdOf(first) });
    expect(resultsOf(await push(phone, { mutations: [first, second] }))).toEqual([
      { mutationId: first.mutationId, outcome: 'applied' },
      { mutationId: second.mutationId, outcome: 'conflict', code: 'id_conflict' },
    ]);
    expect(await entryRow(entryIdOf(first))).toMatchObject({ kind: 'note' });
  });
});

describe('idempotency (EVM-098 AC4; SR-SYNC-03, SR-API-05, AB-09)', () => {
  it('EVM-098 AC4 a repeated batch is a duplicate: no second entry, no second audit event, no content in the answer; another body or another type with the same mutationId is idempotency_mismatch', async () => {
    const app = await boot();
    const orderId = await order();
    const { phone } = await editor(app);
    const mutation = note(orderId);
    expect(resultsOf(await push(phone, { mutations: [mutation] }))).toEqual([{ mutationId: mutation.mutationId, outcome: 'applied' }]);
    const auditBefore = (await sql<{ n: string }>`select count(*)::text as n from audit.events`.execute(admin())).rows[0]?.n;
    const again = await push(phone, { mutations: [mutation] });
    expect(again.body).toEqual({
      serverTime: app.clock.now().toISOString(),
      results: [{ mutationId: mutation.mutationId, outcome: 'duplicate' }],
    });
    expect(JSON.stringify(again.body)).not.toContain('Sprawdzono');
    expect((await sql<{ n: string }>`select count(*)::text as n from audit.events`.execute(admin())).rows[0]?.n).toBe(auditBefore);
    const otherBody = { ...mutation, payload: { ...mutation.payload, body: 'Zmieniona treść.' } };
    const otherType = { ...comment(orderId, { id: entryIdOf(mutation) }), mutationId: mutation.mutationId };
    expect(resultsOf(await push(phone, { mutations: [otherBody, otherType] }))).toEqual([
      { mutationId: mutation.mutationId, outcome: 'rejected', code: 'idempotency_mismatch' },
      { mutationId: mutation.mutationId, outcome: 'rejected', code: 'idempotency_mismatch' },
    ]);
    expect(await entryCount()).toBe(1);
    expect(await records()).toHaveLength(1);
  });

  it('EVM-098 AC4 the key is the user, the device of the session and mutationId: the same mutationId from another device or another user is an independent mutation', async () => {
    const app = await boot();
    const orderId = await order();
    const { account, phone } = await editor(app);
    const secondPhone = await signedInPhone(app, account);
    const { phone: colleaguePhone } = await editor(app);
    const mutation = note(orderId);
    expect(resultsOf(await push(phone, { mutations: [mutation] }))[0]?.['outcome']).toBe('applied');
    const sameKeyOtherEntry = (): Mutation => ({ ...note(orderId), mutationId: mutation.mutationId });
    expect(resultsOf(await push(secondPhone, { mutations: [sameKeyOtherEntry()] }))[0]?.['outcome']).toBe('applied');
    expect(resultsOf(await push(colleaguePhone, { mutations: [sameKeyOtherEntry()] }))[0]?.['outcome']).toBe('applied');
    expect(await entryCount()).toBe(3);
    const devices = (await records()).map((record) => record['device_id']);
    expect(new Set(devices).size).toBe(3);
  });

  it('EVM-098 AC4 a previous attempt in progress is idempotency_in_progress with no effect; once it ends the same mutation is applied', async () => {
    const app = await boot();
    const orderId = await order();
    const { account, phone } = await editor(app);
    const mutation = note(orderId);
    const name = `idempotency|${account.user.id}|${phone.deviceId ?? ''}|${mutation.mutationId}`;
    await admin()
      .connection()
      .execute(async (connection) => {
        await sql`select pg_advisory_lock(hashtextextended(${name}, 0))`.execute(connection);
        try {
          const busy = await push(phone, { mutations: [mutation] });
          expect(resultsOf(busy)).toEqual([{ mutationId: mutation.mutationId, outcome: 'rejected', code: 'idempotency_in_progress' }]);
          expect(await entryCount()).toBe(0);
        } finally {
          await sql`select pg_advisory_unlock(hashtextextended(${name}, 0))`.execute(connection);
        }
      });
    expect(resultsOf(await push(phone, { mutations: [mutation] }))[0]?.['outcome']).toBe('applied');
  });

  it('EVM-098 AC4 two requests at the same moment with the same mutationId: one is applied, the other a duplicate or in progress - always one entry', async () => {
    const app = await boot();
    const orderId = await order();
    const { phone } = await editor(app);
    for (let round = 0; round < 5; round += 1) {
      const mutation = note(orderId);
      const answers = await Promise.all([push(phone, { mutations: [mutation] }), push(phone, { mutations: [mutation] })]);
      const outcomes = answers.map((answer) => (resultsOf(answer)[0]?.outcome ?? '') + (resultsOf(answer)[0]?.code ?? ''));
      expect(outcomes.filter((outcome) => outcome === 'applied')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome !== 'applied')[0]).toMatch(/^(duplicate|rejectedidempotency_in_progress)$/);
      const { rows } = await sql<{
        n: string;
      }>`select count(*)::text as n from timeline.timeline_entries where id = ${entryIdOf(mutation)}`.execute(admin());
      expect(rows[0]?.n).toBe('1');
    }
  });

  it('EVM-098 AC4 after the record expired, a retry is a duplicate with idempotency_expired only for an entry of the same identifier, kind, order, user and device - and it writes no record', async () => {
    const app = await boot();
    const orderId = await order();
    const other = await order();
    const { account, phone } = await editor(app);
    const colleague = await totpAccount(app, { role: 'editor' });
    const old = new Date(app.clock.now().getTime() - IDEMPOTENCY_RETENTION_MS);
    const insertOld = async (spec: {
      kind?: 'note' | 'comment';
      workOrderId?: string;
      userId?: string;
      deviceId?: string | null;
      createdAt?: Date;
    }) => {
      const id = uuidv7();
      const kind = spec.kind ?? 'note';
      await sql`insert into timeline.timeline_entries
          (id, work_order_id, kind, note_category, body, origin, created_at, created_by, created_via_device_id)
        values (${id}, ${spec.workOrderId ?? orderId}, ${kind}, ${kind === 'note' ? 'site_visit' : null}, 'Stary wpis', 'mobile',
          ${spec.createdAt ?? old}, ${spec.userId ?? account.user.id}, ${spec.deviceId === undefined ? (phone.deviceId ?? null) : spec.deviceId})`.execute(
        admin(),
      );
      return id;
    };
    const own = await insertOld({});
    // the record of the first application, expired but not purged yet: it must stay as it is
    const retried = note(orderId, { id: own });
    await sql`insert into platform.idempotency_records
        (user_id, device_id, idempotency_key, scope, request_hash, result_status, result_code, result_resource_id, created_at, expires_at)
      values (${account.user.id}, ${phone.deviceId ?? ''}, ${retried.mutationId}, 'POST /api/v1/sync/mutations', ${'0'.repeat(64)}, 201, 'applied', ${own},
        ${old}, ${app.clock.now()})`.execute(admin());
    const recordsBefore = await records();
    const cases = {
      own: retried,
      otherDevice: note(orderId, { id: await insertOld({ deviceId: uuidv7() }) }),
      otherUser: note(orderId, { id: await insertOld({ userId: colleague.user.id }) }),
      otherKind: note(orderId, { id: await insertOld({ kind: 'comment' }) }),
      otherOrder: note(orderId, { id: await insertOld({ workOrderId: other }) }),
      fresh: note(orderId, { id: await insertOld({ createdAt: new Date(old.getTime() + 1) }) }),
      // the order is checked first: an identifier behind no access (here: no such order) never reaches the rule
      noOrder: note(uuidv7(), { id: own }),
    };
    const response = await push(phone, { mutations: Object.values(cases) });
    expect(Object.fromEntries(Object.keys(cases).map((key, index) => [key, resultsOf(response)[index]]))).toEqual({
      own: { mutationId: cases.own.mutationId, outcome: 'duplicate', warnings: ['idempotency_expired'] },
      otherDevice: { mutationId: cases.otherDevice.mutationId, outcome: 'conflict', code: 'id_conflict' },
      otherUser: { mutationId: cases.otherUser.mutationId, outcome: 'conflict', code: 'id_conflict' },
      otherKind: { mutationId: cases.otherKind.mutationId, outcome: 'conflict', code: 'id_conflict' },
      otherOrder: { mutationId: cases.otherOrder.mutationId, outcome: 'conflict', code: 'id_conflict' },
      fresh: { mutationId: cases.fresh.mutationId, outcome: 'conflict', code: 'id_conflict' },
      noOrder: { mutationId: cases.noOrder.mutationId, outcome: 'rejected', code: 'forbidden' },
    });
    // no new record, and the expired one is not overwritten
    expect(await records()).toEqual(recordsBefore);
  });

  it('EVM-098 AC4 AC6 a rejected mutation leaves no record: after the order is restored the same mutation is applied', async () => {
    const app = await boot();
    const orderId = await order({ deletedAt: new Date('2026-09-30T08:00:00Z') });
    const { phone } = await editor(app);
    const mutation = note(orderId);
    expect(resultsOf(await push(phone, { mutations: [mutation] }))[0]).toEqual({
      mutationId: mutation.mutationId,
      outcome: 'rejected',
      code: 'target_unavailable',
    });
    expect(await records()).toEqual([]);
    await sql`update work_orders.work_orders set deleted_at = null, version = version + 1 where id = ${orderId}`.execute(admin());
    expect(resultsOf(await push(phone, { mutations: [mutation] }))[0]).toEqual({ mutationId: mutation.mutationId, outcome: 'applied' });
  });
});

describe('who may push (EVM-098 AC5; SR-AUTHZ-05, SR-AUTHZ-12, SR-SYNC-01, ASVS V8.1.1)', () => {
  it('EVM-098 AC5 Administrator and Editor are served; Read-only (also after a change of the role) is 403 forbidden; no token, a foreign token and the cookie of the panel are 401 - with no effect', async () => {
    const app = await boot();
    const orderId = await order();
    const { phone: adminPhone } = await administratorPhone(app);
    const { phone: editorPhone, account } = await editor(app);
    for (const phone of [adminPhone, editorPhone]) {
      const response = await push(phone, { mutations: [note(orderId)] });
      expect(response.status).toBe(200);
      noStore(response);
      expect(resultsOf(response)[0]?.['outcome']).toBe('applied');
    }
    const demoted = await editor(app);
    await sql`update identity.users set role = 'read_only' where id = ${demoted.account.user.id}`.execute(admin());
    const before = await entryCount();
    const recordsBefore = await records();
    const denied = await push(demoted.phone, { mutations: [note(orderId)], pendingItems: 7 });
    expect(denied.status).toBe(403);
    expect(problemOf(denied)).toBe('forbidden');
    noStore(denied);
    const anonymous = newPhone(app);
    const credentials: Array<Record<string, string>> = [
      {},
      { Authorization: `Bearer evia_at_${'A'.repeat(43)}` },
      { Authorization: 'Basic abc' },
    ];
    for (const headers of credentials) {
      const response = await anonymous.post(PATH, { mutations: [note(orderId)], pendingItems: 7 }, headers);
      expect(response.status).toBe(401);
      noStore(response);
    }
    const viaCookie = await account.panel.post(PATH, { mutations: [note(orderId)] });
    expect(viaCookie.status).toBe(401);
    noStore(viaCookie);
    expect(await entryCount()).toBe(before);
    expect(await records()).toEqual(recordsBefore);
    expect(await pendingOf(demoted.phone.deviceId)).toBe(0);
  });

  it('EVM-098 AC5 a revoked session is 401 session_revoked and a device to wipe 401 device_wipe_required (it wins over the revocation) for the whole batch; an old app is 426 - nothing is processed', async () => {
    const app = await boot();
    const orderId = await order();
    const revoked = await editor(app);
    expect((await revoked.phone.post(MOBILE.logout, undefined, revoked.phone.authorised())).status).toBe(204);
    const answer = await push(revoked.phone, { mutations: [note(orderId)], pendingItems: 3 });
    expect([answer.status, problemOf(answer)]).toEqual([401, 'session_revoked']);
    noStore(answer);
    await setDeviceState(app, revoked.phone.deviceId ?? '', 'wipe_required');
    const both = await push(revoked.phone, { mutations: [note(orderId)] });
    expect([both.status, problemOf(both)]).toEqual([401, 'device_wipe_required']);
    const wiped = await editor(app);
    await setDeviceState(app, wiped.phone.deviceId ?? '', 'wipe_required');
    const wipe = await push(wiped.phone, { mutations: [note(orderId)], pendingItems: 3 });
    expect([wipe.status, problemOf(wipe)]).toEqual([401, 'device_wipe_required']);
    noStore(wipe);
    const old = await editor(app);
    const outdated = await push(old.phone, { mutations: [note(orderId)], pendingItems: 3 }, { 'X-Client-Version': '0.0.1' });
    expect(outdated.status).toBe(426);
    noStore(outdated);
    expect(await entryCount()).toBe(0);
    expect(await records()).toEqual([]);
    for (const phone of [revoked.phone, wiped.phone, old.phone]) expect(await pendingOf(phone.deviceId)).toBe(0);
  });

  it('EVM-098 AC5 the 61st batch of a device within a minute is 429 rate_limited with Retry-After and no effect; another phone of the same user has its own bucket; the next minute is open again', async () => {
    const app = await boot();
    const orderId = await order();
    const { account, phone } = await editor(app);
    const secondPhone = await signedInPhone(app, account);
    for (let index = 0; index < 60; index += 1) {
      const response = await push(phone, { mutations: [{ mutationId: uuidv7(), type: 'Nothing', commandVersion: 1, payload: {} }] });
      expect(response.status, String(index)).toBe(200);
    }
    const mutation = note(orderId);
    const limited = await push(phone, { mutations: [mutation], pendingItems: 11 });
    expect(limited.status).toBe(429);
    expect(problemOf(limited)).toBe('rate_limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    noStore(limited);
    expect(await entryCount()).toBe(0);
    expect(await records()).toEqual([]);
    expect(await pendingOf(phone.deviceId)).toBe(0);
    expect((await push(secondPhone, { mutations: [note(orderId)] })).status).toBe(200);
    app.clock.advance(61_000);
    const later = await push(phone, { mutations: [mutation], pendingItems: 11 });
    expect(resultsOf(later)[0]?.['outcome']).toBe('applied');
    expect(await pendingOf(phone.deviceId)).toBe(11);
  });
});

describe('authorisation at the moment of the synchronisation (EVM-098 AC6; SR-AUTHZ-02, SR-AUTHZ-05, ASVS V8.2.2, CWE-639)', () => {
  it('EVM-098 AC6 an order that does not exist is forbidden - the same whole answer as an order without access - and a deleted one target_unavailable, for the Editor and the Administrator; nothing is written', async () => {
    const app = await boot();
    const deleted = await order({ deletedAt: new Date('2026-09-30T08:00:00Z') });
    const live = await order();
    const { phone: editorPhone } = await editor(app);
    const { phone: adminPhone } = await administratorPhone(app);
    for (const phone of [editorPhone, adminPhone]) {
      const missing = note(uuidv7());
      const missingAgain = { ...note(uuidv7()), mutationId: missing.mutationId };
      const gone = comment(deleted);
      const response = await push(phone, { mutations: [missing, gone] });
      expect(resultsOf(response)).toEqual([
        { mutationId: missing.mutationId, outcome: 'rejected', code: 'forbidden' },
        { mutationId: gone.mutationId, outcome: 'rejected', code: 'target_unavailable' },
      ]);
      // another identifier of a missing order: the representation of the result is the same, byte for byte
      const again = await push(phone, { mutations: [missingAgain] });
      expect(JSON.stringify(resultsOf(again)[0])).toBe(JSON.stringify(resultsOf(response)[0]));
    }
    expect(await entryCount()).toBe(0);
    expect(await records()).toEqual([]);
    expect(resultsOf(await push(editorPhone, { mutations: [note(live)] }))[0]?.['outcome']).toBe('applied');
  });
});

describe('capturedAt out of range (EVM-098 AC7; SR-SYNC-05)', () => {
  it('EVM-098 AC7 older than 60 days or later than the server + 10 minutes is applied with captured_at_out_of_range and stored without capturedAt; in range it is kept; a duplicate has no warning', async () => {
    const app = await boot();
    const orderId = await order();
    const { phone } = await editor(app);
    const now = app.clock.now().getTime();
    const tooOld = note(orderId, { capturedAt: new Date(now - 60 * DAY - 1).toISOString() });
    const tooLate = comment(orderId, { capturedAt: new Date(now + 10 * 60_000 + 1).toISOString() });
    const oldest = note(orderId, { capturedAt: new Date(now - 60 * DAY).toISOString() });
    const response = await push(phone, { mutations: [tooOld, tooLate, oldest] });
    expect(resultsOf(response)).toEqual([
      { mutationId: tooOld.mutationId, outcome: 'applied', warnings: ['captured_at_out_of_range'] },
      { mutationId: tooLate.mutationId, outcome: 'applied', warnings: ['captured_at_out_of_range'] },
      { mutationId: oldest.mutationId, outcome: 'applied' },
    ]);
    expect(await entryRow(entryIdOf(tooOld))).toMatchObject({ captured_at: null, body: 'Sprawdzono miejsce pod wallbox.' });
    expect(await entryRow(entryIdOf(tooLate))).toMatchObject({ captured_at: null });
    expect(await entryRow(entryIdOf(oldest))).toMatchObject({ captured_at: new Date(now - 60 * DAY) });
    expect(resultsOf(await push(phone, { mutations: [tooOld] }))).toEqual([{ mutationId: tooOld.mutationId, outcome: 'duplicate' }]);
  });
});

describe('audit, atomicity and pendingItems (EVM-098 AC8; SR-API-06, SR-LOG-03, SR-LOG-04)', () => {
  it('EVM-098 AC8 an applied mutation writes the entry, the record and the audit event in one transaction: the type, the order, the entry, the device, the session - no text', async () => {
    const app = await boot();
    const orderId = await order();
    const { account, phone } = await editor(app);
    const first = note(orderId, { body: 'TEKST-WPISU-NIE-DO-AUDYTU' });
    const second = comment(orderId, { body: 'TEKST-KOMENTARZA-NIE-DO-AUDYTU' });
    await push(phone, { mutations: [first, second] });
    const applied = await auditOf('sync.mutation_applied');
    expect(applied).toEqual([
      expect.objectContaining({
        actor_user_id: account.user.id,
        outcome: 'success',
        object_type: 'timeline_entry',
        object_id: entryIdOf(first),
        device_id: phone.deviceId,
        work_order_id: orderId,
        command_type: 'CreateNote',
      }),
      expect.objectContaining({ object_id: entryIdOf(second), command_type: 'CreateComment', device_id: phone.deviceId }),
    ]);
    for (const event of applied) {
      expect(event['session_id']).toEqual(expect.any(String));
      expect(event['trace_id']).toMatch(/^[0-9a-f]{32}$/);
    }
    // timeline writes its own event of the creation, as in the panel
    expect((await auditOf('timeline_entry.created')).map((event) => event['object_id'])).toEqual([entryIdOf(first), entryIdOf(second)]);
    const everything = JSON.stringify((await sql`select * from audit.events`.execute(admin())).rows);
    expect(everything).not.toContain('NIE-DO-AUDYTU');
    expect(everything).not.toContain(first.mutationId);
  });

  it('EVM-098 AC8 a failed write of the audit trail is 500 for the batch: that mutation leaves nothing, the earlier ones stay committed, the later ones are not processed; the retry is safe', async () => {
    const app = await boot();
    const orderId = await order();
    const { phone } = await editor(app);
    const [first, failing, third] = [note(orderId), comment(orderId), note(orderId)];
    // the entries whose audit event must fail are in a table of the test; the function is static (no SQL built from values)
    await sql`create table public.evm098_failing (object_id uuid primary key)`.execute(admin());
    await sql`insert into public.evm098_failing values (${entryIdOf(failing)})`.execute(admin());
    await sql`
      create function public.evm098_fail_audit() returns trigger language plpgsql security definer set search_path = pg_catalog as $$
      begin
        if new.action = 'sync.mutation_applied' and exists (select 1 from public.evm098_failing f where f.object_id = new.object_id) then
          raise exception 'injected failure';
        end if;
        return new;
      end $$`.execute(admin());
    await sql`create trigger evm098_fail_audit before insert on audit.events for each row execute function public.evm098_fail_audit()`.execute(
      admin(),
    );
    const broken = await push(phone, { mutations: [first, failing, third] });
    expect(broken.status).toBe(500);
    noStore(broken);
    expect(broken.headers['content-type']).toMatch(/application\/problem\+json/);
    expect((broken.body as { traceId?: string }).traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(broken.body)).not.toContain(failing.mutationId);
    expect(JSON.stringify(broken.body)).not.toContain('injected');
    expect(await entryRow(entryIdOf(first))).toBeDefined();
    expect(await entryRow(entryIdOf(failing))).toBeUndefined();
    expect(await entryRow(entryIdOf(third))).toBeUndefined();
    expect((await records()).map((record) => record['idempotency_key'])).toEqual([first.mutationId]);
    expect((await auditOf('timeline_entry.created')).map((event) => event['object_id'])).toEqual([entryIdOf(first)]);
    await sql`drop trigger evm098_fail_audit on audit.events`.execute(admin());
    const retry = await push(phone, { mutations: [first, failing, third] });
    expect(resultsOf(retry).map((result) => result['outcome'])).toEqual(['duplicate', 'applied', 'applied']);
  });

  it('EVM-098 AC8 pendingItems of a valid request is written for the device of the session whatever the results, a value over 10 000 lowered to 10 000', async () => {
    const app = await boot();
    const { phone } = await editor(app);
    const other = await editor(app);
    const allRejected = await push(phone, { mutations: [note(uuidv7())], pendingItems: 20_000 });
    expect(resultsOf(allRejected)[0]?.['code']).toBe('forbidden');
    expect(await pendingOf(phone.deviceId)).toBe(10_000);
    await push(phone, { mutations: [note(uuidv7())], pendingItems: 4 });
    expect(await pendingOf(phone.deviceId)).toBe(4);
    await push(phone, { mutations: [note(uuidv7())] });
    expect(await pendingOf(phone.deviceId)).toBe(4);
    expect(await pendingOf(other.phone.deviceId)).toBe(0);
  });

  it('EVM-098 AC1 AC8 the operator counts the results by type, outcome and code - closed labels, no identifier', async () => {
    const app = await boot();
    const orderId = await order();
    const { phone } = await editor(app);
    await push(phone, {
      mutations: [note(orderId), comment(uuidv7()), { mutationId: uuidv7(), type: 'Invented_By_Client', commandVersion: 1, payload: {} }],
    });
    expect(counter(app, 'sync_mutation_outcomes_total', { type: 'create_note', outcome: 'applied', code: 'none' })).toBe(1);
    expect(counter(app, 'sync_mutation_outcomes_total', { type: 'create_comment', outcome: 'rejected', code: 'forbidden' })).toBe(1);
    expect(counter(app, 'sync_mutation_outcomes_total', { type: 'unknown', outcome: 'rejected', code: 'validation_failed' })).toBe(1);
  });
});
