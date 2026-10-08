import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkOrderTransitionRegistry, type WorkOrderTransitionParticipant } from '../../src/modules/work-orders/index.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, ISSUED_AT, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation, insertWorkOrders } from '../support/work-order-fixtures.ts';
import type { WorkOrderStatus } from '../../src/modules/work-orders/domain/work-order-list-query.ts';

let current: IdentityApp;
let customerId: string;
let siteId: string;
let coordinatorId: string;

/** A participant of the test: what it answers is set by the test that needs it (the real ones arrive with EVM-053 and EVM-054). */
const probe = {
  unmet: undefined as string | undefined,
  failApply: false,
  applied: [] as string[],
  checked: [] as string[],
};
const PROBE: WorkOrderTransitionParticipant = {
  name: 'test-probe',
  order: 1,
  check: (_tx, context) => {
    probe.checked.push(`${context.from}>${context.to}`);
    return Promise.resolve(probe.unmet);
  },
  apply: (tx, context) => {
    probe.applied.push(`${context.from}>${context.to}`);
    if (probe.failApply) return Promise.reject(new Error('the participant failed'));
    return sql`select 1`.execute(tx).then(() => undefined);
  },
};

beforeAll(async () => {
  current = await createIdentityApp({ env: { TRUSTED_PROXIES: '127.0.0.1,::1,::ffff:127.0.0.1' } }); // so that the limit test has an address of its own
  current.app.get(WorkOrderTransitionRegistry).register(PROBE);
  customerId = await insertCustomer(current.database.admin, { firstName: 'Jan', lastName: 'Przykładowy' });
  siteId = await insertSite(current.database.admin);
  coordinatorId = (await createUser(current.database.admin, current.clock, { role: 'editor', displayName: 'Anna Testowa' })).id;
});
afterAll(async () => {
  await current.close();
});
let tests = 0;
let auditBaseline = 0;
beforeEach(async () => {
  tests += 1;
  current.clock.set(new Date(Date.parse(ISSUED_AT) + tests * 61_000)); // a new minute for every test: the per-address limit never adds up
  auditBaseline = await auditCount();
  await clearWorkOrderCreation(current.database.admin);
  probe.unmet = undefined;
  probe.failApply = false;
  probe.applied.length = 0;
  probe.checked.length = 0;
});

const BASE = '/api/v1/work-orders';
const admin = () => current.database.admin;
/** A marker that would betray the reason wherever it leaked to (SR-LOG-02, SR-DATA-01). */
const REASON_MARKER = 'powod-znacznik-synt';

type PasskeyState = 'fresh' | 'stale' | 'none';
async function signIn(role: Role = 'editor', options: { channel?: 'web' | 'mobile'; passkey?: PasskeyState; passkeyAgeMs?: number } = {}) {
  const user = await createUser(admin(), current.clock, { role });
  const age = options.passkeyAgeMs ?? (options.passkey === 'stale' ? 16 * 60_000 : 0);
  const session = await createSession(admin(), current.clock, user, {
    channel: options.channel ?? 'web',
    ...(options.passkey === 'none' || (options.passkey === undefined && options.passkeyAgeMs === undefined)
      ? {}
      : { passkeyAuthenticatedAt: new Date(current.clock.now().getTime() - age) }),
  });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}
type Browser = Awaited<ReturnType<typeof signIn>>;

let sequence = 0;
interface OrderState {
  readonly resumeStatus?: string | undefined;
  readonly completedOn?: string | undefined;
  readonly closedAt?: string | undefined;
  readonly deletedAt?: Date | undefined;
}
async function orderIn(status: WorkOrderStatus, state: OrderState = {}): Promise<string> {
  sequence += 1;
  const ids = await insertWorkOrders(admin(), [
    {
      number: `ZL-2026-${String(sequence).padStart(4, '0')}`,
      status,
      customerId,
      siteId,
      coordinatorId,
      ...(state.deletedAt ? { deletedAt: state.deletedAt } : {}),
    },
  ]);
  const id = [...ids.values()][0] ?? '';
  const closed = state.closedAt ?? (status === 'settled' || status === 'cancelled' ? '2026-10-01T07:00:00Z' : null);
  await sql`update work_orders.work_orders set resume_status = ${state.resumeStatus ?? null}, completed_on = ${state.completedOn ?? null},
            closed_at = ${closed} where id = ${id}`.execute(admin());
  return id;
}

interface Row {
  status: string;
  resume_status: string | null;
  status_reason: string | null;
  status_changed_at: Date | null;
  closed_at: Date | null;
  completed_on: string | null;
  version: number;
  updated_by: string | null;
}
async function rowOf(id: string): Promise<Row> {
  const { rows } = await sql<Row>`select status, resume_status, status_reason, status_changed_at, closed_at,
    to_char(completed_on, 'YYYY-MM-DD') as completed_on, version, updated_by from work_orders.work_orders where id = ${id}`.execute(
    admin(),
  );
  const [row] = rows;
  if (row === undefined) throw new Error('no such order');
  return row;
}

interface SendOptions {
  /** `null` — no header; absent — the version the order has now. */
  readonly ifMatch?: string | null;
  readonly key?: string;
  readonly path?: string;
  /** The client address behind the trusted proxy: its own bucket of the per-address limit. */
  readonly forwardedFor?: string;
}
async function send(browser: Browser, id: string, body: unknown, options: SendOptions = {}) {
  const ifMatch = options.ifMatch === undefined ? `"${(await rowOf(id)).version}"` : options.ifMatch;
  let call = browser.panel.post(options.path ?? `${BASE}/${id}/transitions`, body);
  if (ifMatch !== null) call = call.set('If-Match', ifMatch);
  if (options.key !== undefined) call = call.set('Idempotency-Key', options.key);
  if (options.forwardedFor !== undefined) call = call.set('X-Forwarded-For', options.forwardedFor);
  return call;
}
const go = (browser: Browser, id: string, to: string, extra: Record<string, unknown> = {}, options: SendOptions = {}) =>
  send(browser, id, { to, ...extra }, options);

const errorsOf = (body: unknown) => (body as { errors?: Array<{ pointer: string; code: string }> }).errors;
const codeOf = (body: unknown) => (body as { code?: string }).code;
const withoutTrace = (body: unknown): string => JSON.stringify(body).replace(/"traceId":"[0-9a-f]+"/, '');
const auditOf = async (objectId: string) =>
  (await sql<Record<string, unknown>>`select * from audit.events where object_id = ${objectId} order by occurred_at, id`.execute(admin()))
    .rows;
const auditCount = async (): Promise<number> =>
  Number(
    (await sql<{ n: string }>`select count(*)::text as n from audit.events where action like 'work_order.%'`.execute(admin())).rows[0]?.n,
  );
/** Events written by THIS test (the trail is append-only: it cannot be emptied between tests). */
const auditDelta = async (): Promise<number> => (await auditCount()) - auditBaseline;
const idempotencyRecords = async (): Promise<number> =>
  Number((await sql<{ n: string }>`select count(*)::text as n from platform.idempotency_records`.execute(admin())).rows[0]?.n);

describe('the way from "Nowe" to "Rozliczone" (EVM-030 AC1; SR-API-07)', () => {
  it('EVM-030 AC1 "Zaakceptuj bez wyceny", "Rozpocznij realizację", "Zakończ", "Rozlicz" take an order from new to settled; every step is 200 with the new status, the next ETag and the menu for the role', async () => {
    const id = await orderIn('new');
    const editor = await signIn('editor');
    const steps: Array<[string, string[]]> = [
      ['accepted', ['in_progress', 'on_hold', 'cancelled']],
      ['in_progress', ['completed', 'on_hold', 'cancelled']],
      ['completed', ['in_progress', 'settled']],
      ['settled', []],
    ];
    let version = 1;
    for (const [to, menu] of steps) {
      const response = await go(editor, id, to, {}, { ifMatch: `"${version}"` });
      expect(response.status, `${to}: ${JSON.stringify(response.body)}`).toBe(200);
      version += 1;
      expect(response.headers['etag']).toBe(`"${version}"`);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['idempotent-replayed']).toBeUndefined();
      expect(response.body).toMatchObject({ id, status: to, version, allowedTransitions: menu });
    }
    expect(await rowOf(id)).toMatchObject({ status: 'settled', version: 5, updated_by: editor.userId });
  });

  it('EVM-030 AC1 the other way: "Rozpocznij wycenę" and then "Zaakceptuj" reach "Zaakceptowane"; the answer is the header of W-06 with the customer, the site and the coordinator', async () => {
    const id = await orderIn('new');
    const editor = await signIn('editor');
    expect((await go(editor, id, 'quoting')).body).toMatchObject({
      status: 'quoting',
      allowedTransitions: ['accepted', 'on_hold', 'cancelled'],
    });
    const response = await go(editor, id, 'accepted');
    expect(response.body).toMatchObject({
      status: 'accepted',
      customer: { id: customerId, displayName: 'Jan Przykładowy' },
      site: { id: siteId },
      coordinator: { id: coordinatorId, displayName: 'Anna Testowa' },
    });
    expect(Object.keys(response.body as object).sort()).toEqual(
      [
        'allowedTransitions',
        'coordinator',
        'createdAt',
        'customer',
        'id',
        'number',
        'site',
        'status',
        'statusChangedAt',
        'title',
        'version',
      ].sort(),
    );
  });

  it('EVM-030 AC1 "Zakończ" without a day completes TODAY in Europe/Warsaw (23:30 UTC in October is already tomorrow there); the time of the change is recorded', async () => {
    const id = await orderIn('in_progress');
    current.clock.set('2026-10-08T22:30:00.000Z'); // 2026-10-09 00:30 CEST
    const response = await go(await signIn('editor'), id, 'completed');
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ status: 'completed', completedOn: '2026-10-09', statusChangedAt: '2026-10-08T22:30:00.000Z' });
    expect((await rowOf(id)).completed_on).toBe('2026-10-09');
  });

  it('EVM-030 AC1 "Zakończ" with a day keeps it (today and 2000-01-01 are the bounds); a day in the future, before 2000 or not a date is 400 with a code and never the value', async () => {
    const editor = await signIn('editor');
    for (const [day, status] of [
      ['2026-10-01', 200],
      ['2000-01-01', 200],
      ['2026-10-02', 400],
      ['1999-12-31', 400],
    ] as const) {
      const id = await orderIn('in_progress');
      const response = await go(editor, id, 'completed', { completedOn: day });
      expect(response.status, day).toBe(status);
      if (status === 200) expect(response.body).toMatchObject({ completedOn: day });
      else {
        expect(errorsOf(response.body)).toEqual([{ pointer: '/completedOn', code: 'out_of_range' }]);
        expect(JSON.stringify(response.body)).not.toContain(day);
        expect(await rowOf(id)).toMatchObject({ status: 'in_progress', version: 1, completed_on: null });
      }
    }
    const id = await orderIn('in_progress');
    const malformed = await go(editor, id, 'completed', { completedOn: '2026-02-30' });
    expect(malformed.status).toBe(400);
    expect(errorsOf(malformed.body)?.[0]).toMatchObject({ pointer: '/completedOn' });
  });

  it('EVM-030 AC1 "Otwórz ponownie" returns a completed order to "W realizacji" and clears the day of completion; completing again sets a new one', async () => {
    const id = await orderIn('completed', { completedOn: '2026-09-30' });
    const editor = await signIn('editor');
    expect((await go(editor, id, 'in_progress')).body).toMatchObject({ status: 'in_progress' });
    expect((await rowOf(id)).completed_on).toBeNull();
    expect((await getHeader(editor, id)).completedOn).toBeUndefined();
    expect((await go(editor, id, 'completed', { completedOn: '2026-10-01' })).body).toMatchObject({ completedOn: '2026-10-01' });
  });

  it('EVM-030 AC1 "Rozlicz" sets the closing time and a settled order shows it; the completion day stays', async () => {
    const id = await orderIn('completed', { completedOn: '2026-09-30' });
    current.clock.set('2026-10-05T10:15:30.250Z');
    const response = await go(await signIn('administrator'), id, 'settled');
    expect(response.body).toMatchObject({
      status: 'settled',
      closedAt: '2026-10-05T10:15:30.250Z',
      completedOn: '2026-09-30',
      allowedTransitions: ['completed'],
    });
    expect(await rowOf(id)).toMatchObject({ closed_at: new Date('2026-10-05T10:15:30.250Z'), completed_on: '2026-09-30' });
  });
});

async function getHeader(browser: Browser, id: string) {
  const response = await browser.panel.get(`${BASE}/${id}`);
  expect(response.status).toBe(200);
  return response.body as Record<string, unknown>;
}

describe('hold and resumption (EVM-030 AC2; SR-INPUT-01, SR-DATA-01)', () => {
  it('EVM-030 AC2 "Wstrzymaj…" from every active status keeps where the order was; "Wznów" returns to exactly that status and clears the hold', async () => {
    const editor = await signIn('editor');
    for (const status of ['new', 'quoting', 'accepted', 'in_progress'] as const) {
      const id = await orderIn(status);
      const held = await go(editor, id, 'on_hold', { reason: 'Czekamy na decyzję' });
      expect(held.status, status).toBe(200);
      expect(held.body).toMatchObject({ status: 'on_hold', resumeStatus: status, allowedTransitions: [status, 'cancelled'] });
      expect(await rowOf(id)).toMatchObject({ status: 'on_hold', resume_status: status, status_reason: 'Czekamy na decyzję' });
      const resumed = await go(editor, id, status);
      expect(resumed.status, status).toBe(200);
      expect(resumed.body).toMatchObject({ status });
      expect((resumed.body as Record<string, unknown>)['resumeStatus']).toBeUndefined();
      expect(await rowOf(id)).toMatchObject({ status, resume_status: null, status_reason: null });
    }
  });

  it('EVM-030 AC2 a resumption to any other status than the one the order was held from is 409 invalid_state_transition and changes nothing', async () => {
    const id = await orderIn('on_hold', { resumeStatus: 'quoting' });
    const editor = await signIn('editor');
    for (const to of ['new', 'accepted', 'in_progress', 'completed', 'settled', 'on_hold']) {
      const response = await go(editor, id, to);
      expect(response.status, to).toBe(409);
      expect(codeOf(response.body)).toBe('invalid_state_transition');
    }
    expect(await rowOf(id)).toMatchObject({ status: 'on_hold', version: 1 });
    expect((await go(editor, id, 'quoting')).status).toBe(200);
  });

  it('EVM-030 AC2 an order on hold with no resume status cannot be resumed (409), only cancelled', async () => {
    const id = await orderIn('on_hold');
    const editor = await signIn('editor');
    expect((await go(editor, id, 'new')).status).toBe(409);
    expect((await go(editor, id, 'cancelled', { reason: 'Rezygnacja' })).status).toBe(200);
  });

  it('EVM-030 AC2 the reason is required: absent, empty and spaces only are 400 "required" at /reason, and nothing changes', async () => {
    const id = await orderIn('in_progress');
    const editor = await signIn('editor');
    for (const extra of [{}, { reason: '' }, { reason: '   ' }]) {
      const response = await go(editor, id, 'on_hold', extra);
      expect(response.status, JSON.stringify(extra)).toBe(400);
      expect(errorsOf(response.body)).toEqual([{ pointer: '/reason', code: 'required' }]);
    }
    expect(await rowOf(id)).toMatchObject({ status: 'in_progress', version: 1, status_reason: null });
  });

  it('EVM-030 AC2 500 characters are accepted, 501 are "too_long" (the answer never repeats the text); the reason is stored NFC and trimmed', async () => {
    const editor = await signIn('editor');
    const first = await orderIn('in_progress');
    expect((await go(editor, first, 'on_hold', { reason: 'a'.repeat(500) })).status).toBe(200);

    const second = await orderIn('in_progress');
    const tooLong = await go(editor, second, 'on_hold', { reason: `${REASON_MARKER}${'a'.repeat(501)}` });
    expect(tooLong.status).toBe(400);
    expect(errorsOf(tooLong.body)).toEqual([{ pointer: '/reason', code: 'too_long' }]);
    expect(JSON.stringify(tooLong.body)).not.toContain(REASON_MARKER);

    const third = await orderIn('in_progress');
    await go(editor, third, 'on_hold', { reason: `  Sié rozmyslil  ` });
    expect((await rowOf(third)).status_reason).toBe('Sié rozmyslil'.normalize('NFC'));
  });

  it('EVM-030 AC2 a control character in the reason is 400 "invalid_characters" without the text', async () => {
    const id = await orderIn('in_progress');
    const response = await go(await signIn('editor'), id, 'on_hold', { reason: `${REASON_MARKER}\u0007` });
    expect(response.status).toBe(400);
    expect(errorsOf(response.body)).toEqual([{ pointer: '/reason', code: 'invalid_characters' }]);
    expect(JSON.stringify(response.body)).not.toContain(REASON_MARKER);
  });

  it('EVM-030 AC1 a transition that takes no reason refuses one (400 "not_allowed"), so a reason is never kept silently', async () => {
    const id = await orderIn('new');
    const response = await go(await signIn('editor'), id, 'accepted', { reason: 'po co' });
    expect(response.status).toBe(400);
    expect(errorsOf(response.body)).toEqual([{ pointer: '/reason', code: 'not_allowed' }]);
    expect(await rowOf(id)).toMatchObject({ status: 'new', version: 1 });
  });

  it('EVM-030 AC1 the day of completion is refused (400 "not_allowed") on a transition that does not complete', async () => {
    const id = await orderIn('new');
    const response = await go(await signIn('editor'), id, 'accepted', { completedOn: '2026-10-01' });
    expect(errorsOf(response.body)).toEqual([{ pointer: '/completedOn', code: 'not_allowed' }]);
  });
});

describe('cancellation (EVM-030 AC3; SR-LOG-03, SR-DATA-01)', () => {
  it('EVM-030 AC3 "Anuluj zlecenie…" from an active status and from a hold: status cancelled, the closing time is set, the reason is stored, the status it came from is kept', async () => {
    current.clock.set('2026-10-05T10:15:30.250Z');
    const editor = await signIn('editor');
    const fromActive = await orderIn('in_progress');
    const response = await go(editor, fromActive, 'cancelled', { reason: 'Klient zrezygnował' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({
      status: 'cancelled',
      closedAt: '2026-10-05T10:15:30.250Z',
      resumeStatus: 'in_progress',
      allowedTransitions: [],
    });
    expect(await rowOf(fromActive)).toMatchObject({
      status: 'cancelled',
      resume_status: 'in_progress',
      status_reason: 'Klient zrezygnował',
    });

    const fromHold = await orderIn('on_hold', { resumeStatus: 'quoting' });
    expect((await go(editor, fromHold, 'cancelled', { reason: 'Brak decyzji' })).status).toBe(200);
    expect(await rowOf(fromHold)).toMatchObject({ status: 'cancelled', resume_status: 'quoting', status_reason: 'Brak decyzji' });
  });

  it('EVM-030 AC3 the reason is required to cancel (400 "required"); a completed order cannot be cancelled (409)', async () => {
    const editor = await signIn('editor');
    const id = await orderIn('accepted');
    const missing = await go(editor, id, 'cancelled');
    expect(missing.status).toBe(400);
    expect(errorsOf(missing.body)).toEqual([{ pointer: '/reason', code: 'required' }]);
    const completed = await orderIn('completed');
    expect((await go(editor, completed, 'cancelled', { reason: 'za późno' })).status).toBe(409);
  });

  it('EVM-030 AC3 the audit trail has ONE event work_order.cancelled with the actor, the order and the trace — and not a word of the reason', async () => {
    const id = await orderIn('in_progress');
    const editor = await signIn('editor');
    expect((await go(editor, id, 'cancelled', { reason: `Klient: ${REASON_MARKER}` })).status).toBe(200);
    const events = await auditOf(id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'work_order.cancelled',
      outcome: 'success',
      actor_type: 'user',
      actor_user_id: editor.userId,
      object_type: 'work_order',
      object_id: id,
      origin: 'web',
    });
    expect(String(events[0]?.['trace_id'])).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(events)).not.toContain(REASON_MARKER);
  });

  it('EVM-030 AC3 only the cancellation and the restoration are audited: the other transitions leave no event', async () => {
    const editor = await signIn('editor');
    const id = await orderIn('new');
    for (const [to, extra] of [
      ['accepted', {}],
      ['in_progress', {}],
      ['on_hold', { reason: 'Przerwa' }],
      ['in_progress', {}],
      ['completed', {}],
      ['settled', {}],
    ] as const) {
      expect((await go(editor, id, to, extra)).status, to).toBe(200);
    }
    expect(await auditOf(id)).toEqual([]);
  });

  it('EVM-030 AC3 AC8 the reason is in no log, no audit record, no idempotency record, no answer and no error — only in the column of the order', async () => {
    const editor = await signIn('editor');
    const before = current.logs.lines.length;
    const held = await orderIn('in_progress');
    const keyed = uuidv7();
    const responses = [
      await go(editor, held, 'on_hold', { reason: `Powód ${REASON_MARKER}` }, { key: keyed }),
      await go(editor, held, 'on_hold', { reason: `Powód ${REASON_MARKER}` }, { key: keyed }), // the replay
      await go(editor, held, 'on_hold', { reason: `Powód ${REASON_MARKER}` }), // 409: it is on hold already
      await go(editor, held, 'accepted', { reason: `Powód ${REASON_MARKER}` }), // 409
      await go(editor, await orderIn('new'), 'accepted', { reason: `Powód ${REASON_MARKER}` }), // 400 not_allowed
      await go(editor, await orderIn('new'), 'cancelled', { reason: `${REASON_MARKER}${'x'.repeat(600)}` }), // 400 too_long
      await go(editor, await orderIn('new'), 'cancelled', { reason: `Powód ${REASON_MARKER}` }, { ifMatch: '"99"' }), // 412
      await go(editor, await orderIn('new'), 'cancelled', { reason: `Powód ${REASON_MARKER}` }, { ifMatch: null }), // 428
      await go(editor, await orderIn('new'), 'cancelled', { reason: `Powód ${REASON_MARKER}`, status: 'settled' }), // 400 read_only_field
    ];
    expect(responses.map((response) => response.status)).toEqual([200, 200, 409, 409, 400, 400, 412, 428, 400]);
    for (const response of responses) {
      expect(JSON.stringify(response.body), String(response.status)).not.toContain(REASON_MARKER);
      expect(JSON.stringify(response.headers)).not.toContain(REASON_MARKER);
    }
    expect(current.logs.lines.slice(before).join('\n')).not.toContain(REASON_MARKER);
    const audit = await sql`select to_jsonb(t)::text as row from audit.events t`.execute(admin());
    expect(JSON.stringify(audit.rows)).not.toContain(REASON_MARKER);
    const records = await sql`select to_jsonb(t)::text as row from platform.idempotency_records t`.execute(admin());
    expect(records.rows).toHaveLength(1);
    expect(JSON.stringify(records.rows)).not.toContain(REASON_MARKER);
    expect((await rowOf(held)).status_reason).toBe(`Powód ${REASON_MARKER}`);
    expect(JSON.stringify(await getHeader(editor, held))).not.toContain(REASON_MARKER);
  });
});

describe('restoration (EVM-030 AC4; SR-SESS-08, SR-AUTHZ-10)', () => {
  it('EVM-030 AC4 the Administrator with a fresh passkey authentication restores "Rozliczone" to "Zakończone": the closing time is cleared, the event work_order.restored is written', async () => {
    const id = await orderIn('settled', { completedOn: '2026-09-30' });
    const administrator = await signIn('administrator', { passkey: 'fresh' });
    const response = await go(administrator, id, 'completed');
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ status: 'completed', completedOn: '2026-09-30', allowedTransitions: ['in_progress', 'settled'] });
    expect((response.body as Record<string, unknown>)['closedAt']).toBeUndefined();
    expect(await rowOf(id)).toMatchObject({ status: 'completed', closed_at: null });
    const events = await auditOf(id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'work_order.restored',
      outcome: 'success',
      actor_user_id: administrator.userId,
      object_id: id,
    });
  });

  it('EVM-030 AC4 "Anulowane" is restored to "Wstrzymane" with the status it can resume to; the closing time is cleared; resuming goes back to where the order was cancelled from', async () => {
    const id = await orderIn('in_progress');
    const administrator = await signIn('administrator', { passkey: 'fresh' });
    await go(administrator, id, 'cancelled', { reason: 'Pomyłka' });
    const restored = await go(administrator, id, 'on_hold');
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    expect(restored.body).toMatchObject({
      status: 'on_hold',
      resumeStatus: 'in_progress',
      allowedTransitions: ['in_progress', 'cancelled'],
    });
    expect(await rowOf(id)).toMatchObject({ status: 'on_hold', closed_at: null, status_reason: null });
    expect((await go(administrator, id, 'in_progress')).body).toMatchObject({ status: 'in_progress' });
    expect((await auditOf(id)).map((event) => event['action'])).toEqual(['work_order.cancelled', 'work_order.restored']);
  });

  it('EVM-030 AC4 a restoration takes no reason (400 "not_allowed" if one is sent); a hold from an active status does', async () => {
    const id = await orderIn('cancelled', { resumeStatus: 'new' });
    const administrator = await signIn('administrator', { passkey: 'fresh' });
    const response = await go(administrator, id, 'on_hold', { reason: 'Przywracam' });
    expect(errorsOf(response.body)).toEqual([{ pointer: '/reason', code: 'not_allowed' }]);
  });

  it('EVM-030 AC4 the Administrator WITHOUT a fresh authentication gets 403 step_up_required for both restorations — also with a session from a password (no passkey at all) — and nothing changes, no event is written', async () => {
    for (const passkey of ['none', 'stale'] as const) {
      const administrator = await signIn('administrator', { passkey });
      for (const [status, to] of [
        ['settled', 'completed'],
        ['cancelled', 'on_hold'],
      ] as const) {
        const id = await orderIn(status, { resumeStatus: 'new' });
        const response = await go(administrator, id, to);
        expect(response.status, `${passkey} ${status}`).toBe(403);
        expect(codeOf(response.body)).toBe('step_up_required');
        expect(await rowOf(id)).toMatchObject({ status, version: 1 });
      }
    }
    expect(await auditDelta()).toBe(0);
  });

  it('EVM-030 AC4 the window of the step-up closes exactly 15 minutes after the passkey: 14:59.999 is let in, 15:00.000 is step_up_required (one implementation of freshness, the clock of the application)', async () => {
    const administrator = await signIn('administrator', { passkey: 'fresh' });
    const early = await orderIn('settled');
    current.clock.advance(15 * 60_000 - 1);
    expect((await go(administrator, early, 'completed')).status).toBe(200);
    const late = await orderIn('settled');
    current.clock.advance(1);
    const response = await go(administrator, late, 'completed');
    expect(response.status).toBe(403);
    expect(codeOf(response.body)).toBe('step_up_required');
    expect(await rowOf(late)).toMatchObject({ status: 'settled' });
  });

  it('EVM-030 AC4 the Editor is 403 forbidden for both restorations — and does not learn of the step-up even with a fresh passkey, with a stale version or with a malformed reason', async () => {
    const editor = await signIn('editor', { passkey: 'fresh' });
    const withoutKey = await signIn('editor');
    for (const browser of [editor, withoutKey]) {
      for (const [status, to] of [
        ['settled', 'completed'],
        ['cancelled', 'on_hold'],
      ] as const) {
        const id = await orderIn(status, { resumeStatus: 'new' });
        for (const [extra, options] of [
          [{}, {}],
          [{}, { ifMatch: '"77"' }],
          [{ reason: 'x' }, {}],
        ] as const) {
          const response = await go(browser, id, to, extra, options);
          expect(response.status, `${status} ${JSON.stringify(extra)}`).toBe(403);
          expect(codeOf(response.body)).toBe('forbidden');
        }
        expect(await rowOf(id)).toMatchObject({ status, version: 1 });
      }
    }
    expect(await auditDelta()).toBe(0);
  });

  it('EVM-030 AC4 the Administrator with a fresh authentication but a stale version is 412 (the role and the step-up are satisfied, the version is not)', async () => {
    const id = await orderIn('settled');
    const response = await go(await signIn('administrator', { passkey: 'fresh' }), id, 'completed', {}, { ifMatch: '"5"' });
    expect(response.status).toBe(412);
    expect(codeOf(response.body)).toBe('version_conflict');
    expect(await rowOf(id)).toMatchObject({ status: 'settled', version: 1 });
  });

  it('EVM-030 AC4 AC7 the transitions that are NOT restorations do not ask the Administrator for a step-up', async () => {
    const id = await orderIn('in_progress');
    const administrator = await signIn('administrator', { passkey: 'none' });
    expect((await go(administrator, id, 'completed')).status).toBe(200);
    expect((await go(administrator, id, 'settled')).status).toBe(200);
  });

  it('EVM-030 AC4 the menu: the Administrator is offered the restoration of a closed order, the Editor is offered nothing (the panel disables "Przywróć zlecenie…")', async () => {
    const settled = await orderIn('settled');
    const cancelled = await orderIn('cancelled', { resumeStatus: 'accepted' });
    const administrator = await signIn('administrator');
    const editor = await signIn('editor');
    expect((await getHeader(administrator, settled))['allowedTransitions']).toEqual(['completed']);
    expect((await getHeader(administrator, cancelled))['allowedTransitions']).toEqual(['on_hold']);
    expect((await getHeader(editor, settled))['allowedTransitions']).toEqual([]);
    expect((await getHeader(editor, cancelled))['allowedTransitions']).toEqual([]);
  });
});

describe('the rules of the transitions (EVM-030 AC5; SR-API-06, SR-API-07, SR-AUTHZ-04)', () => {
  it('EVM-030 AC5 a transition that is not in the table is 409 invalid_state_transition, whatever the pair; the answer says nothing of the state and nothing changes', async () => {
    const editor = await signIn('editor');
    const pairs: Array<[WorkOrderStatus, WorkOrderStatus]> = [
      ['new', 'completed'],
      ['new', 'settled'],
      ['new', 'new'],
      ['quoting', 'in_progress'],
      ['accepted', 'quoting'],
      ['in_progress', 'accepted'],
      ['in_progress', 'settled'],
      ['completed', 'on_hold'],
      ['completed', 'cancelled'],
      ['settled', 'new'],
      ['settled', 'cancelled'],
      ['cancelled', 'new'],
      ['cancelled', 'settled'],
    ];
    const bodies = new Set<string>();
    for (const [from, to] of pairs) {
      const id = await orderIn(from, { resumeStatus: from === 'cancelled' ? 'new' : undefined });
      const response = await go(editor, id, to, to === 'on_hold' || to === 'cancelled' ? { reason: 'powód' } : {});
      expect(response.status, `${from} > ${to}`).toBe(409);
      expect(codeOf(response.body)).toBe('invalid_state_transition');
      bodies.add(withoutTrace(response.body));
      expect(await rowOf(id)).toMatchObject({ status: from, version: 1 });
    }
    expect(bodies.size).toBe(1);
    expect([...bodies][0]).not.toMatch(/new|settled|cancelled|completed|version/);
  });

  it('EVM-030 AC5 a missing If-Match is 428 precondition_required — and the order is untouched', async () => {
    const id = await orderIn('new');
    const response = await go(await signIn('editor'), id, 'accepted', {}, { ifMatch: null });
    expect(response.status).toBe(428);
    expect(codeOf(response.body)).toBe('precondition_required');
    expect(await rowOf(id)).toMatchObject({ status: 'new', version: 1 });
  });

  it('EVM-030 AC5 a weak tag, a list, "*", a bare number, zero, a negative number and a number past 32 bits are 400 at /headers/If-Match', async () => {
    const id = await orderIn('new');
    const editor = await signIn('editor');
    for (const ifMatch of ['W/"1"', '"1", "2"', '*', '1', '"0"', '"-1"', '"2147483648"', '"abc"', '""']) {
      const response = await go(editor, id, 'accepted', {}, { ifMatch });
      expect(response.status, ifMatch).toBe(400);
      expect(errorsOf(response.body), ifMatch).toEqual([{ pointer: '/headers/If-Match', code: 'invalid_format' }]);
    }
    expect(await rowOf(id)).toMatchObject({ status: 'new', version: 1 });
  });

  it('EVM-030 AC5 a stale version is 412 version_conflict and the answer gives no version; the order is untouched; the same command with the current version goes through', async () => {
    const id = await orderIn('new');
    const editor = await signIn('editor');
    await go(editor, id, 'quoting'); // version 2
    const stale = await go(editor, id, 'accepted', {}, { ifMatch: '"1"' });
    expect(stale.status).toBe(412);
    expect(codeOf(stale.body)).toBe('version_conflict');
    expect(JSON.stringify(stale.body)).not.toMatch(/"2"|version":/);
    expect(await rowOf(id)).toMatchObject({ status: 'quoting', version: 2 });
    const fresh = await go(editor, id, 'accepted', {}, { ifMatch: '"2"' });
    expect(fresh.status).toBe(200);
    expect(fresh.headers['etag']).toBe('"3"');
  });

  it('EVM-030 AC5 a stale version with a transition that is no longer in the table is 412 (the client reads the order again), a current version with the same transition is 409', async () => {
    const id = await orderIn('new');
    const editor = await signIn('editor');
    await go(editor, id, 'accepted'); // version 2: new > accepted is gone
    expect((await go(editor, id, 'accepted', {}, { ifMatch: '"1"' })).status).toBe(412);
    expect((await go(editor, id, 'accepted', {}, { ifMatch: '"2"' })).status).toBe(409);
  });

  it('EVM-030 AC5 a field of the server in the body is 400 read_only_field: status, resumeStatus, closedAt, statusChangedAt, version and id — the PATCH of a status does not exist, so the command is the only way', async () => {
    const id = await orderIn('new');
    const editor = await signIn('editor');
    for (const field of ['status', 'resumeStatus', 'closedAt', 'statusChangedAt', 'version', 'id', 'number', 'allowedTransitions']) {
      const response = await go(editor, id, 'accepted', { [field]: 'accepted' });
      expect(response.status, field).toBe(400);
      expect(errorsOf(response.body), field).toEqual([{ pointer: `/${field}`, code: 'read_only_field' }]);
    }
    const stranger = await go(editor, id, 'accepted', { colour: 'red' });
    expect(errorsOf(stranger.body)).toEqual([{ pointer: '/colour', code: 'unknown_field' }]);
    expect(await rowOf(id)).toMatchObject({ status: 'new', version: 1 });
  });

  it('EVM-030 AC5 `to` is required and one of the eight statuses; an empty body, a wrong type and malformed JSON are 400', async () => {
    const id = await orderIn('new');
    const editor = await signIn('editor');
    expect(errorsOf((await send(editor, id, {})).body)).toEqual([{ pointer: '/to', code: 'invalid_value' }]);
    expect(errorsOf((await go(editor, id, 'archived')).body)).toEqual([{ pointer: '/to', code: 'invalid_value' }]);
    expect((await send(editor, id, { to: 7 })).status).toBe(400);
    expect((await send(editor, id, [])).status).toBe(400);
    const malformed = await editor.panel
      .post(`${BASE}/${id}/transitions`)
      .set('If-Match', '"1"')
      .set('Content-Type', 'application/json')
      .send('{"to":');
    expect(malformed.status).toBe(400);
    expect(await rowOf(id)).toMatchObject({ status: 'new', version: 1 });
  });

  it('EVM-030 AC5 a malformed order id is 400 validation_failed (never a 500)', async () => {
    const editor = await signIn('editor');
    const response = await send(editor, 'x', { to: 'accepted' }, { path: `${BASE}/not-a-uuid/transitions`, ifMatch: '"1"' });
    expect(response.status).toBe(400);
    expect(codeOf(response.body)).toBe('validation_failed');
  });

  it('EVM-030 AC5 the participants are asked under the lock, before anything is written: an unmet condition is 422 transition_condition_not_met with /to and the code of the reason, and the order, the audit and the idempotency are untouched', async () => {
    const id = await orderIn('completed');
    const editor = await signIn('editor');
    probe.unmet = 'unpaid_milestones';
    const key = uuidv7();
    const response = await go(editor, id, 'settled', {}, { key });
    expect(response.status).toBe(422);
    expect(codeOf(response.body)).toBe('transition_condition_not_met');
    expect(errorsOf(response.body)).toEqual([{ pointer: '/to', code: 'unpaid_milestones' }]);
    expect(probe.checked).toEqual(['completed>settled']);
    expect(probe.applied).toEqual([]);
    expect(await rowOf(id)).toMatchObject({ status: 'completed', version: 1, closed_at: null });
    expect(await idempotencyRecords()).toBe(0);
    probe.unmet = undefined;
    expect((await go(editor, id, 'settled', {}, { key })).status).toBe(200); // the key was not used up by the failure
    expect(probe.applied).toEqual(['completed>settled']);
  });

  it('EVM-030 AC5 the participant is not asked about a transition that is refused earlier (409, 403, 412, 400): its condition cannot be a way to probe the state', async () => {
    const editor = await signIn('editor');
    const settled = await orderIn('settled');
    const fresh = await orderIn('new');
    probe.unmet = 'unpaid_milestones';
    await go(editor, settled, 'completed'); // 403
    await go(editor, fresh, 'settled'); // 409
    await go(editor, fresh, 'accepted', {}, { ifMatch: '"9"' }); // 412
    await go(editor, fresh, 'accepted', { reason: 'x' }); // 400
    expect(probe.checked).toEqual([]);
  });

  it('EVM-030 AC8 an error of a participant while its effect runs rolls EVERYTHING back — the status, the audit record and the idempotency record — and the answer is 500 with no detail', async () => {
    const id = await orderIn('in_progress');
    const editor = await signIn('editor');
    probe.failApply = true;
    const before = current.logs.lines.length;
    const key = uuidv7();
    const response = await go(editor, id, 'cancelled', { reason: `Powód ${REASON_MARKER}` }, { key });
    expect(response.status).toBe(500);
    expect(codeOf(response.body)).toBe('internal_error');
    expect(JSON.stringify(response.body)).not.toMatch(/participant|failed|in_progress|cancelled/);
    expect(probe.applied).toEqual(['in_progress>cancelled']);
    expect(await rowOf(id)).toMatchObject({ status: 'in_progress', version: 1, closed_at: null, status_reason: null, resume_status: null });
    expect(await auditDelta()).toBe(0);
    expect(await idempotencyRecords()).toBe(0);
    expect(current.logs.lines.slice(before).join('\n')).not.toContain(REASON_MARKER);
    probe.failApply = false;
    expect((await go(editor, id, 'cancelled', { reason: 'Powód' }, { key })).status).toBe(200);
  });

  it('EVM-030 AC5 two identical commands on the same version race: ONE is 200, the other 412, and the order moved once', async () => {
    const id = await orderIn('new');
    const first = await signIn('editor');
    const second = await signIn('editor');
    const answers = await Promise.all([
      go(first, id, 'accepted', {}, { ifMatch: '"1"' }),
      go(second, id, 'accepted', {}, { ifMatch: '"1"' }),
    ]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 412]);
    expect(await rowOf(id)).toMatchObject({ status: 'accepted', version: 2 });
  });

  it('EVM-030 AC5 a cancellation and a hold race on the same version: one wins, the other is refused (412, or 403 when the winner closed the order), and a cancellation is audited exactly once or not at all', async () => {
    const id = await orderIn('in_progress');
    const first = await signIn('editor');
    const second = await signIn('editor');
    const answers = await Promise.all([
      go(first, id, 'cancelled', { reason: 'a' }, { ifMatch: '"1"' }),
      go(second, id, 'on_hold', { reason: 'b' }, { ifMatch: '"1"' }),
    ]);
    const statuses = answers.map((answer) => answer.status).sort();
    expect(statuses[0]).toBe(200);
    // the loser sees the NEW state: after a hold, a cancellation is a plain conflict (412); after a cancellation, "on_hold" is
    // the restoration, which an Editor may not do (403) — the role is decided before the version
    expect([403, 412]).toContain(statuses[1]);
    const row = await rowOf(id);
    expect(row.version).toBe(2);
    expect(await auditDelta()).toBe(row.status === 'cancelled' ? 1 : 0);
  });

  it('EVM-030 AC5 a restoration races a cancel of the same order by another user: whoever holds the lock first wins, the loser is refused (409 or 412), never a mix', async () => {
    const id = await orderIn('settled');
    const administrator = await signIn('administrator', { passkey: 'fresh' });
    const editor = await signIn('editor');
    const answers = await Promise.all([
      go(administrator, id, 'completed', {}, { ifMatch: '"1"' }),
      go(editor, id, 'cancelled', { reason: 'x' }, { ifMatch: '"1"' }),
    ]);
    const statuses = answers.map((answer) => answer.status).sort();
    expect(statuses[0]).toBe(200);
    expect([409, 412]).toContain(statuses[1]); // the Editor's cancel of a settled order has no row (409) or sees the new version first (412)
    expect(await rowOf(id)).toMatchObject({ status: 'completed', version: 2 });
  });
});

describe('idempotency of the command (EVM-030 AC5; SR-API-05, ASVS V2.3.1)', () => {
  it('EVM-030 AC5 a repeat (same key, order and body) is 200 with Idempotent-Replayed: the order is NOT moved again, there is one event, and the answer is the order as it is now', async () => {
    const id = await orderIn('in_progress');
    const editor = await signIn('editor');
    const key = uuidv7();
    const first = await go(editor, id, 'cancelled', { reason: 'Rezygnacja' }, { key });
    expect(first.status).toBe(200);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    const again = await go(editor, id, 'cancelled', { reason: 'Rezygnacja' }, { key });
    expect(again.status).toBe(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.headers['etag']).toBe('"2"');
    expect(withoutTrace(again.body)).toBe(withoutTrace(first.body));
    expect(await rowOf(id)).toMatchObject({ status: 'cancelled', version: 2 });
    expect(await auditOf(id)).toHaveLength(1);
    expect(await idempotencyRecords()).toBe(1);
  });

  it('EVM-030 AC5 the repeat of a command whose If-Match is by now stale is the stored result, not a conflict: the idempotency is looked up BEFORE the version is compared', async () => {
    const id = await orderIn('new');
    const editor = await signIn('editor');
    const key = uuidv7();
    expect((await go(editor, id, 'accepted', {}, { key, ifMatch: '"1"' })).status).toBe(200);
    const retry = await go(editor, id, 'accepted', {}, { key, ifMatch: '"1"' });
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    // the same stale tag WITHOUT the key is a conflict
    expect((await go(editor, id, 'in_progress', {}, { ifMatch: '"1"' })).status).toBe(412);
    expect(await rowOf(id)).toMatchObject({ status: 'accepted', version: 2 });
  });

  it('EVM-030 AC5 the same key and body on ANOTHER order is 422 idempotency_mismatch — the other order is not changed and no false "done" is returned (ASVS V2.3.1, CWE-841)', async () => {
    const first = await orderIn('new');
    const other = await orderIn('new');
    const editor = await signIn('editor');
    const key = uuidv7();
    expect((await go(editor, first, 'accepted', {}, { key })).status).toBe(200);
    const response = await go(editor, other, 'accepted', {}, { key });
    expect(response.status).toBe(422);
    expect(codeOf(response.body)).toBe('idempotency_mismatch');
    expect(response.headers['idempotent-replayed']).toBeUndefined();
    expect(await rowOf(other)).toMatchObject({ status: 'new', version: 1 });
    // and the other way round: the key of the other order is free for the other order
    expect((await go(editor, other, 'accepted', {}, { key: uuidv7() })).status).toBe(200);
  });

  it('EVM-030 AC5 the same key with another body is 422 idempotency_mismatch; the same key on another operation (creating an order) too', async () => {
    const id = await orderIn('new');
    const editor = await signIn('editor');
    const key = uuidv7();
    expect((await go(editor, id, 'accepted', {}, { key })).status).toBe(200);
    const other = await go(editor, id, 'in_progress', {}, { key });
    expect(other.status).toBe(422);
    expect(codeOf(other.body)).toBe('idempotency_mismatch');
    const created = await editor.panel.post(BASE, { id: uuidv7(), customerId, siteId, templateId: null }).set('Idempotency-Key', key);
    expect(created.status).toBe(422);
    expect(codeOf(created.body)).toBe('idempotency_mismatch');
    expect(await rowOf(id)).toMatchObject({ status: 'accepted', version: 2 });
  });

  it('EVM-030 AC5 another user never replays the result of a key that is not theirs: the same key by another user is a new command on the current state', async () => {
    const id = await orderIn('new');
    const first = await signIn('editor');
    const second = await signIn('editor');
    const key = uuidv7();
    expect((await go(first, id, 'accepted', {}, { key })).status).toBe(200);
    const response = await go(second, id, 'accepted', {}, { key });
    expect(response.status).toBe(409); // not replayed: for the second user it is a transition that no longer exists
  });

  it('EVM-030 AC5 a key that is not a UUIDv7 is 400 and the order is untouched', async () => {
    const id = await orderIn('new');
    const response = await go(await signIn('editor'), id, 'accepted', {}, { key: 'not-a-key' });
    expect(response.status).toBe(400);
    expect(await rowOf(id)).toMatchObject({ status: 'new', version: 1 });
  });

  it('EVM-030 AC5 a repeat after the step-up has expired still returns the stored result (the effect is not made a second time); a NEW command would need a new step-up', async () => {
    const id = await orderIn('settled');
    const administrator = await signIn('administrator', { passkey: 'fresh' });
    const key = uuidv7();
    expect((await go(administrator, id, 'completed', {}, { key })).status).toBe(200);
    current.clock.advance(20 * 60_000);
    const retry = await go(administrator, id, 'completed', {}, { key, ifMatch: '"1"' });
    expect(retry.status).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(await auditOf(id)).toHaveLength(1);
    const next = await orderIn('settled');
    expect(codeOf((await go(administrator, next, 'completed')).body)).toBe('step_up_required');
  });
});

describe('who may do it (EVM-030 AC7; SR-AUTHZ-01, SR-AUTHZ-05, SR-AUTHZ-12, CWE-639)', () => {
  it('EVM-030 AC7 Administrator and Editor do the transitions of the table; the Administrator and the Editor see the same menu for an open order', async () => {
    const id = await orderIn('new');
    for (const role of ['administrator', 'editor'] as const) {
      const browser = await signIn(role);
      const header = await getHeader(browser, id);
      expect(header['allowedTransitions'], role).toEqual(['quoting', 'accepted', 'on_hold', 'cancelled']);
    }
    expect((await go(await signIn('administrator'), id, 'quoting')).status).toBe(200);
    expect((await go(await signIn('editor'), id, 'accepted')).status).toBe(200);
  });

  it('EVM-030 AC7 Tylko odczyt is 403 forbidden for ANY request — a valid one, an empty one, a malformed one, for an order that exists and one that does not — and nothing changes; its menu is empty', async () => {
    const id = await orderIn('new');
    const reader = await signIn('read_only');
    for (const [target, body, ifMatch] of [
      [id, { to: 'accepted' }, '"1"'],
      [id, {}, null],
      [id, { to: 'archived', status: 'x' }, 'nonsense'],
      [uuidv7(), { to: 'accepted' }, '"1"'],
    ] as const) {
      const response = await send(reader, target, body, { ifMatch, path: `${BASE}/${target}/transitions` });
      expect(response.status, JSON.stringify(body)).toBe(403);
      expect(codeOf(response.body)).toBe('forbidden');
    }
    expect(await rowOf(id)).toMatchObject({ status: 'new', version: 1 });
    expect((await getHeader(reader, id))['allowedTransitions']).toEqual([]);
    expect((await getHeader(reader, await orderIn('settled')))['allowedTransitions']).toEqual([]);
    expect(await idempotencyRecords()).toBe(0);
  });

  it('EVM-030 AC7 an anonymous caller is 401 whatever the body (a revoked and an expired session: the role matrix)', async () => {
    const id = await orderIn('new');
    const anonymous = await request(current.app.getHttpServer())
      .post(`${BASE}/${id}/transitions`)
      .set('Origin', PANEL_ORIGIN)
      .set('Sec-Fetch-Site', 'same-origin')
      .set('If-Match', '"1"')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ to: 'accepted' }));
    expect(anonymous.status).toBe(401);
    expect(codeOf(anonymous.body)).toBe('unauthenticated');
    expect(await rowOf(id)).toMatchObject({ status: 'new', version: 1 });
  });

  it('EVM-030 AC7 the mobile channel is 403 forbidden for every role (the restoration needs a step-up, which exists only in the panel)', async () => {
    const id = await orderIn('new');
    for (const role of ['administrator', 'editor'] as const) {
      const response = await go(await signIn(role, { channel: 'mobile', passkey: 'fresh' }), id, 'accepted');
      expect(response.status, role).toBe(403);
      expect(codeOf(response.body)).toBe('forbidden');
    }
    expect(await rowOf(id)).toMatchObject({ status: 'new', version: 1 });
  });

  it('EVM-030 AC7 a missing or wrong CSRF token and a foreign Origin are 403 csrf_failed; the order is untouched', async () => {
    const id = await orderIn('new');
    const editor = await signIn('editor');
    const wrong = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    wrong.cookie = editor.panel.cookie;
    wrong.csrfToken = 'not-the-token';
    expect(codeOf((await wrong.post(`${BASE}/${id}/transitions`, { to: 'accepted' }).set('If-Match', '"1"')).body)).toBe('csrf_failed');
    const missing = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    missing.cookie = editor.panel.cookie;
    expect(codeOf((await missing.post(`${BASE}/${id}/transitions`, { to: 'accepted' }).set('If-Match', '"1"')).body)).toBe('csrf_failed');
    const crossSite = new PanelClient(current.app.getHttpServer(), 'https://evil.example');
    crossSite.cookie = editor.panel.cookie;
    crossSite.csrfToken = editor.panel.csrfToken;
    const forged = await crossSite.post(`${BASE}/${id}/transitions`, { to: 'accepted' }).set('If-Match', '"1"');
    expect(forged.status).toBe(403);
    expect(codeOf(forged.body)).toBe('csrf_failed');
    expect(await rowOf(id)).toMatchObject({ status: 'new', version: 1 });
  });

  it('EVM-030 AC7 an order that does not exist and one that is soft deleted are the SAME 404 not_found for the Administrator and the Editor — before the body is looked at, whatever it is', async () => {
    const deleted = await orderIn('new', { deletedAt: new Date('2026-10-02T08:00:00Z') });
    const answers: string[] = [];
    for (const role of ['administrator', 'editor'] as const) {
      const browser = await signIn(role, { passkey: 'fresh' });
      for (const [target, body, ifMatch] of [
        [deleted, { to: 'accepted' }, '"1"'],
        [uuidv7(), { to: 'accepted' }, '"1"'],
        [deleted, {}, null],
        [uuidv7(), { to: 'archived' }, 'nonsense'],
      ] as const) {
        const response = await send(browser, target, body, { ifMatch, path: `${BASE}/${target}/transitions` });
        expect(response.status, `${role} ${JSON.stringify(body)}`).toBe(404);
        expect(codeOf(response.body)).toBe('not_found');
        answers.push(withoutTrace(response.body));
      }
    }
    expect(new Set(answers).size).toBe(1);
    expect(await rowOf(deleted)).toMatchObject({ status: 'new', version: 1 });
    expect(probe.checked).toEqual([]);
  });

  it('EVM-030 AC7 an Editor cannot reach the effect of a restoration by any sequence of the transitions the API offers: starting from a closed order nothing is possible, from an open one the closing is permanent', async () => {
    const editor = await signIn('editor');
    const settled = await orderIn('settled');
    const cancelled = await orderIn('cancelled', { resumeStatus: 'in_progress' });
    for (const id of [settled, cancelled]) {
      for (const to of ['new', 'quoting', 'accepted', 'in_progress', 'completed', 'settled', 'on_hold', 'cancelled']) {
        const response = await go(editor, id, to, to === 'on_hold' || to === 'cancelled' ? { reason: 'x' } : {});
        expect([403, 409], to).toContain(response.status);
      }
      expect(await rowOf(id)).toMatchObject({ version: 1 });
      expect((await rowOf(id)).closed_at).not.toBeNull();
    }
    // closed by the Editor himself, still not reopened by him
    const own = await orderIn('completed');
    expect((await go(editor, own, 'settled')).status).toBe(200);
    expect((await go(editor, own, 'completed')).status).toBe(403);
    expect((await rowOf(own)).closed_at).not.toBeNull();
  });
});

describe('a closed order is shown as such (EVM-030 AC6)', () => {
  it("EVM-030 AC6 the header of a settled and a cancelled order carries the status, the closing time and the menu for each role (the banner is the panel's, the data is the API's)", async () => {
    const settled = await orderIn('settled', { completedOn: '2026-09-29' });
    const cancelled = await orderIn('cancelled', { resumeStatus: 'accepted' });
    for (const [role, expected] of [
      ['administrator', { settled: ['completed'], cancelled: ['on_hold'] }],
      ['editor', { settled: [], cancelled: [] }],
      ['read_only', { settled: [], cancelled: [] }],
    ] as const) {
      const browser = await signIn(role);
      const a = await getHeader(browser, settled);
      const b = await getHeader(browser, cancelled);
      expect(a, role).toMatchObject({
        status: 'settled',
        closedAt: '2026-10-01T07:00:00.000Z',
        completedOn: '2026-09-29',
        allowedTransitions: expected.settled,
      });
      expect(b, role).toMatchObject({
        status: 'cancelled',
        closedAt: '2026-10-01T07:00:00.000Z',
        resumeStatus: 'accepted',
        allowedTransitions: expected.cancelled,
      });
    }
  });
});

describe('the limit of requests (EVM-030 AC8; SR-API-02)', () => {
  it('EVM-030 AC8 once the limit of the address is spent, the command is 429 rate_limited with Retry-After and the order is untouched; a minute later the same command goes through (the panel keeps the reason)', async () => {
    const id = await orderIn('in_progress');
    const editor = await signIn('editor');
    const server = current.app.getHttpServer();
    const forwardedFor = '203.0.113.77';
    for (let attempt = 1; attempt <= 1200; attempt += 1) await request(server).get('/api/v1/nothing').set('X-Forwarded-For', forwardedFor);
    const limited = await go(editor, id, 'on_hold', { reason: 'Powód' }, { forwardedFor });
    expect(limited.status).toBe(429);
    expect(codeOf(limited.body)).toBe('rate_limited');
    expect(limited.headers['retry-after']).toBeDefined();
    expect(await rowOf(id)).toMatchObject({ status: 'in_progress', version: 1 });
    current.clock.advance(61_000);
    expect((await go(editor, id, 'on_hold', { reason: 'Powód' }, { forwardedFor })).status).toBe(200);
  });
});
