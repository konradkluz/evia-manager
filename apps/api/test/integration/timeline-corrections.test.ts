import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertProcedure } from '../support/procedure-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { insertEntries } from '../support/timeline-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';

const NOW = '2026-10-11T08:00:00.000Z';
const BASE = '/api/v1/work-orders';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp();
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  current.clock.set(NOW);
  await clearWorkOrderCreation(current.database.admin);
});

const admin = () => current.database.admin;

async function signIn(role: Role = 'editor') {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user);
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel, session };
}
type Browser = Awaited<ReturnType<typeof signIn>>;

let numbering = 0;
async function order() {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `jan${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [{ number: `ZL-6${String(numbering).padStart(3, '0')}-0001`, customerId, siteId }]);
  const id = [...ids.values()][0] ?? '';
  const process = await insertProcedure(admin(), id, { stages: [{}, {}] });
  return { id, stageIds: process.stageIds };
}

const post = (browser: Browser, orderId: string, body: Record<string, unknown>, key: string = uuidv7()) =>
  browser.panel.post(`${BASE}/${orderId}/timeline`, { id: uuidv7(), ...body }, { 'Idempotency-Key': key });
const codeOf = (body: unknown) => (body as { code?: string }).code;
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;
interface EntryBody {
  id: string;
  kind: string;
  noteCategory: string | null;
  body: string | null;
  procedureStageId: string | null;
  author: { id: string; displayName: string } | null;
  supersedesEntryId: string | null;
  supersededByEntryId: string | null;
}
const entryOf = (body: unknown) => body as EntryBody;
const bodyOf = async (id: string) =>
  (await sql<{ body: string | null }>`select body from timeline.timeline_entries where id = ${id}`.execute(admin())).rows[0]?.body;
const countOf = async (orderId: string) =>
  Number(
    (await sql<{ n: string }>`select count(*)::text as n from timeline.timeline_entries where work_order_id = ${orderId}`.execute(admin()))
      .rows[0]?.n,
  );

describe('EVM-037 AC3 — a correction instead of an edit (D3; SR-AUTHZ-04)', () => {
  it('EVM-037 AC3 a correction is a NEW entry; the old one keeps its text and points at it, the new one points back', async () => {
    const editor = await signIn('editor');
    const { id: orderId } = await order();
    const original = entryOf((await post(editor, orderId, { kind: 'note', noteCategory: 'meeting', body: 'Spotkanie w piątek.' })).body);
    current.clock.advance(60_000);
    const response = await post(editor, orderId, {
      kind: 'note',
      noteCategory: 'meeting',
      body: 'Spotkanie w poniedziałek.',
      supersedesEntryId: original.id,
    });
    expect(response.status).toBe(201);
    const correction = entryOf(response.body);
    expect(correction).toMatchObject({
      kind: 'note',
      noteCategory: 'meeting',
      body: 'Spotkanie w poniedziałek.',
      supersedesEntryId: original.id,
    });
    expect(correction.supersededByEntryId).toBeNull();
    expect(await bodyOf(original.id)).toBe('Spotkanie w piątek.');

    const read = entryOf((await editor.panel.get(`${BASE}/${orderId}/timeline/${original.id}`)).body);
    expect(read).toMatchObject({ body: 'Spotkanie w piątek.', supersededByEntryId: correction.id });
    const list = (await editor.panel.get(`${BASE}/${orderId}/timeline`)).body as { items: EntryBody[] };
    expect(list.items.map((item) => item.id)).toEqual([correction.id, original.id]);
    expect(list.items[1]?.supersededByEntryId).toBe(correction.id);
  });

  it('EVM-037 K9 another Editor or the Administrator may correct the entry; the author of the correction is visible and the original keeps its author', async () => {
    const author = await signIn('editor');
    const other = await signIn('editor');
    const administrator = await signIn('administrator');
    const { id: orderId } = await order();
    const original = entryOf((await post(author, orderId, { kind: 'comment', body: 'Pierwszy komentarz.' })).body);
    const second = entryOf(
      (await post(other, orderId, { kind: 'comment', body: 'Poprawiony komentarz.', supersedesEntryId: original.id })).body,
    );
    const third = entryOf(
      (await post(administrator, orderId, { kind: 'comment', body: 'Poprawka poprawki.', supersedesEntryId: second.id })).body,
    );
    expect(second.author?.id).toBe(other.userId);
    expect(third.author?.id).toBe(administrator.userId);
    const read = entryOf((await author.panel.get(`${BASE}/${orderId}/timeline/${original.id}`)).body);
    expect(read.author?.id).toBe(author.userId);
    // the chain: original <- second <- third; each entry corrected once
    const list = (await author.panel.get(`${BASE}/${orderId}/timeline`)).body as { items: EntryBody[] };
    expect(list.items.map((item) => [item.id, item.supersededByEntryId])).toEqual([
      [third.id, null],
      [second.id, third.id],
      [original.id, second.id],
    ]);
  });

  it('EVM-037 AC3 the correction keeps the stage of the original unless the request says another one; null clears it', async () => {
    const editor = await signIn('editor');
    const { id: orderId, stageIds } = await order();
    const original = entryOf(
      (await post(editor, orderId, { kind: 'note', noteCategory: 'other', body: 'Z etapem.', procedureStageId: stageIds[0] })).body,
    );
    const kept = entryOf(
      (await post(editor, orderId, { kind: 'note', noteCategory: 'other', body: 'Poprawka.', supersedesEntryId: original.id })).body,
    );
    expect(kept.procedureStageId).toBe(stageIds[0]);
    const moved = entryOf(
      (
        await post(editor, orderId, {
          kind: 'note',
          noteCategory: 'other',
          body: 'Inny etap.',
          supersedesEntryId: kept.id,
          procedureStageId: stageIds[1],
        })
      ).body,
    );
    expect(moved.procedureStageId).toBe(stageIds[1]);
    const cleared = entryOf(
      (
        await post(editor, orderId, {
          kind: 'note',
          noteCategory: 'other',
          body: 'Bez etapu.',
          supersedesEntryId: moved.id,
          procedureStageId: null,
        })
      ).body,
    );
    expect(cleared.procedureStageId).toBeNull();
  });

  it('EVM-037 K9 an entry that has a correction is 409 entry_superseded — the second correction is refused and writes nothing', async () => {
    const editor = await signIn('editor');
    const { id: orderId } = await order();
    const original = entryOf((await post(editor, orderId, { kind: 'comment', body: 'Komentarz.' })).body);
    expect((await post(editor, orderId, { kind: 'comment', body: 'Poprawka 1.', supersedesEntryId: original.id })).status).toBe(201);
    const refused = await post(editor, orderId, { kind: 'comment', body: 'Poprawka 2 POUFNA.', supersedesEntryId: original.id });
    expect(refused.status).toBe(409);
    expect(codeOf(refused.body)).toBe('entry_superseded');
    expect(JSON.stringify(refused.body)).not.toContain('POUFNA');
    expect(await countOf(orderId)).toBe(2);
  });

  it('EVM-037 K9 a correction that was soft deleted still holds the key of the database: the next correction is the mapped 409 entry_superseded, never a 500', async () => {
    const editor = await signIn('editor');
    const { id: orderId } = await order();
    const original = entryOf((await post(editor, orderId, { kind: 'comment', body: 'Komentarz.' })).body);
    const first = entryOf((await post(editor, orderId, { kind: 'comment', body: 'Poprawka.', supersedesEntryId: original.id })).body);
    // the soft delete (EVM-040) is the one change the trigger lets through; the pre-check does not see a deleted correction, the key does
    await sql`update timeline.timeline_entries set deleted_at = ${new Date(NOW)}, deleted_by = ${editor.userId} where id = ${first.id}`.execute(
      admin(),
    );
    const refused = await post(editor, orderId, { kind: 'comment', body: 'Druga poprawka.', supersedesEntryId: original.id });
    expect(refused.status).toBe(409);
    expect(codeOf(refused.body)).toBe('entry_superseded');
    expect(JSON.stringify(refused.body)).not.toContain('timeline_entries');
    expect(await countOf(orderId)).toBe(2);
  });

  it('EVM-037 K9 two corrections of the same entry at once: one 201 and one 409 entry_superseded — never a 500 with the name of a constraint', async () => {
    const editor = await signIn('editor');
    const { id: orderId } = await order();
    const original = entryOf((await post(editor, orderId, { kind: 'comment', body: 'Komentarz.' })).body);
    const responses = await Promise.all(
      [1, 2, 3, 4].map((n) => post(editor, orderId, { kind: 'comment', body: `Poprawka ${n}.`, supersedesEntryId: original.id })),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409, 409, 409]);
    for (const refused of responses.filter((response) => response.status === 409)) {
      expect(codeOf(refused.body)).toBe('entry_superseded');
      expect(JSON.stringify(refused.body)).not.toContain('timeline_entries');
    }
    expect(await countOf(orderId)).toBe(2);
  });

  it('EVM-037 AC7 K9 the corrected entry of another order, a missing one, a deleted one and an event are ONE answer: 400 at /supersedesEntryId', async () => {
    const editor = await signIn('editor');
    const orderA = await order();
    const orderB = await order();
    const [foreign] = await insertEntries(admin(), orderB.id, editor.userId, [{}]);
    const [deleted] = await insertEntries(admin(), orderA.id, editor.userId, [{ deletedAt: '2026-10-10T08:00:00.000Z' }]);
    const [event] = await insertEntries(admin(), orderA.id, editor.userId, [{ kind: 'event' }]);
    const answers = [];
    for (const target of [foreign, uuidv7(), deleted, event]) {
      const response = await post(editor, orderA.id, { kind: 'note', noteCategory: 'other', body: 'Poprawka.', supersedesEntryId: target });
      expect(response.status).toBe(400);
      answers.push(JSON.stringify({ ...(response.body as object), traceId: '' }));
    }
    expect(new Set(answers).size).toBe(1);
    expect(JSON.parse(answers[0] ?? '{}')).toMatchObject({
      code: 'validation_failed',
      errors: [{ pointer: '/supersedesEntryId', code: 'unknown_entry' }],
    });
    expect(await countOf(orderA.id)).toBe(2);
    expect(await countOf(orderB.id)).toBe(1);
  });

  it('EVM-037 K9 a correction has the kind of the entry it corrects: a comment cannot correct a note', async () => {
    const editor = await signIn('editor');
    const { id: orderId } = await order();
    const note = entryOf((await post(editor, orderId, { kind: 'note', noteCategory: 'other', body: 'Wpis.' })).body);
    const response = await post(editor, orderId, { kind: 'comment', body: 'Komentarz.', supersedesEntryId: note.id });
    expect(response.status).toBe(400);
    expect(errorsOf(response.body)).toEqual([{ pointer: '/kind', code: 'invalid_value' }]);
  });

  it('EVM-037 AC3 a repeat of a correction is the same correction: one entry, Idempotent-Replayed', async () => {
    const editor = await signIn('editor');
    const { id: orderId } = await order();
    const original = entryOf((await post(editor, orderId, { kind: 'comment', body: 'Komentarz.' })).body);
    const sent = { id: uuidv7() };
    const body = { ...sent, kind: 'comment', body: 'Poprawka.', supersedesEntryId: original.id };
    const key = uuidv7();
    const first = await editor.panel.post(`${BASE}/${orderId}/timeline`, body, { 'Idempotency-Key': key });
    const again = await editor.panel.post(`${BASE}/${orderId}/timeline`, body, { 'Idempotency-Key': key });
    expect([first.status, again.status]).toEqual([201, 201]);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body).toEqual(first.body);
    expect(await countOf(orderId)).toBe(2);
  });

  it('EVM-037 AC3 the text of an entry cannot be changed by any operation of the API: PATCH and PUT of an entry are not routes (the DELETE is the soft delete of the Administrator, EVM-040)', async () => {
    const editor = await signIn('editor');
    const administrator = await signIn('administrator');
    const { id: orderId } = await order();
    const entry = entryOf((await post(editor, orderId, { kind: 'comment', body: 'Treść nieedytowalna.' })).body);
    const path = `${BASE}/${orderId}/timeline/${entry.id}`;
    const server = current.app.getHttpServer();
    for (const browser of [editor, administrator]) {
      for (const method of ['patch', 'put'] as const) {
        const call = request(server)[method](path);
        const response = await call
          .set('Cookie', browser.panel.cookie ?? '')
          .set('X-CSRF-Token', browser.panel.csrfToken ?? '')
          .set('Origin', PANEL_ORIGIN)
          .set('Sec-Fetch-Site', 'same-origin')
          .set('If-Match', '"1"')
          .send({ body: 'Zmiana' });
        expect([404, 405], `${method} ${response.status}`).toContain(response.status);
      }
      const collection = await request(server)
        .delete(`${BASE}/${orderId}/timeline`)
        .set('Cookie', browser.panel.cookie ?? '')
        .set('X-CSRF-Token', browser.panel.csrfToken ?? '')
        .set('Origin', PANEL_ORIGIN)
        .set('Sec-Fetch-Site', 'same-origin');
      expect([404, 405]).toContain(collection.status);
    }
    // EVM-040: the DELETE is the soft delete of the Administrator - the Editor gets 403, and the text stays in the database either way
    const refused = await request(server)
      .delete(path)
      .set('Cookie', editor.panel.cookie ?? '')
      .set('X-CSRF-Token', editor.panel.csrfToken ?? '')
      .set('Origin', PANEL_ORIGIN)
      .set('Sec-Fetch-Site', 'same-origin')
      .set('If-Match', '"1"');
    expect(refused.status).toBe(403);
    expect(await bodyOf(entry.id)).toBe('Treść nieedytowalna.');
    expect(await countOf(orderId)).toBe(1);
  });
});
