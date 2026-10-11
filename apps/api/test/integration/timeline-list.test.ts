import { Kysely, PostgresDialect, sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../src/platform/config/config.ts';
import { createPool, type Database } from '../../src/platform/database/database.ts';
import type { Logger } from '../../src/platform/logging/logger.ts';
import { APP_CONFIG, DATABASE, LOGGER } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertProcedure } from '../support/procedure-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { insertEntries, type EntrySpec } from '../support/timeline-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';

const NOW = '2026-10-11T08:00:00.000Z';
const BASE = '/api/v1/work-orders';

/** Every statement the application sends, in order (Kysely `log` hook): what the test of N+1 counts. */
const statements: string[] = [];

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp({
    configure: (builder) =>
      builder.overrideProvider(DATABASE).useFactory({
        inject: [APP_CONFIG, LOGGER],
        factory: (config: AppConfig, logger: Logger) =>
          new Kysely<Database>({
            dialect: new PostgresDialect({ pool: createPool({ url: config.databaseUrl, logger }) }),
            log: (event) => {
              if (event.level === 'query') statements.push(event.query.sql);
            },
          }),
      }),
  });
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
  return { userId: user.id, panel };
}

let numbering = 0;
async function order(options: { deleted?: boolean; stages?: number } = {}) {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `jan${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [
    {
      number: `ZL-7${String(numbering).padStart(3, '0')}-0001`,
      customerId,
      siteId,
      ...(options.deleted === true ? { deletedAt: new Date('2026-10-02T08:00:00Z') } : {}),
    },
  ]);
  const id = [...ids.values()][0] ?? '';
  const process = await insertProcedure(admin(), id, { stages: Array.from({ length: options.stages ?? 2 }, () => ({})) });
  return { id, stageIds: process.stageIds };
}

interface Item {
  id: string;
  kind: string;
  body: string | null;
  procedureStageId: string | null;
  procedureStageName: string | null;
  author: { id: string; displayName: string } | null;
  createdAt: string;
  supersededByEntryId: string | null;
}
interface Page {
  items: Item[];
  nextCursor: string | null;
}
const pageOf = (body: unknown) => body as Page;
const codeOf = (body: unknown) => (body as { code?: string }).code;
type Browser = Awaited<ReturnType<typeof signIn>>;
const listOf = (browser: Browser, orderId: string, query = '') => browser.panel.get(`${BASE}/${orderId}/timeline${query}`);

/** 60 entries made over two hours, the identifiers made in the REVERSE order of the time of the server. */
async function sixty(orderId: string, authorId: string, stageId?: string): Promise<string[]> {
  const specs: EntrySpec[] = Array.from({ length: 60 }, (_, index) => ({
    id: uuidv7(Date.parse('2026-10-05T00:00:00Z') - index * 1000),
    kind: index % 3 === 0 ? 'comment' : 'note',
    createdAt: new Date(Date.parse('2026-10-01T08:00:00Z') + index * 2 * 60_000).toISOString(),
    ...(stageId !== undefined && index % 4 === 0 ? { procedureStageId: stageId } : {}),
  }));
  return insertEntries(admin(), orderId, authorId, specs);
}

describe('EVM-037 AC6 — the timeline and the filters (SR-API-02, SR-API-04)', () => {
  it('EVM-037 AC6 60 entries come in pages of 25, 25 and 10 from the newest by the time of the SERVER, each once; the last page has no cursor', async () => {
    const editor = await signIn('editor');
    const { id: orderId } = await order();
    const ids = await sixty(orderId, editor.userId);
    const first = await listOf(editor, orderId);
    expect(first.status).toBe(200);
    expect(pageOf(first.body).items).toHaveLength(25);
    expect(pageOf(first.body).nextCursor).toEqual(expect.any(String));
    const second = await listOf(editor, orderId, `?cursor=${pageOf(first.body).nextCursor}`);
    expect(pageOf(second.body).items).toHaveLength(25);
    const third = await listOf(editor, orderId, `?cursor=${pageOf(second.body).nextCursor}`);
    expect(pageOf(third.body).items).toHaveLength(10);
    expect(pageOf(third.body).nextCursor).toBeNull();
    const all = [first, second, third].flatMap((page) => pageOf(page.body).items.map((item) => item.id));
    // the newest first: the entry made LAST is the first, though its identifier is the OLDEST
    expect(all).toEqual([...ids].reverse());
    expect(new Set(all).size).toBe(60);
    const times = [first, second, third].flatMap((page) => pageOf(page.body).items.map((item) => item.createdAt));
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('EVM-037 AC6 "Pokaż starsze" keeps the position: an entry added meanwhile does not move the next page', async () => {
    const editor = await signIn('editor');
    const { id: orderId } = await order();
    const ids = await sixty(orderId, editor.userId);
    const first = pageOf((await listOf(editor, orderId, '?limit=10')).body);
    await insertEntries(admin(), orderId, editor.userId, [{ createdAt: '2026-10-10T08:00:00.000Z' }]);
    const second = pageOf((await listOf(editor, orderId, `?limit=10&cursor=${first.nextCursor}`)).body);
    expect(second.items.map((item) => item.id)).toEqual([...ids].reverse().slice(10, 20));
  });

  it('EVM-037 AC6 the filters "Wpisy", "Komentarze" and the stage narrow the list — conditions of the query, so every page is full', async () => {
    const editor = await signIn('editor');
    const { id: orderId, stageIds } = await order();
    await sixty(orderId, editor.userId, stageIds[0]);
    const comments = pageOf((await listOf(editor, orderId, '?kind=comment&limit=100')).body);
    expect(comments.items).toHaveLength(20);
    expect(comments.items.every((item) => item.kind === 'comment')).toBe(true);
    const notes = await listOf(editor, orderId, '?kind=note&limit=30');
    expect(pageOf(notes.body).items).toHaveLength(30);
    expect(pageOf(notes.body).nextCursor).toEqual(expect.any(String));
    const notesRest = pageOf((await listOf(editor, orderId, `?kind=note&limit=30&cursor=${pageOf(notes.body).nextCursor}`)).body);
    expect(notesRest.items).toHaveLength(10);
    const staged = pageOf((await listOf(editor, orderId, `?procedureStageId=${stageIds[0]}&limit=100`)).body);
    expect(staged.items).toHaveLength(15);
    expect(staged.items.every((item) => item.procedureStageId === stageIds[0])).toBe(true);
    expect(staged.items[0]?.procedureStageName).toMatch(/^Etap syntetyczny/);
    const both = pageOf((await listOf(editor, orderId, `?kind=comment&procedureStageId=${stageIds[0]}&limit=100`)).body);
    expect(both.items.length).toBeGreaterThan(0);
    expect(both.items.every((item) => item.kind === 'comment' && item.procedureStageId === stageIds[0])).toBe(true);
    const none = pageOf((await listOf(editor, orderId, `?procedureStageId=${uuidv7()}`)).body);
    expect(none).toEqual({ items: [], nextCursor: null });
  });

  it('EVM-037 AC6 SR-AUTHZ-02 the list holds only the entries of THIS order; deleted entries and events of the order are not entries to filter', async () => {
    const editor = await signIn('editor');
    const orderA = await order();
    const orderB = await order();
    const [own] = await insertEntries(admin(), orderA.id, editor.userId, [{}]);
    await insertEntries(admin(), orderA.id, editor.userId, [{ deletedAt: '2026-10-10T08:00:00.000Z' }]);
    await insertEntries(admin(), orderB.id, editor.userId, [{}, {}]);
    const page = pageOf((await listOf(editor, orderA.id)).body);
    expect(page.items.map((item) => item.id)).toEqual([own]);
    // the stage of ANOTHER order as a filter is an empty list, not an error and not the entries of the other order
    const [foreignStaged] = await insertEntries(admin(), orderB.id, editor.userId, [{ procedureStageId: orderB.stageIds[0] ?? '' }]);
    const foreign = pageOf((await listOf(editor, orderA.id, `?procedureStageId=${orderB.stageIds[0]}`)).body);
    expect(foreign.items).toEqual([]);
    expect(foreignStaged).toBeDefined();
  });

  it('EVM-037 AC6 SR-API-04 a cursor that was changed, is of another filter, order or user, or has expired is 400 invalid_cursor — one answer', async () => {
    const editor = await signIn('editor');
    const other = await signIn('editor');
    const orderA = await order();
    const orderB = await order();
    await sixty(orderA.id, editor.userId);
    await sixty(orderB.id, editor.userId);
    const cursor = pageOf((await listOf(editor, orderA.id, '?limit=10')).body).nextCursor ?? '';
    const flipped = `${cursor.slice(0, -2)}${cursor.endsWith('AA') ? 'BB' : 'AA'}`;
    const attempts = [
      () => listOf(editor, orderA.id, `?limit=10&cursor=${flipped}`),
      () => listOf(editor, orderA.id, `?limit=10&kind=note&cursor=${cursor}`),
      () => listOf(editor, orderB.id, `?limit=10&cursor=${cursor}`),
      () => listOf(other, orderA.id, `?limit=10&cursor=${cursor}`),
      () => listOf(editor, orderA.id, '?cursor=abc'),
    ];
    const answers = [];
    for (const attempt of attempts) {
      const response = await attempt();
      expect(response.status).toBe(400);
      expect(codeOf(response.body)).toBe('invalid_cursor');
      answers.push(JSON.stringify({ ...(response.body as object), traceId: '' }));
    }
    expect(new Set(answers).size).toBe(1);
    // the cursor is opaque: no identifier, time or filter in the clear
    const plain = Buffer.from(cursor, 'base64url').toString('latin1');
    expect(plain).not.toContain(orderA.id);
    expect(plain).not.toContain('2026-10');
    current.clock.advance(31 * 60_000);
    const expired = await listOf(editor, orderA.id, `?limit=10&cursor=${cursor}`);
    expect(expired.status).toBe(400);
    expect(codeOf(expired.body)).toBe('invalid_cursor');
  });

  it('EVM-037 AC6 SR-API-02 limit 1..100 (default 25); 0, 101 and text, kind event and an unknown or repeated parameter are 400', async () => {
    const editor = await signIn('editor');
    const { id: orderId } = await order();
    await sixty(orderId, editor.userId);
    expect(pageOf((await listOf(editor, orderId, '?limit=100')).body).items).toHaveLength(60);
    expect(pageOf((await listOf(editor, orderId, '?limit=1')).body).items).toHaveLength(1);
    for (const query of ['?limit=0', '?limit=101', '?limit=abc', '?limit=-1', '?kind=event', '?kind=other', '?procedureStageId=x']) {
      const response = await listOf(editor, orderId, query);
      expect(response.status, query).toBe(400);
      expect(codeOf(response.body), query).toBe('validation_failed');
    }
    expect(codeOf((await listOf(editor, orderId, '?sort=createdAt')).body)).toBe('unknown_parameter');
    expect(codeOf((await listOf(editor, orderId, '?kind=note&kind=comment')).body)).toBe('duplicate_parameter');
  });

  it('EVM-037 AC6 SR-API-02 the number of statements does not depend on the size of the page: one for the order, one for the page, one batch each for names, stages and corrections', async () => {
    const editor = await signIn('editor');
    const { id: orderId, stageIds } = await order();
    const other = await signIn('editor');
    await sixty(orderId, editor.userId, stageIds[0]);
    await insertEntries(admin(), orderId, other.userId, [{ procedureStageId: stageIds[1] ?? '' }]);
    const counts: Record<string, number> = {};
    for (const limit of [1, 5, 25, 100]) {
      statements.length = 0;
      const response = await listOf(editor, orderId, `?limit=${limit}`);
      expect(response.status).toBe(200);
      expect(pageOf(response.body).items).toHaveLength(Math.min(limit, 61));
      counts[String(limit)] = statements.filter((text) => !/^(begin|commit|rollback|set transaction)/i.test(text)).length;
      expect(statements.filter((text) => text.includes('"timeline"."timeline_entries"')).length).toBeLessThanOrEqual(2);
      expect(statements.filter((text) => text.includes('"display_name"'))).toHaveLength(1);
    }
    expect(counts['1']).toBe(counts['100']);
    expect(counts['5']).toBe(counts['100']);
    expect(counts['25']).toBe(counts['100']);
  });
});

describe('EVM-037 AC6 AC8 — the answer and who may read (SR-AUTHZ-05, SR-DATA-03, ASVS V15.3.1)', () => {
  it('EVM-037 AC8 the three roles read the journal and one entry; an item has the contract fields and the author as id and displayName only', async () => {
    const author = await signIn('editor');
    const { id: orderId, stageIds } = await order();
    const [entryId] = await insertEntries(admin(), orderId, author.userId, [{ body: 'Treść wpisu.', procedureStageId: stageIds[0] ?? '' }]);
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const reader = await signIn(role);
      const list = await listOf(reader, orderId);
      expect(list.status, role).toBe(200);
      const item = pageOf(list.body).items[0];
      expect(Object.keys(item ?? {}).sort()).toEqual(
        [
          'author',
          'body',
          'capturedAt',
          'createdAt',
          'event',
          'id',
          'kind',
          'noteCategory',
          'origin',
          'procedureStageId',
          'procedureStageName',
          'redactedAt',
          'supersededByEntryId',
          'supersedesEntryId',
        ].sort(),
      );
      expect((item as unknown as { event: unknown }).event).toBeNull();
      expect(Object.keys(item?.author ?? {}).sort()).toEqual(['displayName', 'id']);
      const one = await reader.panel.get(`${BASE}/${orderId}/timeline/${entryId}`);
      expect(one.status, role).toBe(200);
      expect((one.body as Item).body).toBe('Treść wpisu.');
    }
  });

  it('EVM-037 AC7 an entry of order B asked through the path of order A, a missing entry, a deleted entry and an entry of a deleted order are ONE 404 — for every role', async () => {
    const editor = await signIn('editor');
    const orderA = await order();
    const orderB = await order();
    const deletedOrder = await order({ deleted: true });
    const [foreign] = await insertEntries(admin(), orderB.id, editor.userId, [{}]);
    const [deleted] = await insertEntries(admin(), orderA.id, editor.userId, [{ deletedAt: '2026-10-10T08:00:00.000Z' }]);
    const [ofDeletedOrder] = await insertEntries(admin(), deletedOrder.id, editor.userId, [{}]);
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      const reader = await signIn(role);
      const paths = [
        `${BASE}/${orderA.id}/timeline/${foreign}`,
        `${BASE}/${orderA.id}/timeline/${uuidv7()}`,
        `${BASE}/${orderA.id}/timeline/${deleted}`,
        `${BASE}/${deletedOrder.id}/timeline/${ofDeletedOrder}`,
        `${BASE}/${uuidv7()}/timeline/${foreign}`,
      ];
      const answers = [];
      for (const path of paths) {
        const response = await reader.panel.get(path);
        expect(response.status, `${role} ${path}`).toBe(404);
        answers.push(JSON.stringify({ ...(response.body as object), traceId: '' }));
      }
      expect(new Set(answers).size, role).toBe(1);
      expect((await reader.panel.get(`${BASE}/${orderA.id}/timeline/not-a-uuid`)).status).toBe(400);
    }
  });

  it('EVM-037 AC6 an empty journal is an empty list with no cursor ("Brak wpisów")', async () => {
    const reader = await signIn('read_only');
    const { id: orderId } = await order();
    const response = await listOf(reader, orderId);
    expect(response.status).toBe(200);
    expect(pageOf(response.body)).toEqual({ items: [], nextCursor: null });
  });

  it('EVM-037 AC6 SR-DATA-03 the name of a deactivated author is still shown (accountability); the answer never carries an e-mail', async () => {
    const author = await signIn('editor');
    const reader = await signIn('read_only');
    const { id: orderId } = await order();
    await insertEntries(admin(), orderId, author.userId, [{}]);
    await sql`update identity.users set status = 'deactivated', deactivated_at = ${new Date(NOW)} where id = ${author.userId}`.execute(
      admin(),
    );
    const response = await listOf(reader, orderId);
    expect(pageOf(response.body).items[0]?.author?.id).toBe(author.userId);
    expect(JSON.stringify(response.body)).not.toContain('@');
  });
});
