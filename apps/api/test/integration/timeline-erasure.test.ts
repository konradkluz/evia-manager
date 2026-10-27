import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DELETION_REGISTER } from '../../src/platform/deletion-register/deletion-register.ts';
import { InMemoryDeletionRegister } from '../../src/platform/deletion-register/in-memory-deletion-register.ts';
import { CLOCK } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { insertEntries } from '../support/timeline-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';

// 2026-10-03 12:00 Europe/Warsaw (CEST): the day of the marker in the story is 03.10.2026
const NOW = '2026-10-03T10:00:00.000Z';
const BASE = '/api/v1/work-orders';
const CANARY = 'CANARY-DOWOD-ABC123456-NIE-DO-LOGOW';
const MARKER = 'Treść usunięta przez administratora 03.10.2026.';

let current: IdentityApp;
let register: InMemoryDeletionRegister;
beforeAll(async () => {
  current = await createIdentityApp({
    now: NOW,
    configure: (builder) =>
      builder.overrideProvider(DELETION_REGISTER).useFactory({
        inject: [CLOCK],
        factory: (clock: IdentityApp['clock']) => {
          register = new InMemoryDeletionRegister(clock);
          return register;
        },
      }),
  });
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  current.clock.set(NOW);
  register.recover();
  register.calls.length = 0;
  register.objects.length = 0;
  register.onRecord = undefined;
  await clearWorkOrderCreation(current.database.admin);
});

const admin = () => current.database.admin;

async function signIn(role: Role, options: { fresh?: boolean; channel?: 'web' | 'mobile' } = {}) {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user, {
    ...(options.channel === undefined ? {} : { channel: options.channel }),
    ...(options.fresh === true ? { passkeyAuthenticatedAt: current.clock.now() } : {}),
  });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}
type Browser = Awaited<ReturnType<typeof signIn>>;

let numbering = 0;
async function order() {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `anna${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [{ number: `ZL-7${String(numbering).padStart(3, '0')}-0001`, customerId, siteId }]);
  return [...ids.values()][0] ?? '';
}

const entryUrl = (orderId: string, entryId: string) => `${BASE}/${orderId}/timeline/${entryId}`;
const tag = (version: number) => `"${version}"`;
const codeOf = (body: unknown) => (body as { code?: string }).code;
interface EntryBody {
  id: string;
  body: string | null;
  redactedAt: string | null;
  deletedAt: string | null;
  author: { id: string } | null;
  createdAt: string;
  supersededByEntryId: string | null;
  supersedesEntryId: string | null;
}
const entryOf = (body: unknown) => body as EntryBody;
const listOf = async (browser: Browser, orderId: string, query = '') =>
  (await browser.panel.get(`${BASE}/${orderId}/timeline${query}`)).body as { items: EntryBody[]; nextCursor: string | null };
const versionOf = async (id: string) =>
  (await sql<{ version: number }>`select version from timeline.timeline_entries where id = ${id}`.execute(admin())).rows[0]?.version;
const rowOf = async (id: string) =>
  (
    await sql<{ body: string | null; version: number; deleted_at: Date | null; redacted_at: Date | null; redacted_by: string | null }>`
    select body, version, deleted_at, redacted_at, redacted_by from timeline.timeline_entries where id = ${id}`.execute(admin())
  ).rows[0];
const auditOf = async (objectId: string) =>
  (
    await sql<{ action: string; outcome: string; actor_user_id: string | null }>`
      select action, outcome, actor_user_id from audit.events where object_id = ${objectId} and action like 'timeline_entry.%' order by occurred_at, id`.execute(
      admin(),
    )
  ).rows;
const auditText = async () =>
  (await sql<{ t: string }>`select coalesce(string_agg(to_jsonb(e)::text, ' '), '') as t from audit.events e`.execute(admin())).rows[0]
    ?.t ?? '';

async function seed() {
  const administrator = await signIn('administrator', { fresh: true });
  const orderId = await order();
  const [noteId, otherId] = await insertEntries(admin(), orderId, administrator.userId, [
    { body: `Numer dowodu ${CANARY}`, noteCategory: 'phone_call' },
    { body: 'Inny wpis.' },
  ]);
  return { administrator, orderId, noteId: noteId ?? '', otherId: otherId ?? '' };
}

describe('EVM-040 AC1 - the deletion and the restoration of an entry (SR-PRIV-03)', () => {
  it('EVM-040 AC1 the Administrator deletes an entry: the Editor and Read-only no longer see it (404, not on the list), the Administrator sees it with deletedAt, the restoration brings it back; both are audited', async () => {
    const { administrator, orderId, noteId, otherId } = await seed();
    const editor = await signIn('editor');
    const readOnly = await signIn('read_only');

    const deleted = await administrator.panel.delete(entryUrl(orderId, noteId), { 'If-Match': tag(1) });
    expect(deleted.status).toBe(204);
    expect(await versionOf(noteId)).toBe(2);

    for (const viewer of [editor, readOnly]) {
      expect((await viewer.panel.get(entryUrl(orderId, noteId))).status).toBe(404);
      expect((await listOf(viewer, orderId)).items.map((item) => item.id)).toEqual([otherId]);
    }
    expect((await listOf(administrator, orderId)).items.map((item) => item.id)).toEqual([otherId]);
    const withDeleted = await listOf(administrator, orderId, '?includeDeleted=true');
    expect(withDeleted.items.map((item) => item.id)).toEqual([otherId, noteId]);
    expect(withDeleted.items.find((item) => item.id === noteId)?.deletedAt).toBe(NOW);
    expect(withDeleted.items.find((item) => item.id === otherId)?.deletedAt).toBeNull();

    const read = await administrator.panel.get(entryUrl(orderId, noteId));
    expect(read.status).toBe(200);
    expect(entryOf(read.body).deletedAt).toBe(NOW);
    expect(read.headers['etag']).toBe(tag(2));

    const restored = await administrator.panel.post(`${entryUrl(orderId, noteId)}/restore`, undefined, { 'If-Match': tag(2) });
    expect(restored.status).toBe(200);
    expect(entryOf(restored.body).deletedAt).toBeNull();
    expect(restored.headers['etag']).toBe(tag(3));
    expect((await editor.panel.get(entryUrl(orderId, noteId))).status).toBe(200);
    expect((await listOf(editor, orderId)).items.map((item) => item.id)).toEqual([otherId, noteId]);

    expect(await auditOf(noteId)).toEqual([
      { action: 'timeline_entry.deleted', outcome: 'success', actor_user_id: administrator.userId },
      { action: 'timeline_entry.restored', outcome: 'success', actor_user_id: administrator.userId },
    ]);
  });

  it('EVM-040 AC1 If-Match: missing is 428, malformed 400, a stale version 412 (no change); a repeat with the same Idempotency-Key is 204 with the replay header and ONE audit record', async () => {
    const { administrator, orderId, noteId } = await seed();
    expect(codeOf((await administrator.panel.delete(entryUrl(orderId, noteId))).body)).toBe('precondition_required');
    expect((await administrator.panel.delete(entryUrl(orderId, noteId), { 'If-Match': 'W/"1"' })).status).toBe(400);
    const stale = await administrator.panel.delete(entryUrl(orderId, noteId), { 'If-Match': tag(7) });
    expect([stale.status, codeOf(stale.body)]).toEqual([412, 'version_conflict']);
    expect(await versionOf(noteId)).toBe(1);

    const key = uuidv7();
    const first = await administrator.panel.delete(entryUrl(orderId, noteId), { 'If-Match': tag(1), 'Idempotency-Key': key });
    const again = await administrator.panel.delete(entryUrl(orderId, noteId), { 'If-Match': tag(1), 'Idempotency-Key': key });
    expect([first.status, again.status]).toEqual([204, 204]);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(await versionOf(noteId)).toBe(2);
    expect((await auditOf(noteId)).map((row) => row.action)).toEqual(['timeline_entry.deleted']);
    // without the key a second deletion is a 404: the entry is gone for this command
    expect((await administrator.panel.delete(entryUrl(orderId, noteId), { 'If-Match': tag(2) })).status).toBe(404);
  });

  it('EVM-040 AC1 the restoration of a live entry is 404, a stale version is 412, a repeat with the same key is 200 with the replay header', async () => {
    const { administrator, orderId, noteId } = await seed();
    expect((await administrator.panel.post(`${entryUrl(orderId, noteId)}/restore`, undefined, { 'If-Match': tag(1) })).status).toBe(404);
    await administrator.panel.delete(entryUrl(orderId, noteId), { 'If-Match': tag(1) });
    expect((await administrator.panel.post(`${entryUrl(orderId, noteId)}/restore`, undefined, { 'If-Match': tag(1) })).status).toBe(412);
    expect(codeOf((await administrator.panel.post(`${entryUrl(orderId, noteId)}/restore`)).body)).toBe('precondition_required');
    const key = uuidv7();
    const first = await administrator.panel.post(`${entryUrl(orderId, noteId)}/restore`, undefined, {
      'If-Match': tag(2),
      'Idempotency-Key': key,
    });
    const again = await administrator.panel.post(`${entryUrl(orderId, noteId)}/restore`, undefined, {
      'If-Match': tag(2),
      'Idempotency-Key': key,
    });
    expect([first.status, again.status]).toEqual([200, 200]);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(await versionOf(noteId)).toBe(3);
  });

  it('EVM-040 AC1 includeDeleted: 403 for the Editor and Read-only (not ignored), 400 for a value outside true/false, and the cursor is bound to the filter', async () => {
    const { administrator, orderId } = await seed();
    await insertEntries(admin(), orderId, administrator.userId, [{}, {}]);
    for (const role of ['editor', 'read_only'] as const) {
      const viewer = await signIn(role);
      const response = await viewer.panel.get(`${BASE}/${orderId}/timeline?includeDeleted=true`);
      expect([response.status, codeOf(response.body)]).toEqual([403, 'forbidden']);
      expect((await viewer.panel.get(`${BASE}/${orderId}/timeline?includeDeleted=false`)).status).toBe(200);
    }
    expect((await administrator.panel.get(`${BASE}/${orderId}/timeline?includeDeleted=maybe`)).status).toBe(400);
    const page = await listOf(administrator, orderId, '?includeDeleted=true&limit=1');
    expect(page.nextCursor).not.toBeNull();
    const other = await administrator.panel.get(`${BASE}/${orderId}/timeline?limit=1&cursor=${page.nextCursor}`);
    expect([other.status, codeOf(other.body)]).toEqual([400, 'invalid_cursor']);
    const same = await administrator.panel.get(`${BASE}/${orderId}/timeline?includeDeleted=true&limit=1&cursor=${page.nextCursor}`);
    expect(same.status).toBe(200);
  });

  it('EVM-040 decision: a deleted correction does not count as the correction of the original; the original cannot be corrected again until it returns', async () => {
    const { administrator, orderId, noteId } = await seed();
    const correctionId = uuidv7();
    const created = await administrator.panel.post(
      `${BASE}/${orderId}/timeline`,
      { id: correctionId, kind: 'note', noteCategory: 'phone_call', body: 'Poprawka.', supersedesEntryId: noteId },
      { 'Idempotency-Key': uuidv7() },
    );
    expect(created.status).toBe(201);
    expect(entryOf((await administrator.panel.get(entryUrl(orderId, noteId))).body).supersededByEntryId).toBe(correctionId);
    await administrator.panel.delete(entryUrl(orderId, correctionId), { 'If-Match': tag(1) });
    expect(entryOf((await administrator.panel.get(entryUrl(orderId, noteId))).body).supersededByEntryId).toBeNull();
    const again = await administrator.panel.post(
      `${BASE}/${orderId}/timeline`,
      { id: uuidv7(), kind: 'note', noteCategory: 'phone_call', body: 'Druga poprawka.', supersedesEntryId: noteId },
      { 'Idempotency-Key': uuidv7() },
    );
    expect([again.status, codeOf(again.body)]).toEqual([409, 'entry_superseded']);
    await administrator.panel.post(`${entryUrl(orderId, correctionId)}/restore`, undefined, { 'If-Match': tag(2) });
    expect(entryOf((await administrator.panel.get(entryUrl(orderId, noteId))).body).supersededByEntryId).toBe(correctionId);
  });
});

describe('EVM-040 AC2 - the redaction of the text (SR-PRIV-03, SR-SESS-08)', () => {
  it('EVM-040 AC2 the text becomes the marker with the day in Europe/Warsaw; the time and the author of the redaction are kept; the metadata and the place on the line stay', async () => {
    const { administrator, orderId, noteId, otherId } = await seed();
    const before = entryOf((await administrator.panel.get(entryUrl(orderId, noteId))).body);
    const listBefore = (await listOf(administrator, orderId)).items.map((item) => item.id);
    const response = await administrator.panel.post(`${entryUrl(orderId, noteId)}/redact`, undefined, { 'If-Match': tag(1) });
    expect(response.status).toBe(200);
    const after = entryOf(response.body);
    expect(after.body).toBe(MARKER);
    expect(after.redactedAt).toBe(NOW);
    expect(response.headers['etag']).toBe(tag(2));
    expect({ ...after, body: null, redactedAt: null }).toEqual({ ...before, body: null, redactedAt: null });
    expect((await listOf(administrator, orderId)).items.map((item) => item.id)).toEqual(listBefore);
    expect(listBefore).toContain(otherId);
    expect(await rowOf(noteId)).toMatchObject({ body: MARKER, version: 2, redacted_by: administrator.userId });
    expect((await rowOf(noteId))?.redacted_at?.toISOString()).toBe(NOW);
    expect((await auditOf(noteId)).map((row) => `${row.action}:${row.outcome}`)).toEqual(['timeline_entry.redacted:success']);
  });

  it('EVM-040 AC2 the day of the marker is the day in Warsaw, not in UTC (22:30 UTC on 03.10 is 00:30 on 04.10)', async () => {
    current.clock.set('2026-10-03T22:30:00.000Z');
    const { administrator, orderId, noteId } = await seed();
    const response = await administrator.panel.post(`${entryUrl(orderId, noteId)}/redact`, undefined, { 'If-Match': tag(1) });
    expect(entryOf(response.body).body).toBe('Treść usunięta przez administratora 04.10.2026.');
  });

  it('EVM-040 AC2 SR-SESS-08 without a passkey authentication in the last 15 minutes the redaction is 403 step_up_required: nothing is written to the register, the text is untouched', async () => {
    const { orderId, noteId } = await seed();
    const stale = await signIn('administrator');
    const response = await stale.panel.post(`${entryUrl(orderId, noteId)}/redact`, undefined, { 'If-Match': tag(1) });
    expect([response.status, codeOf(response.body)]).toEqual([403, 'step_up_required']);
    expect(register.calls).toHaveLength(0);
    expect(await rowOf(noteId)).toMatchObject({ version: 1, redacted_at: null });
    expect((await rowOf(noteId))?.body).toContain(CANARY);
    // 16 minutes after the key was used, the window is closed
    const fresh = await signIn('administrator', { fresh: true });
    current.clock.advance(16 * 60_000);
    expect(codeOf((await fresh.panel.post(`${entryUrl(orderId, noteId)}/redact`, undefined, { 'If-Match': tag(1) })).body)).toBe(
      'step_up_required',
    );
  });

  it('EVM-040 AC2 a deleted entry can be redacted (its text is still in the database); the redacted entry can be deleted and restored and the marker stays', async () => {
    const { administrator, orderId, noteId } = await seed();
    await administrator.panel.delete(entryUrl(orderId, noteId), { 'If-Match': tag(1) });
    const redacted = await administrator.panel.post(`${entryUrl(orderId, noteId)}/redact`, undefined, { 'If-Match': tag(2) });
    expect(redacted.status).toBe(200);
    expect(entryOf(redacted.body)).toMatchObject({ body: MARKER, deletedAt: NOW });
    const restored = await administrator.panel.post(`${entryUrl(orderId, noteId)}/restore`, undefined, { 'If-Match': tag(3) });
    expect(entryOf(restored.body)).toMatchObject({ body: MARKER, deletedAt: null });
    expect((await administrator.panel.delete(entryUrl(orderId, noteId), { 'If-Match': tag(4) })).status).toBe(204);
    expect(register.objects).toHaveLength(1);
  });

  it('EVM-040 AC2 a second redaction is 409 already_redacted with no second object in the register; a stale version is 412 first; the original of a correction keeps its text', async () => {
    const { administrator, orderId, noteId } = await seed();
    const correctionId = uuidv7();
    await administrator.panel.post(
      `${BASE}/${orderId}/timeline`,
      { id: correctionId, kind: 'note', noteCategory: 'phone_call', body: 'Poprawka treści.', supersedesEntryId: noteId },
      { 'Idempotency-Key': uuidv7() },
    );
    await administrator.panel.post(`${entryUrl(orderId, correctionId)}/redact`, undefined, { 'If-Match': tag(1) });
    expect((await rowOf(noteId))?.body).toContain(CANARY);
    expect(register.objects).toHaveLength(1);
    const again = await administrator.panel.post(`${entryUrl(orderId, correctionId)}/redact`, undefined, { 'If-Match': tag(2) });
    expect([again.status, codeOf(again.body)]).toEqual([409, 'already_redacted']);
    const stale = await administrator.panel.post(`${entryUrl(orderId, correctionId)}/redact`, undefined, { 'If-Match': tag(1) });
    expect([stale.status, codeOf(stale.body)]).toEqual([412, 'version_conflict']);
    expect(register.objects).toHaveLength(1);
    expect(codeOf((await administrator.panel.post(`${entryUrl(orderId, correctionId)}/redact`)).body)).toBe('precondition_required');
  });
});

describe('EVM-040 AC3 - the register of deletions before the change (SR-PRIV-04, SR-ERR-01)', () => {
  it('EVM-040 AC3 the object is written BEFORE the change in the database and holds identifiers, the code, the actor and the time - no text', async () => {
    const { administrator, orderId, noteId } = await seed();
    // a sequence is not transactional: the step of the register (committed at once) and the step of the UPDATE (logged by a trigger inside the
    // transaction of the redaction) are numbered in the order they HAPPENED, whatever the order of the commits
    await sql`create table public.erasure_order_log (step text not null, n bigint not null)`.execute(admin());
    await sql`create sequence public.erasure_order_seq`.execute(admin());
    await sql`create function public.erasure_log_update() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
      begin insert into public.erasure_order_log values ('update', nextval('public.erasure_order_seq')); return new; end $$`.execute(
      admin(),
    );
    await sql`create trigger erasure_log_update after update on timeline.timeline_entries for each row execute function public.erasure_log_update()`.execute(
      admin(),
    );
    register.onRecord = async () => {
      await sql`insert into public.erasure_order_log values ('register', nextval('public.erasure_order_seq'))`.execute(admin());
    };
    let steps: string[];
    try {
      const response = await administrator.panel.post(`${entryUrl(orderId, noteId)}/redact`, undefined, { 'If-Match': tag(1) });
      expect(response.status).toBe(200);
      steps = (await sql<{ step: string }>`select step from public.erasure_order_log order by n`.execute(admin())).rows.map(
        (row) => row.step,
      );
    } finally {
      await sql`drop trigger erasure_log_update on timeline.timeline_entries`.execute(admin());
      await sql`drop function public.erasure_log_update()`.execute(admin());
      await sql`drop table public.erasure_order_log`.execute(admin());
      await sql`drop sequence public.erasure_order_seq`.execute(admin());
    }
    expect(steps).toEqual(['register', 'update']);
    expect(register.objects).toHaveLength(1);
    const object = JSON.parse(register.objects[0]?.body ?? '{}') as Record<string, unknown>;
    expect(object).toEqual({
      schemaVersion: 1,
      operationId: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      operationCode: 'timeline_entry_redacted',
      subjectType: 'timeline_entry',
      subjectId: noteId,
      workOrderId: orderId,
      actorUserId: administrator.userId,
      occurredAt: NOW,
    });
    expect(register.objects[0]?.key).toBe(`2026/${String(object['operationId'])}.json`);
    expect(register.objects[0]?.body).not.toContain(CANARY);
  });

  it('EVM-040 AC3 when the register cannot be written the redaction does not start: 503, the text and the version are untouched, the audit says "failed" and there is no audit of a success', async () => {
    const { administrator, orderId, noteId } = await seed();
    register.failAll();
    const response = await administrator.panel.post(`${entryUrl(orderId, noteId)}/redact`, undefined, { 'If-Match': tag(1) });
    expect([response.status, codeOf(response.body)]).toEqual([503, 'deletion_register_unavailable']);
    expect(JSON.stringify(response.body)).not.toContain(CANARY);
    expect(await rowOf(noteId)).toMatchObject({ version: 1, redacted_at: null, redacted_by: null });
    expect((await rowOf(noteId))?.body).toContain(CANARY);
    expect(register.objects).toHaveLength(0);
    expect((await auditOf(noteId)).map((row) => `${row.action}:${row.outcome}`)).toEqual(['timeline_entry.redacted:failed']);
    // the register recovers: the same request now succeeds (nothing was left half done)
    register.recover();
    const retried = await administrator.panel.post(`${entryUrl(orderId, noteId)}/redact`, undefined, { 'If-Match': tag(1) });
    expect(retried.status).toBe(200);
    expect(register.objects).toHaveLength(1);
  });

  it('EVM-040 AC3 a request that ends in 404, 409 or 412 leaves no object in the register', async () => {
    const { administrator, orderId, noteId } = await seed();
    const event = (await insertEntries(admin(), orderId, administrator.userId, [{ kind: 'event' }]))[0] ?? '';
    const foreignOrder = await order();
    const foreign = (await insertEntries(admin(), foreignOrder, administrator.userId, [{}]))[0] ?? '';
    const calls = [
      administrator.panel.post(`${entryUrl(orderId, uuidv7())}/redact`, undefined, { 'If-Match': tag(1) }),
      administrator.panel.post(`${entryUrl(orderId, foreign)}/redact`, undefined, { 'If-Match': tag(1) }),
      administrator.panel.post(`${entryUrl(orderId, event)}/redact`, undefined, { 'If-Match': tag(1) }),
      administrator.panel.post(`${entryUrl(orderId, noteId)}/redact`, undefined, { 'If-Match': tag(5) }),
      administrator.panel.post(`${entryUrl(orderId, noteId)}/redact`),
    ];
    expect((await Promise.all(calls)).map((response) => response.status)).toEqual([404, 404, 409, 412, 428]);
    expect(register.calls).toHaveLength(0);
    expect(await auditOf(noteId)).toEqual([]);
  });

  it('EVM-040 AC3 fail closed: an installation without the register answers 503 to the redaction while the service stays healthy and the other operations work', async () => {
    const bare = await createIdentityApp({ now: NOW });
    try {
      const user = await createUser(bare.database.admin, bare.clock, { role: 'administrator' });
      const session = await createSession(bare.database.admin, bare.clock, user, { passkeyAuthenticatedAt: bare.clock.now() });
      const panel = new PanelClient(bare.app.getHttpServer(), PANEL_ORIGIN);
      panel.cookie = session.cookie;
      panel.csrfToken = session.csrfToken;
      const customerId = await insertCustomer(bare.database.admin, { email: 'anna@example.invalid' });
      const siteId = await insertSite(bare.database.admin);
      const orderId =
        [...(await insertWorkOrders(bare.database.admin, [{ number: 'ZL-7900-0001', customerId, siteId }])).values()][0] ?? '';
      const [entryId] = await insertEntries(bare.database.admin, orderId, user.id, [{ body: CANARY }]);
      const response = await panel.post(`${entryUrl(orderId, entryId ?? '')}/redact`, undefined, { 'If-Match': tag(1) });
      expect([response.status, codeOf(response.body)]).toEqual([503, 'deletion_register_unavailable']);
      expect((await panel.delete(entryUrl(orderId, entryId ?? ''), { 'If-Match': tag(1) })).status).toBe(204);
      expect((await request(bare.app.getHttpServer()).get('/api/health')).status).toBe(200);
    } finally {
      await bare.close();
    }
  });
});

describe('EVM-040 AC4 - the audit trail, the logs and the register carry no text (SR-LOG-03, SR-DATA-08)', () => {
  it('EVM-040 AC4 the text of the entry is nowhere but in the entry: not in the audit trail, the logs, the register, the problems or the answer of a redaction', async () => {
    const { administrator, orderId, noteId } = await seed();
    const responses = [
      await administrator.panel.delete(entryUrl(orderId, noteId), { 'If-Match': tag(1) }),
      await administrator.panel.post(`${entryUrl(orderId, noteId)}/restore`, undefined, { 'If-Match': tag(2) }),
      await administrator.panel.post(`${entryUrl(orderId, noteId)}/redact`, undefined, { 'If-Match': tag(1) }),
      await administrator.panel.post(`${entryUrl(orderId, noteId)}/redact`, undefined, { 'If-Match': tag(3) }),
    ];
    register.failAll();
    const other = (await insertEntries(admin(), orderId, administrator.userId, [{ body: CANARY }]))[0] ?? '';
    responses.push(await administrator.panel.post(`${entryUrl(orderId, other)}/redact`, undefined, { 'If-Match': tag(1) }));
    expect(responses.map((response) => response.status)).toEqual([204, 200, 412, 200, 503]);
    // the answers that must not carry the text: the redaction, the refusals; the restoration returns the entry to the Administrator as it was
    expect(JSON.stringify(responses.filter((_, index) => index !== 1).map((response) => response.body as unknown))).not.toContain(CANARY);
    expect(await auditText()).not.toContain(CANARY);
    expect(current.logs.text).not.toContain(CANARY);
    expect(JSON.stringify(register.objects)).not.toContain(CANARY);
    // the audit of every operation: the entry, the action, the outcome, the actor, the trace
    const rows = await sql<{ action: string; outcome: string; trace_id: string; object_type: string }>`
      select action, outcome, trace_id, object_type from audit.events where object_id in (${noteId}, ${other}) and action like 'timeline_entry.%' order by occurred_at, id`.execute(
      admin(),
    );
    expect(rows.rows.map((row) => `${row.action}:${row.outcome}`)).toEqual([
      'timeline_entry.deleted:success',
      'timeline_entry.restored:success',
      'timeline_entry.redacted:success',
      'timeline_entry.redacted:failed',
    ]);
    expect(rows.rows.every((row) => /^[0-9a-f]{32}$/.test(row.trace_id) && row.object_type === 'timeline_entry')).toBe(true);
  });
});

describe('EVM-040 AC5 - automatic events cannot be deleted nor redacted', () => {
  it('EVM-040 AC5 the API refuses an event with 409 entry_is_event on both operations; the register is not asked; the event is unchanged', async () => {
    const { administrator, orderId } = await seed();
    const event = (await insertEntries(admin(), orderId, administrator.userId, [{ kind: 'event' }]))[0] ?? '';
    const removed = await administrator.panel.delete(entryUrl(orderId, event), { 'If-Match': tag(1) });
    const redacted = await administrator.panel.post(`${entryUrl(orderId, event)}/redact`, undefined, { 'If-Match': tag(1) });
    expect([removed.status, codeOf(removed.body)]).toEqual([409, 'entry_is_event']);
    expect([redacted.status, codeOf(redacted.body)]).toEqual([409, 'entry_is_event']);
    expect(register.calls).toHaveLength(0);
    expect(await rowOf(event)).toMatchObject({ version: 1, deleted_at: null, redacted_at: null });
  });
});

describe('EVM-040 AC6 - who may erase, and whose entry (SR-AUTHZ-02, SR-AUTHZ-05, TM-17)', () => {
  it('EVM-040 AC6 the Editor and Read-only get 403 forbidden on the three operations (before If-Match and before any lookup), an anonymous caller 401, a mobile token 403; nothing changes', async () => {
    const { orderId, noteId } = await seed();
    const calls = (browser: Browser, entry: string) => [
      browser.panel.delete(entryUrl(orderId, entry), { 'If-Match': tag(1) }),
      browser.panel.post(`${entryUrl(orderId, entry)}/restore`, undefined, { 'If-Match': tag(1) }),
      browser.panel.post(`${entryUrl(orderId, entry)}/redact`, undefined, { 'If-Match': tag(1) }),
    ];
    for (const role of ['editor', 'read_only'] as const) {
      const browser = await signIn(role, { fresh: true });
      for (const entry of [noteId, uuidv7()]) {
        const answers = await Promise.all(calls(browser, entry));
        expect(answers.map((response) => [response.status, codeOf(response.body)])).toEqual([
          [403, 'forbidden'],
          [403, 'forbidden'],
          [403, 'forbidden'],
        ]);
      }
    }
    const mobile = await signIn('administrator', { fresh: true, channel: 'mobile' });
    expect((await Promise.all(calls(mobile, noteId))).map((response) => response.status)).toEqual([403, 403, 403]);
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    expect((await Promise.all(calls({ userId: '', panel: anonymous }, noteId))).map((response) => response.status)).toEqual([
      401, 401, 401,
    ]);
    expect(await rowOf(noteId)).toMatchObject({ version: 1, deleted_at: null, redacted_at: null });
    expect(register.calls).toHaveLength(0);
  });

  it('EVM-040 AC6 an entry of order B under the path of order A is the same 404 as a missing entry on all three operations, and the entry of B does not change', async () => {
    const { administrator, orderId } = await seed();
    const otherOrder = await order();
    const [foreign] = await insertEntries(admin(), otherOrder, administrator.userId, [{ body: CANARY }]);
    const deletedForeign = (await insertEntries(admin(), otherOrder, administrator.userId, [{ deletedAt: NOW }]))[0] ?? '';
    const attempts = async (entry: string, version: number) =>
      (
        await Promise.all([
          administrator.panel.delete(entryUrl(orderId, entry), { 'If-Match': tag(version) }),
          administrator.panel.post(`${entryUrl(orderId, entry)}/restore`, undefined, { 'If-Match': tag(version) }),
          administrator.panel.post(`${entryUrl(orderId, entry)}/redact`, undefined, { 'If-Match': tag(version) }),
        ])
      ).map((response) => [response.status, codeOf(response.body)]);
    const missing = await attempts(uuidv7(), 1);
    expect(missing).toEqual([
      [404, 'not_found'],
      [404, 'not_found'],
      [404, 'not_found'],
    ]);
    expect(await attempts(foreign ?? '', 1)).toEqual(missing);
    expect(await attempts(deletedForeign, 1)).toEqual(missing);
    expect(await rowOf(foreign ?? '')).toMatchObject({ version: 1, deleted_at: null, redacted_at: null });
    expect(register.calls).toHaveLength(0);
  });

  it('EVM-040 AC6 the order of the path decides: a deleted order and a missing order are 404 on all three operations, for the Administrator too', async () => {
    const administrator = await signIn('administrator', { fresh: true });
    numbering += 1;
    const customerId = await insertCustomer(admin(), { email: `anna${numbering}@example.invalid` });
    const siteId = await insertSite(admin());
    const [orderId = ''] = [
      ...(
        await insertWorkOrders(admin(), [
          { number: `ZL-7${String(numbering).padStart(3, '0')}-0001`, customerId, siteId, deletedAt: new Date(NOW) },
        ])
      ).values(),
    ];
    const [entry] = await insertEntries(admin(), orderId, administrator.userId, [{}]);
    const answers = await Promise.all([
      administrator.panel.delete(entryUrl(orderId, entry ?? ''), { 'If-Match': tag(1) }),
      administrator.panel.post(`${entryUrl(uuidv7(), entry ?? '')}/restore`, undefined, { 'If-Match': tag(1) }),
      administrator.panel.post(`${entryUrl(orderId, entry ?? '')}/redact`, undefined, { 'If-Match': tag(1) }),
    ]);
    expect(answers.map((response) => response.status)).toEqual([404, 404, 404]);
  });
});

describe('EVM-040 AC7 - 412 asks for a refresh', () => {
  it('EVM-040 AC7 a version that changed in the meantime is 412 version_conflict on the three operations - and the answer names no current value', async () => {
    const { administrator, orderId, noteId } = await seed();
    await administrator.panel.delete(entryUrl(orderId, noteId), { 'If-Match': tag(1) });
    const stale = await Promise.all([
      administrator.panel.delete(entryUrl(orderId, noteId), { 'If-Match': tag(1) }),
      administrator.panel.post(`${entryUrl(orderId, noteId)}/restore`, undefined, { 'If-Match': tag(1) }),
      administrator.panel.post(`${entryUrl(orderId, noteId)}/redact`, undefined, { 'If-Match': tag(1) }),
    ]);
    expect(stale.map((response) => response.status)).toEqual([404, 412, 412]);
    expect(codeOf(stale[2].body)).toBe('version_conflict');
    expect(JSON.stringify(stale[2].body)).not.toMatch(/"?version"?\s*:\s*\d/);
  });
});

afterEach(() => {
  register.recover();
});
