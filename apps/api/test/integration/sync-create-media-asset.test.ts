/**
 * `CreateMediaAsset` through `POST /api/v1/sync/mutations` against the real application and PostgreSQL (EVM-131 AC3; SR-SYNC-01, SR-SYNC-02, SR-SYNC-03, SR-SYNC-05, SR-INPUT-01,
 * SR-INPUT-02, SR-LOG-03, CWE-639, CWE-915). Synthetic data only: the descriptions are made up and carry a sentinel that must never reach a log or the audit trail.
 */
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { IdentityApp } from '../support/identity-app.ts';
import { insertMedia } from '../support/media-fixtures.ts';
import type { Phone } from '../support/mobile-flows.ts';
import { insertProcedure } from '../support/procedure-fixtures.ts';
import { bootSync, counter, drain, editor, upsertOf } from '../support/sync-harness.ts';
import { uuidv7 } from '../support/uuid.ts';
import { insertWorkOrders, numberOf, type WorkOrderSpec } from '../support/work-order-fixtures.ts';

const PATH = '/api/v1/sync/mutations';
const DESCRIPTION = 'SENTINEL-OPIS-ZDJECIA Jan Przykladowy';

let current: IdentityApp;
afterEach(async () => {
  await current.close();
});
async function boot(): Promise<IdentityApp> {
  current = (await bootSync()).app;
  return current;
}
const admin = () => current.database.admin;

interface Result {
  readonly mutationId: string;
  readonly outcome: string;
  readonly code?: string;
  readonly warnings?: string[];
  readonly errors?: unknown;
}
const resultsOf = (response: Response): Result[] => (response.body as { results: Result[] }).results;
const push = (phone: Phone, body: unknown) => phone.post(PATH, body, phone.authorised());
async function pushOne(phone: Phone, mutation: unknown): Promise<Result> {
  const response = await push(phone, { mutations: [mutation] });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  return resultsOf(response)[0] as Result;
}

let sequence = 0;
async function order(spec: Partial<WorkOrderSpec> = {}): Promise<string> {
  sequence += 1;
  const number = numberOf(2026, 700 + sequence);
  const ids = await insertWorkOrders(admin(), [{ number, ...spec }]);
  return ids.get(number) ?? '';
}

const capturedNow = (): string => new Date(current.clock.now().getTime() - 60_000).toISOString();
const media = (workOrderId: string, payload: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  mutationId: uuidv7(),
  type: 'CreateMediaAsset',
  commandVersion: 1,
  payload: { id: uuidv7(), workOrderId, mediaType: 'photo', category: 'before_work', capturedAt: capturedNow(), ...payload },
  ...extra,
});
const mediaIdOf = (mutation: { payload: Record<string, unknown> }): string => String(mutation.payload['id']);

const assetRow = async (id: string): Promise<Record<string, unknown> | undefined> =>
  (
    await sql<Record<string, unknown>>`
      select id, work_order_id, procedure_stage_id, media_type, category, description, origin, captured_at, created_by, version, file_state_revision
      from media.media_assets where id = ${id}`.execute(admin())
  ).rows[0];
const assetCount = async (): Promise<number> =>
  Number((await sql<{ n: string }>`select count(*)::text as n from media.media_assets`.execute(admin())).rows[0]?.n);
const fileCount = async (): Promise<number> =>
  Number((await sql<{ n: string }>`select count(*)::text as n from media.stored_files`.execute(admin())).rows[0]?.n);
const auditOf = async (action: string): Promise<Array<Record<string, unknown>>> =>
  (
    await sql<Record<string, unknown>>`
      select actor_user_id, action, outcome, object_type, object_id, device_id, work_order_id, command_type, origin
      from audit.events where action = ${action} order by occurred_at, id`.execute(admin())
  ).rows;

describe('CreateMediaAsset creates the medium once (EVM-131 AC3; SR-SYNC-03)', () => {
  it('EVM-131 AC3 the medium is created with the user and the device of the SESSION, origin mobile, the rules of the panel for the text and NO file; a repeat is a duplicate without a second medium', async () => {
    const app = await boot();
    const orderId = await order();
    const { account, phone } = await editor(app);
    const stage = (await insertProcedure(admin(), orderId)).stageIds[0] ?? '';
    const mutation = media(orderId, {
      description: `  ${DESCRIPTION}\r\n`,
      procedureStageId: stage,
      category: 'defect',
      mediaType: 'video',
    });

    expect(await pushOne(phone, mutation)).toEqual({ mutationId: mutation.mutationId, outcome: 'applied' });
    const row = await assetRow(mediaIdOf(mutation));
    expect(row).toMatchObject({
      work_order_id: orderId,
      procedure_stage_id: stage,
      media_type: 'video',
      category: 'defect',
      description: DESCRIPTION,
      origin: 'mobile',
      created_by: account.user.id,
      version: 1,
      file_state_revision: 0,
    });
    expect((row?.['captured_at'] as Date).toISOString()).toBe(mutation.payload['capturedAt']);
    expect(await fileCount()).toBe(0);

    // the same mutation again: the same answer, no duplicate, no second audit event
    expect(await pushOne(phone, mutation)).toEqual({ mutationId: mutation.mutationId, outcome: 'duplicate' });
    expect(await assetCount()).toBe(1);
    expect(await auditOf('media_asset.created')).toHaveLength(1);
    expect(await auditOf('sync.mutation_applied')).toHaveLength(1);
  });

  it('EVM-131 AC3 the audit trail has the medium, the order, the device and the type of the command - never the description; the log has none of it either', async () => {
    const app = await boot();
    const orderId = await order();
    const { account, phone } = await editor(app);
    const mutation = media(orderId, { description: DESCRIPTION });
    await pushOne(phone, mutation);
    const mutationApplied = await auditOf('sync.mutation_applied');
    expect(mutationApplied).toEqual([
      expect.objectContaining({
        actor_user_id: account.user.id,
        outcome: 'success',
        object_type: 'media_asset',
        object_id: mediaIdOf(mutation),
        device_id: phone.deviceId,
        work_order_id: orderId,
        command_type: 'CreateMediaAsset',
      }),
    ]);
    expect(await auditOf('media_asset.created')).toEqual([
      expect.objectContaining({ object_type: 'media_asset', object_id: mediaIdOf(mutation) }),
    ]);
    const everything = JSON.stringify((await sql<Record<string, unknown>>`select * from audit.events`.execute(admin())).rows);
    expect(everything).not.toContain('SENTINEL');
    expect(everything).not.toContain('Przykladowy');
    expect(app.logs.text).not.toContain('SENTINEL');
    expect(app.logs.text).not.toContain('Przykladowy');
    // the journal of the order records that a medium was added - the identifier only
    const journal = JSON.stringify(
      (await sql<Record<string, unknown>>`select * from timeline.timeline_entries where work_order_id = ${orderId}`.execute(admin())).rows,
    );
    expect(journal).not.toContain('SENTINEL');
  });

  it('EVM-131 AC3 the same mutationId with another content is idempotency_mismatch and creates nothing', async () => {
    const app = await boot();
    const orderId = await order();
    const { phone } = await editor(app);
    const mutation = media(orderId);
    expect((await pushOne(phone, mutation)).outcome).toBe('applied');
    const changed = { ...mutation, payload: { ...mutation.payload, category: 'defect' } };
    expect(await pushOne(phone, changed)).toMatchObject({ outcome: 'rejected', code: 'idempotency_mismatch' });
    expect(await assetRow(mediaIdOf(mutation))).toMatchObject({ category: 'before_work' });
  });

  it('EVM-131 AC3 an identifier that exists - a medium of the panel, of another order or of another user - is conflict id_conflict: never an upsert, nothing of the existing medium is read or changed', async () => {
    const app = await boot();
    const orderId = await order();
    const otherOrder = await order();
    const { phone } = await editor(app);
    const stranger = await insertMedia(admin(), {
      workOrderId: otherOrder,
      createdBy: (await editor(app)).account.user.id,
      state: 'clean',
    });
    const before = await assetRow(stranger.mediaAssetId);
    const mutation = media(orderId, { id: stranger.mediaAssetId, category: 'defect', description: 'inne' });
    expect(await pushOne(phone, mutation)).toEqual({ mutationId: mutation.mutationId, outcome: 'conflict', code: 'id_conflict' });
    expect(await assetRow(stranger.mediaAssetId)).toEqual(before);
    // the conflict leaves no record of idempotency and no audit event: the transaction was rolled back
    expect(await auditOf('sync.mutation_applied')).toEqual([]);
  });

  it('EVM-131 AC3 a rejected command writes nothing: no medium, no file, no change in the log, no audit event', async () => {
    const app = await boot();
    const orderId = await order();
    const { phone } = await editor(app);
    const before = Number(
      (await sql<{ n: string }>`select count(*)::text as n from sync.change_log where entity_type = 'media_asset'`.execute(admin())).rows[0]
        ?.n,
    );
    for (const payload of [
      { category: 'selfie' },
      { description: 'x'.repeat(1001) },
      { id: 'nope' },
      { origin: 'web' },
      { createdBy: uuidv7() },
      { fileState: 'clean' },
    ]) {
      expect(await pushOne(phone, media(orderId, payload))).toMatchObject({ outcome: 'rejected', code: 'validation_failed' });
    }
    expect(await assetCount()).toBe(0);
    expect(await fileCount()).toBe(0);
    expect(await auditOf('sync.mutation_applied')).toEqual([]);
    expect(
      Number(
        (await sql<{ n: string }>`select count(*)::text as n from sync.change_log where entity_type = 'media_asset'`.execute(admin()))
          .rows[0]?.n,
      ),
    ).toBe(before);
  });
});

describe('CreateMediaAsset and the order (EVM-131 AC3; SR-AUTHZ-02, SR-SYNC-05, CWE-639)', () => {
  it('EVM-131 AC3 an order that does not exist and an order outside the policy are the same `forbidden`, a deleted order is `target_unavailable` - the codes of a note', async () => {
    const app = await boot();
    const { phone } = await editor(app);
    const deleted = await order({ deletedAt: new Date('2026-11-01T08:00:00Z') });
    expect(await pushOne(phone, media(uuidv7()))).toMatchObject({ outcome: 'rejected', code: 'forbidden' });
    expect(await pushOne(phone, media(deleted))).toMatchObject({ outcome: 'rejected', code: 'target_unavailable' });
    expect(await assetCount()).toBe(0);
  });

  it("EVM-131 AC3 the stage must be a live stage of THIS order: another order's, a deleted and a missing stage are ONE answer, validation_failed", async () => {
    const app = await boot();
    const orderId = await order();
    const otherOrder = await order();
    const { phone } = await editor(app);
    const foreign = (await insertProcedure(admin(), otherOrder)).stageIds[0] ?? '';
    const withDeleted = await insertProcedure(admin(), orderId, { stages: [{ deletedAt: new Date('2026-11-01T08:00:00Z') }] });
    const results = [foreign, withDeleted.stageIds[0] ?? '', uuidv7()].map(async (procedureStageId) =>
      pushOne(phone, media(orderId, { procedureStageId })),
    );
    for (const result of await Promise.all(results)) expect(result).toMatchObject({ outcome: 'rejected', code: 'validation_failed' });
    expect(await assetCount()).toBe(0);
  });

  it('EVM-131 AC3 a closed order accepts media (nothing is lost), like the panel', async () => {
    const app = await boot();
    const closed = await order({ status: 'settled', closedAt: new Date(current.clock.now().getTime() - 3_600_000) });
    const { phone } = await editor(app);
    expect((await pushOne(phone, media(closed))).outcome).toBe('applied');
  });

  it('EVM-131 AC3 capturedAt is metadata: out of range is applied with the warning and stored as no moment, the order of everything is the time of the server', async () => {
    const app = await boot();
    const orderId = await order();
    const { phone } = await editor(app);
    const late = media(orderId, { capturedAt: new Date(current.clock.now().getTime() + 3_600_000).toISOString() });
    expect(await pushOne(phone, late)).toEqual({ mutationId: late.mutationId, outcome: 'applied', warnings: ['captured_at_out_of_range'] });
    const row = await assetRow(mediaIdOf(late));
    expect(row?.['captured_at']).toBeNull();
  });
});

describe('CreateMediaAsset in a batch (EVM-131 AC3; ADR-0008)', () => {
  it('EVM-131 AC3 the medium of an order created by CreateQuickWorkOrder earlier in the SAME batch is applied after it, in the order of the queue', async () => {
    const app = await boot();
    const { phone } = await editor(app);
    const template =
      (await sql<{ id: string }>`select id from catalog.work_order_templates where code = 'garage_full_process'`.execute(admin())).rows[0]
        ?.id ?? '';
    const workOrderId = uuidv7();
    const quick = {
      mutationId: uuidv7(),
      type: 'CreateQuickWorkOrder',
      commandVersion: 1,
      payload: {
        workOrderId,
        templateId: template,
        title: 'Montaż wallboxa u Wymyślonej',
        newCustomer: { id: uuidv7(), kind: 'person', displayName: 'Zofia Wymyślona', phone: '600 000 731' },
        newSite: {
          id: uuidv7(),
          siteType: 'single_family_house',
          street: 'ul. Zmyślona',
          buildingNumber: '12',
          postalCode: '00-950',
          city: 'Fikcyjnowo',
        },
      },
    };
    const first = media(workOrderId, { category: 'site_survey' });
    const second = media(workOrderId, { mediaType: 'video' });
    const response = await push(phone, { mutations: [quick, first, second] });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(resultsOf(response).map((result) => result.outcome)).toEqual(['applied', 'applied', 'applied']);
    expect(await assetCount()).toBe(2);
    // a medium that was in the same batch as its order reaches the phone with the order
    const pulled = await drain(phone);
    expect(upsertOf(pulled.changes, 'media_asset', mediaIdOf(first))).toMatchObject({
      workOrderId,
      category: 'site_survey',
      fileState: 'pending',
      version: 1,
    });
    expect(upsertOf(pulled.changes, 'media_asset', mediaIdOf(second))).toMatchObject({ mediaType: 'video', fileState: 'pending' });
  });

  it('EVM-131 AC3 one bad command does not stop the next ones; the results are in the order of the request', async () => {
    const app = await boot();
    const orderId = await order();
    const { phone } = await editor(app);
    const bad = media(orderId, { category: 'selfie' });
    const good = media(orderId);
    const response = await push(phone, { mutations: [bad, good] });
    expect(resultsOf(response).map((result) => [result.mutationId, result.outcome])).toEqual([
      [bad.mutationId, 'rejected'],
      [good.mutationId, 'applied'],
    ]);
  });

  it('EVM-131 AC3 the metric counts the outcome of the command by the closed label of its type', async () => {
    const app = await boot();
    const orderId = await order();
    const { phone } = await editor(app);
    const mutation = media(orderId);
    await pushOne(phone, mutation);
    expect(counter(app, 'sync_mutation_outcomes_total', { type: 'create_media_asset', outcome: 'applied', code: 'none' })).toBe(1);
  });
});
