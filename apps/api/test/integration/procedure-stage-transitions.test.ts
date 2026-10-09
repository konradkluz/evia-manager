import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { STAGE_TRANSITION_TABLE } from '../../src/modules/procedures/domain/stage-transitions.ts';
import type { StageStatus } from '../../src/modules/procedures/domain/stage-rules.ts';
import type { WorkOrderStatus } from '../../src/modules/work-orders/domain/work-order-list-query.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertProcedure, type ProcedureSpec, type StageSpec } from '../support/procedure-fixtures.ts';
import { insertParty, insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';

const TODAY_INSTANT = '2026-10-03T08:00:00.000Z';
const TODAY = '2026-10-03';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp();
});
afterAll(async () => {
  await current.close();
});
let auditBaseline = 0;
beforeEach(async () => {
  current.clock.set(TODAY_INSTANT);
  await clearWorkOrderCreation(current.database.admin);
  await sql`delete from platform.idempotency_records`.execute(current.database.admin);
  auditBaseline = await auditTotal('procedure_stage.transitioned');
});

const admin = () => current.database.admin;
const BASE = '/api/v1/work-orders';

async function signIn(role: Role = 'editor', channel: 'web' | 'mobile' = 'web') {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user, { channel });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}
type Browser = Awaited<ReturnType<typeof signIn>>;

let numbering = 0;
async function order(
  processes: ProcedureSpec[] = [{}],
  options: { status?: WorkOrderStatus; deleted?: boolean } = {},
): Promise<{ id: string; processes: Array<{ id: string; stageIds: string[] }> }> {
  numbering += 1;
  const customerId = await insertCustomer(admin(), { email: `jan${numbering}@example.invalid` });
  const siteId = await insertSite(admin());
  const ids = await insertWorkOrders(admin(), [
    {
      number: `ZL-4${String(numbering).padStart(3, '0')}-0001`,
      customerId,
      siteId,
      ...(options.status === undefined ? {} : { status: options.status }),
      ...(options.deleted === true ? { deletedAt: new Date('2026-10-02T08:00:00Z') } : {}),
    },
  ]);
  const id = [...ids.values()][0] ?? '';
  const inserted = [];
  for (const [index, spec] of processes.entries()) inserted.push(await insertProcedure(admin(), id, { position: index + 1, ...spec }));
  return { id, processes: inserted };
}
async function oneStage(stage: StageSpec = {}, options: { status?: WorkOrderStatus } = {}) {
  const created = await order([{ stages: [stage] }], options);
  return { orderId: created.id, stageId: created.processes[0]?.stageIds[0] ?? '' };
}

interface Options {
  readonly ifMatch?: string | null;
  readonly key?: string;
}
const transition = (browser: Browser, orderId: string, stageId: string, body: unknown, options: Options = {}) =>
  browser.panel.post(`${BASE}/${orderId}/procedure-stages/${stageId}/transitions`, body, {
    ...(options.ifMatch === null ? {} : { 'If-Match': options.ifMatch ?? '"1"' }),
    ...(options.key === undefined ? {} : { 'Idempotency-Key': options.key }),
  });
const patchStage = (browser: Browser, orderId: string, stageId: string, body: unknown, options: Options = {}) =>
  browser.panel.patch(`${BASE}/${orderId}/procedure-stages/${stageId}`, body, {
    ...(options.ifMatch === null ? {} : { 'If-Match': options.ifMatch ?? '"1"' }),
    ...(options.key === undefined ? {} : { 'Idempotency-Key': options.key }),
  });
const listOf = (browser: Browser, orderId: string) => browser.panel.get(`${BASE}/${orderId}/procedures`);

const codeOf = (body: unknown) => (body as { code?: string }).code;
const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;
const withoutTrace = (body: unknown): string => JSON.stringify(body).replace(/"traceId":"[0-9a-f]+"/, '');

interface StageRow {
  status: string;
  version: number;
  waiting_on: string | null;
  waiting_on_party_id: string | null;
  waiting_since: string | null;
  blocked_reason: string | null;
  completed_on: string | null;
  started_at: Date | null;
  updated_by: string | null;
}
async function rowOf(stageId: string): Promise<StageRow> {
  const { rows } =
    await sql<StageRow>`select status, version, waiting_on, waiting_on_party_id, to_char(waiting_since, 'YYYY-MM-DD') as waiting_since,
    blocked_reason, to_char(completed_on, 'YYYY-MM-DD') as completed_on, started_at, updated_by
    from procedures.procedure_stages where id = ${stageId}`.execute(admin());
  const row = rows[0];
  if (row === undefined) throw new Error('no such stage');
  return row;
}
const auditOf = async (objectId: string) =>
  (await sql<Record<string, unknown>>`select * from audit.events where object_id = ${objectId} order by occurred_at, id`.execute(admin()))
    .rows;
const auditTotal = async (action: string): Promise<number> =>
  Number((await sql<{ n: string }>`select count(*)::text as n from audit.events where action = ${action}`.execute(admin())).rows[0]?.n);
const idempotencyTotal = async (): Promise<number> =>
  Number((await sql<{ n: string }>`select count(*)::text as n from platform.idempotency_records`.execute(admin())).rows[0]?.n);

interface StageBody {
  status: string;
  version: number;
  waitingOn: string | null;
  waitingParty: { id: string; displayName: string } | null;
  waitingSince: string | null;
  waitingDays: number | null;
  blockedReason: string | null;
  startedAt: string | null;
  completedOn: string | null;
}
const stageOf = (body: unknown) => body as StageBody;

/** The stage as the table needs it to leave `from` (the CHECKs of the table require "waiting for" exactly in `waiting`). */
const seedOf = (from: StageStatus): StageSpec => {
  switch (from) {
    case 'waiting':
      return { status: 'waiting', waitingOn: 'customer', waitingSince: '2026-09-18' };
    case 'blocked':
      return { status: 'blocked', blockedReason: 'Powód syntetyczny' };
    case 'done':
      return { status: 'done', completedOn: '2026-10-01' };
    default:
      return { status: from };
  }
};
/** The parameters of a move that a user could give by hand. */
const commandOf = (to: StageStatus): Record<string, unknown> => {
  switch (to) {
    case 'waiting':
      return { to, waitingOn: 'customer' };
    case 'blocked':
      return { to, blockedReason: 'Brak zgody wspólnoty (test)' };
    default:
      return { to };
  }
};

describe('the table of transitions, row by row, for every role (EVM-032 AC1, AC4, AC7; SR-API-07, SR-AUTHZ-05)', () => {
  it('EVM-032 AC4 AC7 every row of the table (16) is executed by the Administrator AND by the Editor: 200, the status of the target, the fields of the target, the new ETag, the CHECKs of the table hold', async () => {
    for (const role of ['administrator', 'editor'] as const) {
      const browser = await signIn(role);
      const created = await order([{ stages: STAGE_TRANSITION_TABLE.map((row) => seedOf(row.from)) }]);
      for (const [index, row] of STAGE_TRANSITION_TABLE.entries()) {
        const stageId = created.processes[0]?.stageIds[index] ?? '';
        const response = await transition(browser, created.id, stageId, commandOf(row.to));
        const label = `${role} ${row.from}>${row.to}`;
        expect(response.status, `${label} ${JSON.stringify(response.body)}`).toBe(200);
        expect(response.headers['etag'], label).toBe('"2"');
        const body = stageOf(response.body);
        expect(body.status, label).toBe(row.to);
        expect(body.version, label).toBe(2);
        expect(body.waitingOn !== null, label).toBe(row.to === 'waiting');
        expect(body.waitingSince !== null, label).toBe(row.to === 'waiting');
        expect(body.blockedReason !== null, label).toBe(row.to === 'blocked');
        expect(body.completedOn !== null, label).toBe(row.to === 'done');
        expect(await rowOf(stageId), label).toMatchObject({ status: row.to, version: 2, updated_by: browser.userId });
      }
    }
  });

  it('EVM-032 AC7 Tylko odczyt gets 403 forbidden on EVERY row of the table — before If-Match, the body and the existence — and nothing changes', async () => {
    const reader = await signIn('read_only');
    const created = await order([{ stages: STAGE_TRANSITION_TABLE.map((row) => seedOf(row.from)) }]);
    for (const [index, row] of STAGE_TRANSITION_TABLE.entries()) {
      const stageId = created.processes[0]?.stageIds[index] ?? '';
      const before = await rowOf(stageId);
      const response = await transition(reader, created.id, stageId, commandOf(row.to));
      expect(response.status, `${row.from}>${row.to}`).toBe(403);
      expect(codeOf(response.body)).toBe('forbidden');
      expect(await rowOf(stageId)).toEqual(before);
    }
    for (const [target, target2, body, ifMatch] of [
      [created.id, uuidv7(), { to: 'done' }, '"1"'],
      [uuidv7(), uuidv7(), { status: 'done' }, 'W/"1"'],
      [created.id, created.processes[0]?.stageIds[0] ?? '', {}, null],
    ] as const) {
      const response = await transition(reader, target, target2, body, { ifMatch });
      expect(response.status).toBe(403);
      expect(JSON.stringify(response.body)).not.toContain('errors');
    }
    expect(await idempotencyTotal()).toBe(0);
  });

  it('EVM-032 AC6 every move that is NOT in the table is 409 invalid_state_transition and the stage is untouched — each status to itself, back to todo, from the closed ones', async () => {
    const editor = await signIn('editor');
    const statuses: StageStatus[] = ['todo', 'in_progress', 'waiting', 'blocked', 'done', 'not_applicable'];
    const allowed = new Set(STAGE_TRANSITION_TABLE.map((row) => `${row.from}>${row.to}`));
    const created = await order([{ stages: statuses.map((from) => seedOf(from)) }]);
    let refused = 0;
    for (const [index, from] of statuses.entries()) {
      const stageId = created.processes[0]?.stageIds[index] ?? '';
      const before = await rowOf(stageId);
      for (const to of statuses) {
        if (allowed.has(`${from}>${to}`)) continue;
        const response = await transition(editor, created.id, stageId, commandOf(to));
        expect(response.status, `${from}>${to} ${JSON.stringify(response.body)}`).toBe(409);
        expect(codeOf(response.body)).toBe('invalid_state_transition');
        expect(JSON.stringify(response.body), 'no current status in the answer').not.toContain(from);
        refused += 1;
      }
      expect(await rowOf(stageId)).toEqual(before);
    }
    expect(refused).toBe(36 - 16);
  });
});

describe('"Rozpocznij" and the menu of the badge (EVM-032 AC1)', () => {
  it('EVM-032 AC1 "Rozpocznij" (todo > in_progress) records the time of the start; later moves keep it', async () => {
    const { orderId, stageId } = await oneStage();
    const editor = await signIn('editor');
    const started = await transition(editor, orderId, stageId, { to: 'in_progress' });
    expect(started.status).toBe(200);
    expect(stageOf(started.body).startedAt).toBe(TODAY_INSTANT);
    expect((await rowOf(stageId)).started_at?.toISOString()).toBe(TODAY_INSTANT);

    current.clock.set('2026-10-03T08:10:00.000Z');
    expect((await transition(editor, orderId, stageId, { to: 'waiting', waitingOn: 'customer' }, { ifMatch: '"2"' })).status).toBe(200);
    const back = await transition(editor, orderId, stageId, { to: 'in_progress' }, { ifMatch: '"3"' });
    expect(stageOf(back.body).startedAt).toBe(TODAY_INSTANT);
  });

  it('EVM-032 AC1 a move that does not start the stage leaves startedAt empty (todo > waiting, todo > done)', async () => {
    const editor = await signIn('editor');
    for (const command of [{ to: 'waiting', waitingOn: 'customer' }, { to: 'done' }, { to: 'not_applicable' }]) {
      const { orderId, stageId } = await oneStage();
      const response = await transition(editor, orderId, stageId, command);
      expect(response.status).toBe(200);
      expect(stageOf(response.body).startedAt).toBeNull();
    }
  });
});

describe('"Czekamy na…" (EVM-032 AC2, AC3, AC8; SR-INPUT-02, SR-DATA-02)', () => {
  it('EVM-032 AC2 waiting for a party: the party is { id, displayName } — no telephone, e-mail, contact person or note — since is today, 0 days', async () => {
    const osd = await insertParty(admin(), {
      displayName: 'Operator Syntetyczny (OSD)',
      phone: '+48600100200',
      email: 'kontakt@operator.example.invalid',
      contactPersonName: 'Osoba Kontaktowa',
      notes: 'notatka-strony-xyz',
    });
    const { orderId, stageId } = await oneStage({ status: 'in_progress' });
    const editor = await signIn('editor');
    const response = await transition(editor, orderId, stageId, { to: 'waiting', waitingOn: 'party', waitingOnPartyId: osd });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(stageOf(response.body)).toMatchObject({
      status: 'waiting',
      waitingOn: 'party',
      waitingParty: { id: osd, displayName: 'Operator Syntetyczny (OSD)' },
      waitingSince: TODAY,
      waitingDays: 0,
    });
    expect(Object.keys(stageOf(response.body).waitingParty ?? {}).sort()).toEqual(['displayName', 'id']);
    const list = await listOf(editor, orderId);
    expect(JSON.stringify(response.body) + JSON.stringify(list.body)).not.toMatch(/600100200|operator\.example|Kontaktowa|notatka-strony/);
    expect(await rowOf(stageId)).toMatchObject({ waiting_on: 'party', waiting_on_party_id: osd, waiting_since: TODAY });
  });

  it('EVM-032 AC2 waiting for the customer: no party, since is today', async () => {
    const { orderId, stageId } = await oneStage({ status: 'todo' });
    const response = await transition(await signIn('editor'), orderId, stageId, { to: 'waiting', waitingOn: 'customer' });
    expect(stageOf(response.body)).toMatchObject({ status: 'waiting', waitingOn: 'customer', waitingParty: null, waitingSince: TODAY });
  });

  it('EVM-032 AC2 "since" from the future is 400 validation_failed (/waitingSince, out_of_range); a party without an id is 400 under the field; the stage is untouched', async () => {
    const { orderId, stageId } = await oneStage({ status: 'in_progress' });
    const editor = await signIn('editor');
    const before = await rowOf(stageId);
    const future = await transition(editor, orderId, stageId, { to: 'waiting', waitingOn: 'customer', waitingSince: '2026-10-04' });
    expect(future.status).toBe(400);
    expect(codeOf(future.body)).toBe('validation_failed');
    expect(errorsOf(future.body)).toEqual([{ pointer: '/waitingSince', code: 'out_of_range' }]);
    const noParty = await transition(editor, orderId, stageId, { to: 'waiting', waitingOn: 'party' });
    expect(errorsOf(noParty.body)).toEqual([{ pointer: '/waitingOnPartyId', code: 'required' }]);
    const noWho = await transition(editor, orderId, stageId, { to: 'waiting' });
    expect(errorsOf(noWho.body)).toEqual([{ pointer: '/waitingOn', code: 'required' }]);
    expect(await rowOf(stageId)).toEqual(before);
  });

  it('EVM-032 AC2 the bounds of "since": 1999 is out_of_range, 2000-01-01 and today pass, a 30th of February is not a date', async () => {
    const editor = await signIn('editor');
    const attempt = async (waitingSince: string) => {
      const { orderId, stageId } = await oneStage({ status: 'in_progress' });
      return transition(editor, orderId, stageId, { to: 'waiting', waitingOn: 'customer', waitingSince });
    };
    expect(errorsOf((await attempt('1999-12-31')).body)).toEqual([{ pointer: '/waitingSince', code: 'out_of_range' }]);
    expect((await attempt('2000-01-01')).status).toBe(200);
    expect((await attempt(TODAY)).status).toBe(200);
    const impossible = await attempt('2026-02-30');
    expect(impossible.status).toBe(400);
    expect(errorsOf(impossible.body)).toEqual([{ pointer: '/waitingSince', code: 'invalid_format' }]);
  });

  it('EVM-032 AC2 the customer with a party id, and a party field outside "waiting", are 400 not_allowed — never the value', async () => {
    const osd = await insertParty(admin());
    const { orderId, stageId } = await oneStage({ status: 'in_progress' });
    const editor = await signIn('editor');
    const customerWithParty = await transition(editor, orderId, stageId, { to: 'waiting', waitingOn: 'customer', waitingOnPartyId: osd });
    expect(errorsOf(customerWithParty.body)).toEqual([{ pointer: '/waitingOnPartyId', code: 'not_allowed' }]);
    expect(JSON.stringify(customerWithParty.body)).not.toContain(osd);
    const outside = await transition(editor, orderId, stageId, { to: 'done', waitingOn: 'customer', waitingSince: TODAY });
    expect(errorsOf(outside.body)).toEqual([
      { pointer: '/waitingOn', code: 'not_allowed' },
      { pointer: '/waitingSince', code: 'not_allowed' },
    ]);
  });

  it('EVM-032 AC2 SR-INPUT-02 a party that does not exist and one that is soft deleted are the SAME 400 (/waitingOnPartyId, unknown_party) — for the Editor AND the Administrator; the stage is untouched', async () => {
    const deleted = await insertParty(admin(), { deletedAt: '2026-10-02T08:00:00Z' });
    const { orderId, stageId } = await oneStage({ status: 'in_progress' });
    const before = await rowOf(stageId);
    const bodies = new Set<string>();
    for (const role of ['editor', 'administrator'] as const) {
      const browser = await signIn(role);
      for (const partyId of [deleted, uuidv7()]) {
        const response = await transition(browser, orderId, stageId, { to: 'waiting', waitingOn: 'party', waitingOnPartyId: partyId });
        expect(response.status, role).toBe(400);
        expect(errorsOf(response.body)).toEqual([{ pointer: '/waitingOnPartyId', code: 'unknown_party' }]);
        expect(JSON.stringify(response.body)).not.toContain(partyId);
        bodies.add(withoutTrace(response.body));
      }
    }
    expect(bodies.size).toBe(1);
    expect(await rowOf(stageId)).toEqual(before);
  });

  it('EVM-032 AC2 SR-INPUT-02 a party deleted while the transition waits for its lock: the check is taken on the LOCKED row, so the answer is 400 and nothing is written (TOCTOU)', async () => {
    const osd = await insertParty(admin());
    const { orderId, stageId } = await oneStage({ status: 'in_progress' });
    const editor = await signIn('editor');
    let locked!: () => void;
    const hasLock = new Promise<void>((resolve) => (locked = resolve));
    let release!: () => void;
    const mayDelete = new Promise<void>((resolve) => (release = resolve));
    const deleting = admin()
      .transaction()
      .execute(async (inner) => {
        await sql`select 1 from parties.parties where id = ${osd} for update`.execute(inner);
        locked();
        await mayDelete;
        await sql`update parties.parties set deleted_at = now() where id = ${osd}`.execute(inner);
      });
    await hasLock;
    const pending = transition(editor, orderId, stageId, { to: 'waiting', waitingOn: 'party', waitingOnPartyId: osd });
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await deleting;
    const response = await pending;
    expect(response.status, JSON.stringify(response.body)).toBe(400);
    expect(errorsOf(response.body)).toEqual([{ pointer: '/waitingOnPartyId', code: 'unknown_party' }]);
    expect((await rowOf(stageId)).status).toBe('in_progress');
  });

  it('EVM-032 AC8 "od 15 dni": since 2026-09-18, today 2026-10-03 (Europe/Warsaw) — the list says 15, and a day earlier 14; a party deleted LATER is null in the list', async () => {
    const osd = await insertParty(admin(), { displayName: 'Operator Syntetyczny' });
    const { orderId, stageId } = await oneStage({
      status: 'waiting',
      waitingOn: 'party',
      waitingOnPartyId: osd,
      waitingSince: '2026-09-18',
    });
    const reader = await signIn('read_only');
    const stageInList = async () => ((await listOf(reader, orderId)).body as { items: Array<{ stages: StageBody[] }> }).items[0]?.stages[0];
    expect(await stageInList()).toMatchObject({
      waitingDays: 15,
      waitingSince: '2026-09-18',
      waitingParty: { displayName: 'Operator Syntetyczny' },
    });
    current.clock.set('2026-10-02T08:00:00.000Z');
    expect((await stageInList())?.waitingDays).toBe(14);
    current.clock.set('2026-10-02T22:30:00.000Z'); // 00:30 on the 3rd in Warsaw
    expect((await stageInList())?.waitingDays).toBe(15);
    await sql`update parties.parties set deleted_at = now() where id = ${osd}`.execute(admin());
    expect(await stageInList()).toMatchObject({ waitingOn: 'party', waitingParty: null, status: 'waiting' });
    expect(stageId).not.toBe('');
  });

  it('EVM-032 AC3 "Odpowiedź otrzymana" (waiting > in_progress) returns the stage to "W toku" and clears who and since', async () => {
    const osd = await insertParty(admin());
    const { orderId, stageId } = await oneStage({
      status: 'waiting',
      waitingOn: 'party',
      waitingOnPartyId: osd,
      waitingSince: '2026-09-18',
    });
    const response = await transition(await signIn('editor'), orderId, stageId, { to: 'in_progress' });
    expect(response.status).toBe(200);
    expect(stageOf(response.body)).toMatchObject({
      status: 'in_progress',
      waitingOn: null,
      waitingParty: null,
      waitingSince: null,
      waitingDays: null,
    });
    expect(await rowOf(stageId)).toMatchObject({ waiting_on: null, waiting_on_party_id: null, waiting_since: null });
  });
});

describe('"Zmień, na kogo czekamy…" — an edit of a stage that waits, not a transition (EVM-032 AC3)', () => {
  it('EVM-032 AC3 the new party and a new "since" = today: version + 1, the status stays, the counter starts again, the audit event is the update (not a transition)', async () => {
    const first = await insertParty(admin(), { displayName: 'Pierwszy Operator' });
    const second = await insertParty(admin(), { displayName: 'Drugi Operator' });
    const { orderId, stageId } = await oneStage({
      status: 'waiting',
      waitingOn: 'party',
      waitingOnPartyId: first,
      waitingSince: '2026-09-18',
    });
    const editor = await signIn('editor');
    const response = await patchStage(editor, orderId, stageId, { waitingOn: 'party', waitingOnPartyId: second });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers['etag']).toBe('"2"');
    expect(stageOf(response.body)).toMatchObject({
      status: 'waiting',
      waitingOn: 'party',
      waitingParty: { id: second, displayName: 'Drugi Operator' },
      waitingSince: TODAY,
      waitingDays: 0,
      version: 2,
    });
    expect(await rowOf(stageId)).toMatchObject({ status: 'waiting', waiting_on_party_id: second, waiting_since: TODAY, version: 2 });
    const events = await auditOf(stageId);
    expect(events.map((event) => event['action'])).toEqual(['procedure_stage.updated']);
  });

  it('EVM-032 AC3 the customer instead of a party; an explicit earlier "since" is kept; the person and the date can go in the same patch', async () => {
    const osd = await insertParty(admin());
    const { orderId, stageId } = await oneStage({
      status: 'waiting',
      waitingOn: 'party',
      waitingOnPartyId: osd,
      waitingSince: '2026-09-18',
    });
    const editor = await signIn('editor');
    const response = await patchStage(editor, orderId, stageId, {
      waitingOn: 'customer',
      waitingSince: '2026-09-30',
      dueDate: '2026-10-20',
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(stageOf(response.body)).toMatchObject({ waitingOn: 'customer', waitingParty: null, waitingSince: '2026-09-30', waitingDays: 3 });
    expect(await rowOf(stageId)).toMatchObject({ waiting_on: 'customer', waiting_on_party_id: null });
  });

  it('EVM-032 AC3 a partial change is 400 (only the party of a customer, only "since", a party without an id, "since" from the future); nothing is written', async () => {
    const { orderId, stageId } = await oneStage({ status: 'waiting', waitingOn: 'customer', waitingSince: '2026-09-18' });
    const osd = await insertParty(admin());
    const editor = await signIn('editor');
    const before = await rowOf(stageId);
    const cases: Array<[Record<string, unknown>, Array<{ pointer: string; code: string }>]> = [
      [{ waitingOnPartyId: osd }, [{ pointer: '/waitingOn', code: 'required' }]],
      [{ waitingSince: TODAY }, [{ pointer: '/waitingOn', code: 'required' }]],
      [{ waitingOn: 'party' }, [{ pointer: '/waitingOnPartyId', code: 'required' }]],
      [{ waitingOn: 'customer', waitingOnPartyId: osd }, [{ pointer: '/waitingOnPartyId', code: 'not_allowed' }]],
      [{ waitingOn: 'customer', waitingSince: '2026-10-04' }, [{ pointer: '/waitingSince', code: 'out_of_range' }]],
    ];
    for (const [body, errors] of cases) {
      const response = await patchStage(editor, orderId, stageId, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(errorsOf(response.body)).toEqual(errors);
    }
    expect(await rowOf(stageId)).toEqual(before);
  });

  it('EVM-032 AC3 the change of the party of a stage that does NOT wait is 409 invalid_state_transition and nothing is written', async () => {
    const editor = await signIn('editor');
    for (const status of ['todo', 'in_progress', 'blocked', 'done', 'not_applicable'] as const) {
      const { orderId, stageId } = await oneStage(seedOf(status));
      const before = await rowOf(stageId);
      const response = await patchStage(editor, orderId, stageId, { waitingOn: 'customer' });
      expect(response.status, status).toBe(409);
      expect(codeOf(response.body)).toBe('invalid_state_transition');
      expect(await rowOf(stageId)).toEqual(before);
    }
  });

  it('EVM-032 AC3 SR-INPUT-02 a party that does not exist or is deleted is the same 400 as in the transition (/waitingOnPartyId, unknown_party) — also for the Administrator', async () => {
    const deleted = await insertParty(admin(), { deletedAt: '2026-10-02T08:00:00Z' });
    const { orderId, stageId } = await oneStage({ status: 'waiting', waitingOn: 'customer', waitingSince: '2026-09-18' });
    for (const role of ['editor', 'administrator'] as const) {
      const browser = await signIn(role);
      for (const partyId of [deleted, uuidv7()]) {
        const response = await patchStage(browser, orderId, stageId, { waitingOn: 'party', waitingOnPartyId: partyId });
        expect(response.status).toBe(400);
        expect(errorsOf(response.body)).toEqual([{ pointer: '/waitingOnPartyId', code: 'unknown_party' }]);
      }
    }
    expect(await rowOf(stageId)).toMatchObject({ waiting_on: 'customer', version: 1 });
  });

  it('EVM-032 AC6 the change of the party on a closed order is 409 work_order_closed; the status of the stage is not a field of the patch (400 read_only_field)', async () => {
    const { orderId, stageId } = await oneStage(
      { status: 'waiting', waitingOn: 'customer', waitingSince: '2026-09-18' },
      { status: 'settled' },
    );
    const editor = await signIn('editor');
    const closed = await patchStage(editor, orderId, stageId, { waitingOn: 'customer' });
    expect(codeOf(closed.body)).toBe('work_order_closed');
    const open = await oneStage({ status: 'waiting', waitingOn: 'customer', waitingSince: '2026-09-18' });
    const status = await patchStage(editor, open.orderId, open.stageId, { status: 'done' });
    expect(status.status).toBe(400);
    expect(errorsOf(status.body)).toEqual([{ pointer: '/status', code: 'read_only_field' }]);
    expect(await rowOf(open.stageId)).toMatchObject({ status: 'waiting', version: 1 });
  });
});

describe('"Zakończ…", "Nie dotyczy", "Zablokuj…" and the way back (EVM-032 AC4)', () => {
  it('EVM-032 AC4 "Zakończ" sets the day (today by default, an earlier one when given), clears who and since, and the progress of the process is recalculated', async () => {
    const osd = await insertParty(admin());
    const created = await order([
      {
        stages: [
          { status: 'waiting', waitingOn: 'party', waitingOnPartyId: osd, waitingSince: '2026-09-18' },
          { status: 'in_progress' },
          { status: 'todo' },
          { status: 'not_applicable' },
        ],
      },
    ]);
    const [waiting, running] = created.processes[0]?.stageIds ?? [];
    const editor = await signIn('editor');
    const progressOf = async () => ((await listOf(editor, created.id)).body as { items: Array<{ progress: unknown }> }).items[0]?.progress;
    expect(await progressOf()).toEqual({ done: 0, total: 3 });

    const done = await transition(editor, created.id, waiting ?? '', { to: 'done' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(stageOf(done.body)).toMatchObject({
      status: 'done',
      completedOn: TODAY,
      waitingOn: null,
      waitingParty: null,
      waitingSince: null,
    });
    expect(await progressOf()).toEqual({ done: 1, total: 3 });

    const earlier = await transition(editor, created.id, running ?? '', { to: 'done', completedOn: '2026-10-01' });
    expect(stageOf(earlier.body).completedOn).toBe('2026-10-01');
    expect(await progressOf()).toEqual({ done: 2, total: 3 });
  });

  it('EVM-032 AC4 the day of completion from the future (or before 2000) is 400 /completedOn out_of_range; a field of another target is not_allowed', async () => {
    const { orderId, stageId } = await oneStage({ status: 'in_progress' });
    const editor = await signIn('editor');
    for (const completedOn of ['2026-10-04', '1999-12-31']) {
      const response = await transition(editor, orderId, stageId, { to: 'done', completedOn });
      expect(errorsOf(response.body), completedOn).toEqual([{ pointer: '/completedOn', code: 'out_of_range' }]);
    }
    expect(
      errorsOf((await transition(editor, orderId, stageId, { to: 'waiting', waitingOn: 'customer', completedOn: TODAY })).body),
    ).toEqual([{ pointer: '/completedOn', code: 'not_allowed' }]);
    expect((await rowOf(stageId)).status).toBe('in_progress');
  });

  it('EVM-032 AC4 "Zablokuj" needs a reason (plain text, trimmed, NFC, 1..500), "Odblokuj" clears it; a bad reason is 400 and the error never carries the text', async () => {
    const { orderId, stageId } = await oneStage({ status: 'in_progress' });
    const editor = await signIn('editor');
    const missing = await transition(editor, orderId, stageId, { to: 'blocked' });
    expect(errorsOf(missing.body)).toEqual([{ pointer: '/blockedReason', code: 'required' }]);
    const blank = await transition(editor, orderId, stageId, { to: 'blocked', blockedReason: '   ' });
    expect(errorsOf(blank.body)).toEqual([{ pointer: '/blockedReason', code: 'required' }]);
    const tooLong = await transition(editor, orderId, stageId, { to: 'blocked', blockedReason: 'z'.repeat(501) });
    expect(tooLong.status).toBe(400);
    const control = await transition(editor, orderId, stageId, { to: 'blocked', blockedReason: 'Powód syntetyczny\u0007' });
    expect(errorsOf(control.body)).toEqual([{ pointer: '/blockedReason', code: 'invalid_characters' }]);
    expect(JSON.stringify(control.body)).not.toContain('Powód');
    expect((await rowOf(stageId)).version).toBe(1);

    const blocked = await transition(editor, orderId, stageId, { to: 'blocked', blockedReason: '  Brak zgodý wspólnoty  ' });
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(200);
    expect(stageOf(blocked.body).status).toBe('blocked');
    expect(stageOf(blocked.body).blockedReason).toBe('Brak zgodý wspólnoty'.normalize('NFC'));

    const unblocked = await transition(editor, orderId, stageId, { to: 'in_progress' }, { ifMatch: '"2"' });
    expect(stageOf(unblocked.body)).toMatchObject({ status: 'in_progress', blockedReason: null });
    expect((await rowOf(stageId)).blocked_reason).toBeNull();
  });

  it('EVM-032 AC4 the reason of a block is visible to Tylko odczyt in the list (rodo.md: ProcedureStage is A/E/R)', async () => {
    const { orderId } = await oneStage({ status: 'blocked', blockedReason: 'Brak zgody wspólnoty' });
    const response = await listOf(await signIn('read_only'), orderId);
    expect((response.body as { items: Array<{ stages: StageBody[] }> }).items[0]?.stages[0]?.blockedReason).toBe('Brak zgody wspólnoty');
  });

  it('EVM-032 AC4 "Nie dotyczy" leaves the progress denominator, "Przywróć" brings the stage back to "Do zrobienia"; "Otwórz ponownie" clears the day of completion', async () => {
    const created = await order([
      { stages: [{ status: 'in_progress' }, { status: 'todo' }, { status: 'done', completedOn: '2026-10-01' }] },
    ]);
    const [running, , finished] = created.processes[0]?.stageIds ?? [];
    const editor = await signIn('editor');
    const progressOf = async () => ((await listOf(editor, created.id)).body as { items: Array<{ progress: unknown }> }).items[0]?.progress;
    expect(await progressOf()).toEqual({ done: 1, total: 3 });
    expect((await transition(editor, created.id, running ?? '', { to: 'not_applicable' })).status).toBe(200);
    expect(await progressOf()).toEqual({ done: 1, total: 2 });
    const restored = await transition(editor, created.id, running ?? '', { to: 'todo' }, { ifMatch: '"2"' });
    expect(stageOf(restored.body).status).toBe('todo');
    expect(await progressOf()).toEqual({ done: 1, total: 3 });
    const reopened = await transition(editor, created.id, finished ?? '', { to: 'in_progress' });
    expect(stageOf(reopened.body)).toMatchObject({ status: 'in_progress', completedOn: null });
    expect(await progressOf()).toEqual({ done: 0, total: 3 });
  });
});

describe('"Cofnij" is an ordinary move with parameters the user could give by hand (EVM-032 AC5; SR-API-07, SR-AUTHZ-10)', () => {
  it('EVM-032 AC5 in_progress > waiting, then the undo waiting > in_progress, then the undo of THAT (waiting again with the previous party and since: the counter is kept)', async () => {
    const osd = await insertParty(admin(), { displayName: 'Operator Syntetyczny' });
    const { orderId, stageId } = await oneStage({
      status: 'waiting',
      waitingOn: 'party',
      waitingOnPartyId: osd,
      waitingSince: '2026-09-18',
    });
    const editor = await signIn('editor');
    expect((await transition(editor, orderId, stageId, { to: 'in_progress' })).status).toBe(200);
    const undo = await transition(
      editor,
      orderId,
      stageId,
      { to: 'waiting', waitingOn: 'party', waitingOnPartyId: osd, waitingSince: '2026-09-18' },
      { ifMatch: '"2"' },
    );
    expect(undo.status, JSON.stringify(undo.body)).toBe(200);
    expect(stageOf(undo.body)).toMatchObject({
      status: 'waiting',
      waitingParty: { id: osd, displayName: 'Operator Syntetyczny' },
      waitingSince: '2026-09-18',
      waitingDays: 15,
      version: 3,
    });
  });

  it('EVM-032 AC5 the undo of "Zakończ", "Zablokuj", "Odblokuj", "Otwórz ponownie" and "Nie dotyczy" are the rows of the table with the previous day and reason', async () => {
    const editor = await signIn('editor');
    const done = await oneStage({ status: 'in_progress' });
    await transition(editor, done.orderId, done.stageId, { to: 'done', completedOn: '2026-10-01' });
    expect((await transition(editor, done.orderId, done.stageId, { to: 'in_progress' }, { ifMatch: '"2"' })).status).toBe(200);
    const redone = await transition(editor, done.orderId, done.stageId, { to: 'done', completedOn: '2026-10-01' }, { ifMatch: '"3"' });
    expect(stageOf(redone.body)).toMatchObject({ status: 'done', completedOn: '2026-10-01' });

    const blocked = await oneStage({ status: 'blocked', blockedReason: 'Brak zgody wspólnoty' });
    await transition(editor, blocked.orderId, blocked.stageId, { to: 'in_progress' });
    const reblocked = await transition(
      editor,
      blocked.orderId,
      blocked.stageId,
      { to: 'blocked', blockedReason: 'Brak zgody wspólnoty' },
      { ifMatch: '"2"' },
    );
    expect(stageOf(reblocked.body)).toMatchObject({ status: 'blocked', blockedReason: 'Brak zgody wspólnoty' });

    const plain = await oneStage({ status: 'todo' });
    await transition(editor, plain.orderId, plain.stageId, { to: 'not_applicable' });
    const back = await transition(editor, plain.orderId, plain.stageId, { to: 'todo' }, { ifMatch: '"2"' });
    expect(stageOf(back.body).status).toBe('todo');
  });

  it('EVM-032 AC5 an undo has no power of its own: it cannot carry a field the target does not take (400 not_allowed) and cannot restore a field that is not a parameter', async () => {
    const { orderId, stageId } = await oneStage({ status: 'waiting', waitingOn: 'customer', waitingSince: '2026-09-18' });
    const editor = await signIn('editor');
    const response = await transition(editor, orderId, stageId, { to: 'in_progress', waitingSince: '2026-09-18', blockedReason: 'x' });
    expect(response.status).toBe(400);
    expect(errorsOf(response.body)).toEqual([
      { pointer: '/waitingSince', code: 'not_allowed' },
      { pointer: '/blockedReason', code: 'not_allowed' },
    ]);
    for (const field of ['status', 'version', 'waitingParty', 'waitingDays', 'startedAt', 'name', 'id']) {
      const stranger = await transition(editor, orderId, stageId, { to: 'in_progress', [field]: 'x' });
      expect(errorsOf(stranger.body), field).toEqual([{ pointer: `/${field}`, code: 'read_only_field' }]);
    }
    expect(await rowOf(stageId)).toMatchObject({ status: 'waiting', version: 1 });
  });

  it("EVM-032 AC5 an undo that the server does not accept because somebody changed the stage meanwhile is 412 (a newer version) — and the other person's change stays", async () => {
    const { orderId, stageId } = await oneStage({ status: 'in_progress' });
    const editor = await signIn('editor');
    const colleague = await signIn('administrator');
    expect((await transition(editor, orderId, stageId, { to: 'waiting', waitingOn: 'customer' })).status).toBe(200);
    expect(
      (await transition(colleague, orderId, stageId, { to: 'blocked', blockedReason: 'Zmiana kolegi' }, { ifMatch: '"2"' })).status,
    ).toBe(200);
    const undo = await transition(editor, orderId, stageId, { to: 'in_progress' }, { ifMatch: '"2"' });
    expect(undo.status).toBe(412);
    expect(codeOf(undo.body)).toBe('version_conflict');
    expect(await rowOf(stageId)).toMatchObject({ status: 'blocked', version: 3, blocked_reason: 'Zmiana kolegi' });
  });
});

describe('the rules of the command (EVM-032 AC6; SR-API-07, SR-AUTHZ-02, SR-INPUT-01, CWE-639, CWE-915)', () => {
  it('EVM-032 AC6 If-Match: absent is 428; weak, a list, * or malformed is 400 at the header; a stale one is 412 — the data stay', async () => {
    const { orderId, stageId } = await oneStage({ status: 'in_progress' });
    const editor = await signIn('editor');
    const absent = await transition(editor, orderId, stageId, { to: 'done' }, { ifMatch: null });
    expect(absent.status).toBe(428);
    expect(codeOf(absent.body)).toBe('precondition_required');
    for (const bad of ['W/"1"', '*', '"1", "2"', '1', '"0"']) {
      const response = await transition(editor, orderId, stageId, { to: 'done' }, { ifMatch: bad });
      expect(response.status, bad).toBe(400);
      expect(errorsOf(response.body), bad).toEqual([{ pointer: '/headers/If-Match', code: 'invalid_format' }]);
    }
    const stale = await transition(editor, orderId, stageId, { to: 'done' }, { ifMatch: '"7"' });
    expect(stale.status).toBe(412);
    expect(codeOf(stale.body)).toBe('version_conflict');
    expect(JSON.stringify(stale.body)).not.toMatch(/"7"|in_progress/);
    expect(await rowOf(stageId)).toMatchObject({ status: 'in_progress', version: 1, completed_on: null });
  });

  it('EVM-032 AC6 a stale version and a move outside the table together are 412 (the client has to read the stage again), not 409', async () => {
    const { orderId, stageId } = await oneStage({ status: 'done', completedOn: '2026-10-01' });
    const response = await transition(await signIn('editor'), orderId, stageId, { to: 'blocked', blockedReason: 'x' }, { ifMatch: '"5"' });
    expect(response.status).toBe(412);
  });

  it('EVM-032 AC6 a body with `status` is 400 read_only_field (the status is changed by `to` only); a stranger is 400 unknown_field; __proto__ and constructor are refused; nothing is written', async () => {
    const { orderId, stageId } = await oneStage({ status: 'in_progress' });
    const editor = await signIn('editor');
    const status = await transition(editor, orderId, stageId, { to: 'done', status: 'done' });
    expect(errorsOf(status.body)).toEqual([{ pointer: '/status', code: 'read_only_field' }]);
    const onlyStatus = await transition(editor, orderId, stageId, { status: 'done' });
    expect(onlyStatus.status).toBe(400);
    expect(errorsOf(onlyStatus.body)).toEqual(
      expect.arrayContaining([
        { pointer: '/status', code: 'read_only_field' },
        { pointer: '/to', code: 'invalid_value' },
      ]),
    );
    const stranger = await transition(editor, orderId, stageId, { to: 'done', customerId: uuidv7() });
    expect(errorsOf(stranger.body)).toEqual([{ pointer: '/customerId', code: 'unknown_field' }]);
    for (const raw of ['{"to":"done","__proto__":{"status":"done"}}', '{"constructor":{"prototype":{"to":"done"}}}']) {
      const proto = await editor.panel
        .post(`${BASE}/${orderId}/procedure-stages/${stageId}/transitions`, undefined, { 'If-Match': '"1"' })
        .set('Content-Type', 'application/json')
        .send(raw);
      expect(proto.status, raw).toBe(400);
    }
    for (const to of ['archived', 'DONE', 7, null]) {
      const invalid = await transition(editor, orderId, stageId, { to });
      expect(invalid.status, String(to)).toBe(400);
    }
    expect(await rowOf(stageId)).toMatchObject({ status: 'in_progress', version: 1 });
  });

  it('EVM-032 AC6 an order that is settled — and one that is cancelled — is 409 work_order_closed for a move the table allows AND for one it does not; the stale version does not hide it; nothing is written', async () => {
    const editor = await signIn('editor');
    for (const status of ['settled', 'cancelled'] as const) {
      const { orderId, stageId } = await oneStage({ status: 'in_progress' }, { status });
      for (const [command, ifMatch] of [
        [{ to: 'done' }, '"1"'],
        [{ to: 'todo' }, '"1"'],
        [{ to: 'done' }, '"9"'],
      ] as const) {
        const response = await transition(editor, orderId, stageId, command, { ifMatch });
        expect(response.status, `${status} ${JSON.stringify(command)}`).toBe(409);
        expect(codeOf(response.body)).toBe('work_order_closed');
        expect(JSON.stringify(response.body)).not.toMatch(/settled|cancelled|in_progress/);
      }
      expect(await rowOf(stageId)).toMatchObject({ status: 'in_progress', version: 1 });
    }
  });

  it('EVM-032 AC6 the other statuses of an order allow the move: new, quoting, accepted, in progress, on hold and completed', async () => {
    const editor = await signIn('editor');
    for (const status of ['new', 'quoting', 'accepted', 'in_progress', 'on_hold', 'completed'] as const) {
      const { orderId, stageId } = await oneStage({}, { status });
      expect((await transition(editor, orderId, stageId, { to: 'in_progress' })).status, status).toBe(200);
    }
  });

  it('EVM-032 AC6 an order that is settled while the move waits for its lock: the decision is taken on the LOCKED row, so the move is 409 work_order_closed and nothing is written', async () => {
    const { orderId, stageId } = await oneStage({ status: 'in_progress' }, { status: 'completed' });
    const editor = await signIn('editor');
    let locked!: () => void;
    const hasLock = new Promise<void>((resolve) => (locked = resolve));
    let release!: () => void;
    const mayClose = new Promise<void>((resolve) => (release = resolve));
    const closing = admin()
      .transaction()
      .execute(async (inner) => {
        await sql`select 1 from work_orders.work_orders where id = ${orderId} for update`.execute(inner);
        locked();
        await mayClose;
        await sql`update work_orders.work_orders set status = 'settled', version = version + 1 where id = ${orderId}`.execute(inner);
      });
    await hasLock;
    const pending = transition(editor, orderId, stageId, { to: 'done' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await closing;
    const response = await pending;
    expect(codeOf(response.body)).toBe('work_order_closed');
    expect((await rowOf(stageId)).status).toBe('in_progress');
  });

  it('EVM-032 AC6 the stage of order B sent through the path of order A is 404 not_found — the SAME answer as a stage that does not exist, a deleted stage, a stage of a deleted process and a stage of a deleted order — whatever the If-Match and the body', async () => {
    const a = await order();
    const b = await order();
    const bStage = b.processes[0]?.stageIds[0] ?? '';
    const deletedOrder = await order([{}], { deleted: true });
    const deletedStage = await order([{ stages: [{ deletedAt: new Date('2026-10-02T08:00:00Z') }] }]);
    const deletedProcess = await order([{ deletedAt: new Date('2026-10-02T08:00:00Z') }]);
    const targets: Array<[string, string]> = [
      [a.id, bStage],
      [a.id, uuidv7()],
      [deletedOrder.id, deletedOrder.processes[0]?.stageIds[0] ?? ''],
      [deletedStage.id, deletedStage.processes[0]?.stageIds[0] ?? ''],
      [deletedProcess.id, deletedProcess.processes[0]?.stageIds[0] ?? ''],
      [uuidv7(), uuidv7()],
    ];
    const bodies = new Set<string>();
    for (const role of ['editor', 'administrator'] as const) {
      const browser = await signIn(role);
      for (const [orderId, stageId] of targets) {
        for (const [body, ifMatch] of [
          [{ to: 'done' }, '"1"'],
          [{ to: 'archived', status: 'x' }, 'W/"9"'],
          [{}, '"9"'],
        ] as const) {
          const response = await transition(browser, orderId, stageId, body, { ifMatch });
          expect(response.status, `${role} ${orderId}/${stageId}`).toBe(404);
          expect(codeOf(response.body)).toBe('not_found');
          bodies.add(withoutTrace(response.body));
        }
      }
    }
    expect(bodies.size).toBe(1);
    expect(await rowOf(bStage)).toMatchObject({ status: 'todo', version: 1 });
  });

  it('EVM-032 AC6 a malformed order id or stage id is 400 validation_failed, before the database', async () => {
    const editor = await signIn('editor');
    const response = await transition(editor, 'nie-uuid', uuidv7(), { to: 'done' });
    expect(response.status).toBe(400);
    const second = await transition(editor, uuidv7(), 'nie-uuid', { to: 'done' });
    expect(second.status).toBe(400);
  });

  it('EVM-032 AC6 two moves with the SAME ETag at once: one is 200, the other 412, the version rose by one and one event was written', async () => {
    const { orderId, stageId } = await oneStage({ status: 'in_progress' });
    const editor = await signIn('editor');
    const other = await signIn('administrator');
    const [first, second] = await Promise.all([
      transition(editor, orderId, stageId, { to: 'done' }),
      transition(other, orderId, stageId, { to: 'not_applicable' }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 412]);
    expect((await rowOf(stageId)).version).toBe(2);
    expect(await auditOf(stageId)).toHaveLength(1);
  });
});

describe('who may move a stage (EVM-032 AC7; SR-AUTHZ-01, SR-AUTHZ-05, SR-AUTHZ-12)', () => {
  it('EVM-032 AC7 no session is 401 before the body; the mobile channel is 403; a missing or wrong CSRF token is 403 csrf_failed — the stage is untouched', async () => {
    const { orderId, stageId } = await oneStage({ status: 'in_progress' });
    const target = `${BASE}/${orderId}/procedure-stages/${stageId}/transitions`;
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    const noSession = await anonymous.post(target, { to: 'done' }, { 'If-Match': '"1"' });
    expect(noSession.status).toBe(401);
    expect(codeOf(noSession.body)).toBe('unauthenticated');

    const mobile = await signIn('editor', 'mobile');
    const onMobile = await transition(mobile, orderId, stageId, { to: 'done' });
    expect(onMobile.status).toBe(403);
    expect(codeOf(onMobile.body)).toBe('forbidden');

    const editor = await signIn('editor');
    const wrongToken = await editor.panel.post(target, { to: 'done' }, { 'If-Match': '"1"' }).set('X-CSRF-Token', 'zly-token');
    expect(codeOf(wrongToken.body)).toBe('csrf_failed');
    const noToken = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    noToken.cookie = editor.panel.cookie;
    const withoutToken = await noToken.post(target, { to: 'done' }, { 'If-Match': '"1"' });
    expect(withoutToken.status).toBe(403);
    expect(codeOf(withoutToken.body)).toBe('csrf_failed');
    expect(await rowOf(stageId)).toMatchObject({ status: 'in_progress', version: 1 });
  });

  it('EVM-032 AC7 the change of the party (PATCH) has the same matrix: Tylko odczyt 403 before If-Match and the body, anonymous 401, mobile 403, A and E 200', async () => {
    const { orderId, stageId } = await oneStage({ status: 'waiting', waitingOn: 'customer', waitingSince: '2026-09-18' });
    const reader = await signIn('read_only');
    for (const [body, ifMatch] of [
      [{ waitingOn: 'customer' }, '"1"'],
      [{ status: 'x' }, 'W/"1"'],
      [{}, null],
    ] as const) {
      const response = await patchStage(reader, orderId, stageId, body, { ifMatch });
      expect(response.status).toBe(403);
      expect(codeOf(response.body)).toBe('forbidden');
    }
    const anonymous = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    expect(
      (await anonymous.patch(`${BASE}/${orderId}/procedure-stages/${stageId}`, { waitingOn: 'customer' }, { 'If-Match': '"1"' })).status,
    ).toBe(401);
    const mobile = await signIn('editor', 'mobile');
    expect(codeOf((await patchStage(mobile, orderId, stageId, { waitingOn: 'customer' })).body)).toBe('forbidden');
    expect((await patchStage(await signIn('editor'), orderId, stageId, { waitingOn: 'customer' })).status).toBe(200);
    expect((await patchStage(await signIn('administrator'), orderId, stageId, { waitingOn: 'customer' }, { ifMatch: '"2"' })).status).toBe(
      200,
    );
    expect(await rowOf(stageId)).toMatchObject({ version: 3 });
  });
});

describe('the idempotency of the move (EVM-032 AC6; SR-API-05, SR-API-06, ASVS V2.3.1, CWE-841)', () => {
  it('EVM-032 AC6 a repeat (same key, stage and body) is 200 with Idempotent-Replayed, no second move, no second audit event — even with an If-Match that is stale by now', async () => {
    const { orderId, stageId } = await oneStage({ status: 'in_progress' });
    const editor = await signIn('editor');
    const key = uuidv7();
    const first = await transition(editor, orderId, stageId, { to: 'waiting', waitingOn: 'customer' }, { key });
    expect(first.status).toBe(200);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    const repeat = await transition(editor, orderId, stageId, { to: 'waiting', waitingOn: 'customer' }, { key });
    expect(repeat.status, JSON.stringify(repeat.body)).toBe(200);
    expect(repeat.headers['idempotent-replayed']).toBe('true');
    expect(repeat.headers['etag']).toBe('"2"');
    expect(stageOf(repeat.body)).toMatchObject({ status: 'waiting', version: 2 });
    expect(await auditOf(stageId)).toHaveLength(1);
    expect(await auditTotal('procedure_stage.transitioned')).toBe(auditBaseline + 1);
  });

  it('EVM-032 AC6 the same key with another body is 422 idempotency_mismatch; the key is bound to the STAGE: the same key and body on ANOTHER stage is 422, never a replay', async () => {
    const created = await order([{ stages: [{ status: 'in_progress' }, { status: 'in_progress' }] }]);
    const [one, two] = created.processes[0]?.stageIds ?? [];
    const editor = await signIn('editor');
    const key = uuidv7();
    expect((await transition(editor, created.id, one ?? '', { to: 'done' }, { key })).status).toBe(200);
    const otherBody = await transition(editor, created.id, one ?? '', { to: 'not_applicable' }, { key });
    expect(otherBody.status).toBe(422);
    expect(codeOf(otherBody.body)).toBe('idempotency_mismatch');
    const otherStage = await transition(editor, created.id, two ?? '', { to: 'done' }, { key });
    expect(otherStage.status).toBe(422);
    expect(codeOf(otherStage.body)).toBe('idempotency_mismatch');
    expect(await rowOf(two ?? '')).toMatchObject({ status: 'in_progress', version: 1 });
  });

  it('EVM-032 AC6 a failed move leaves no record that would block the retry with the same key, and a key that is not a UUIDv7 is 400', async () => {
    const { orderId, stageId } = await oneStage({ status: 'in_progress' });
    const editor = await signIn('editor');
    const key = uuidv7();
    expect((await transition(editor, orderId, stageId, { to: 'done' }, { key, ifMatch: '"9"' })).status).toBe(412);
    expect(await idempotencyTotal()).toBe(0);
    expect((await transition(editor, orderId, stageId, { to: 'done' }, { key })).status).toBe(200);
    expect(await idempotencyTotal()).toBe(1);
    const bad = await transition(editor, orderId, stageId, { to: 'done' }, { key: 'nie-uuid' });
    expect(bad.status).toBe(400);
  });

  it('EVM-032 AC6 SR-DATA-02 the record of idempotency is minimal: the status, the code and the id of the stage — not the reason of a block, not the party', async () => {
    const osd = await insertParty(admin(), { displayName: 'Operator Poufny' });
    const { orderId, stageId } = await oneStage({ status: 'in_progress' });
    const editor = await signIn('editor');
    await transition(editor, orderId, stageId, { to: 'blocked', blockedReason: 'powod-poufny-xyz' }, { key: uuidv7() });
    await transition(editor, orderId, stageId, { to: 'in_progress' }, { key: uuidv7(), ifMatch: '"2"' });
    await transition(
      editor,
      orderId,
      stageId,
      { to: 'waiting', waitingOn: 'party', waitingOnPartyId: osd },
      { key: uuidv7(), ifMatch: '"3"' },
    );
    const { rows } = await sql<Record<string, unknown>>`select * from platform.idempotency_records`.execute(admin());
    expect(rows).toHaveLength(3);
    expect(JSON.stringify(rows)).not.toMatch(/powod-poufny|Poufny|Operator/);
    expect(JSON.stringify(rows)).not.toContain(osd);
  });
});

describe('the audit trail, the log and the exposure of data (EVM-032 AC2, AC6; SR-LOG-02, SR-LOG-03, SR-DATA-02)', () => {
  it('EVM-032 SR-LOG-03 the trail has ONE procedure_stage.transitioned with the actor, the stage, the outcome and the trace — and no reason, no party, no id of the party, no day', async () => {
    const osd = await insertParty(admin(), { displayName: 'Operator Poufny' });
    const { orderId, stageId } = await oneStage({ status: 'in_progress' });
    const editor = await signIn('editor');
    expect(
      (await transition(editor, orderId, stageId, { to: 'waiting', waitingOn: 'party', waitingOnPartyId: osd, waitingSince: '2026-09-18' }))
        .status,
    ).toBe(200);
    expect(
      (await transition(editor, orderId, stageId, { to: 'blocked', blockedReason: 'powod-poufny-xyz' }, { ifMatch: '"2"' })).status,
    ).toBe(200);
    const events = await auditOf(stageId);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      action: 'procedure_stage.transitioned',
      outcome: 'success',
      actor_type: 'user',
      actor_user_id: editor.userId,
      object_type: 'procedure_stage',
      object_id: stageId,
      origin: 'web',
    });
    expect(String(events[0]?.['trace_id'])).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(events)).not.toMatch(/Poufny|powod-poufny|2026-09-18|waiting|blocked|in_progress/);
    expect(JSON.stringify(events)).not.toContain(osd);
    expect(await auditTotal('procedure_stage.transitioned')).toBe(auditBaseline + 2);
  });

  it('EVM-032 K7 the update, the audit and the idempotency record are ONE transaction: a failing audit write leaves the stage as it was and the key free', async () => {
    const { orderId, stageId } = await oneStage({ status: 'in_progress' });
    const editor = await signIn('editor');
    await sql`create or replace function public.evm032_reject_audit() returns trigger language plpgsql as $$ begin raise exception 'audit write refused'; end $$`.execute(
      admin(),
    );
    await sql`create trigger evm032_reject_audit before insert on audit.events for each row when (new.action = 'procedure_stage.transitioned') execute function public.evm032_reject_audit()`.execute(
      admin(),
    );
    try {
      const key = uuidv7();
      const failed = await transition(editor, orderId, stageId, { to: 'blocked', blockedReason: 'powod-poufny-xyz' }, { key });
      expect(failed.status).toBe(500);
      expect(await rowOf(stageId)).toMatchObject({ status: 'in_progress', version: 1, blocked_reason: null });
      expect(await idempotencyTotal()).toBe(0);
    } finally {
      await sql`drop trigger evm032_reject_audit on audit.events`.execute(admin());
      await sql`drop function public.evm032_reject_audit()`.execute(admin());
    }
    expect((await transition(editor, orderId, stageId, { to: 'done' })).status).toBe(200);
  });

  it('EVM-032 SR-LOG-02 nothing about the reason, the party or the days reaches the log of the API — not a value, not a rejected one', async () => {
    const osd = await insertParty(admin(), { displayName: 'Operator Poufny' });
    const { orderId, stageId } = await oneStage({ status: 'in_progress' });
    const editor = await signIn('editor');
    const before = current.logs.lines.length;
    await transition(editor, orderId, stageId, { to: 'blocked', blockedReason: 'powod-poufny-xyz' });
    await transition(editor, orderId, stageId, { to: 'blocked', blockedReason: 'powod-odrzucony-xyz\u0007' }, { ifMatch: '"2"' });
    await transition(editor, orderId, stageId, { to: 'in_progress', blockedReason: 'powod-niedozwolony-xyz' }, { ifMatch: '"2"' });
    await transition(editor, orderId, stageId, { to: 'in_progress' }, { ifMatch: '"2"' });
    await transition(
      editor,
      orderId,
      stageId,
      { to: 'waiting', waitingOn: 'party', waitingOnPartyId: osd, waitingSince: '2026-09-18' },
      { ifMatch: '"3"' },
    );
    await patchStage(
      editor,
      orderId,
      stageId,
      { waitingOn: 'party', waitingOnPartyId: uuidv7(), waitingSince: '2027-01-01' },
      { ifMatch: '"4"' },
    );
    await listOf(editor, orderId);
    const logged = current.logs.lines.slice(before).join('\n');
    expect(logged).not.toMatch(/poufny|Poufny|powod-|2026-09-18|2027-01-01/);
    expect(logged).not.toContain(osd);
  });

  it('EVM-032 SR-DATA-02 the party in the list, in the transition and in the change is { id, displayName } only — checked on the three answers', async () => {
    const osd = await insertParty(admin(), {
      displayName: 'Operator Syntetyczny',
      phone: '+48600100200',
      email: 'kontakt@operator.example.invalid',
      notes: 'notatka-strony-xyz',
    });
    const { orderId, stageId } = await oneStage({ status: 'in_progress' });
    const editor = await signIn('editor');
    const moved = await transition(editor, orderId, stageId, { to: 'waiting', waitingOn: 'party', waitingOnPartyId: osd });
    const changed = await patchStage(editor, orderId, stageId, { waitingOn: 'party', waitingOnPartyId: osd }, { ifMatch: '"2"' });
    const listed = await listOf(await signIn('read_only'), orderId);
    for (const response of [moved, changed])
      expect(Object.keys(stageOf(response.body).waitingParty ?? {}).sort()).toEqual(['displayName', 'id']);
    const listedStage = (listed.body as { items: Array<{ stages: StageBody[] }> }).items[0]?.stages[0];
    expect(Object.keys(listedStage?.waitingParty ?? {}).sort()).toEqual(['displayName', 'id']);
    expect(JSON.stringify([moved.body, changed.body, listed.body])).not.toMatch(/600100200|operator\.example|notatka-strony|search_text/);
  });
});
