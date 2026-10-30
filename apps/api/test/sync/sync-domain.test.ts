import { randomUUID } from 'node:crypto';
import { assertSyncProjectionStrict } from '@evia/contracts/sync';
import { describe, expect, it } from 'vitest';
import { assemblePage, entityKey, type ChangeLogRow } from '../../src/modules/sync/domain/changes-page.ts';
import { cursorClaims, decideCursor, type CursorContext } from '../../src/modules/sync/domain/cursor.ts';
import {
  changeBytes,
  customerChange,
  deleteChange,
  partyChange,
  procedureStageChange,
  scopeItemChange,
  siteChange,
  timelineEntryChange,
  userChange,
  workOrderChange,
} from '../../src/modules/sync/domain/projection.ts';
import { effectiveScopeRuleVersion, MAX_CLOSED_DAYS, MAX_SCOPE_RULE_COUNTER } from '../../src/platform/sync/scope-rule.ts';
import { SYNC_EXCLUDED_TABLES, SYNC_SCOPE_SCHEMAS, SYNCED_ENTITIES } from '../../src/modules/sync/domain/synced-entities.ts';

const NOW = new Date('2026-10-29T08:00:00.000Z');
const user = randomUUID();
const device = randomUUID();
const context = (overrides: Partial<CursorContext> = {}): CursorContext => ({
  userId: user,
  deviceId: device,
  scopeRuleVersion: 1,
  role: 'editor',
  now: NOW,
  periodicResyncMs: 7 * 24 * 3_600_000,
  state: { lastFullSyncAt: NOW, resyncRequestedReason: null },
  ...overrides,
});
const changes = { ph: 'changes', tx: '10', sq: '5', u: user, d: device, sv: 1, r: 'editor' };

describe('the decision about a cursor (EVM-096 AC3, AC6; SR-SYNC-07)', () => {
  it.each([
    ['tampered', { kind: 'tampered' }, { kind: 'reject', reason: 'tampered' }],
    ['malformed', { kind: 'malformed' }, { kind: 'resync', reason: 'cursor_invalid' }],
    ['unknown key', { kind: 'unknown_key' }, { kind: 'resync', reason: 'cursor_invalid' }],
    ['expired', { kind: 'expired' }, { kind: 'resync', reason: 'cursor_expired' }],
    ['claims of no known shape', { kind: 'ok', claims: { x: 1 } }, { kind: 'resync', reason: 'cursor_invalid' }],
    ['another user', { kind: 'ok', claims: { ...changes, u: randomUUID() } }, { kind: 'reject', reason: 'identity_mismatch' }],
    ['another device', { kind: 'ok', claims: { ...changes, d: randomUUID() } }, { kind: 'reject', reason: 'identity_mismatch' }],
    ['another rule of scope', { kind: 'ok', claims: { ...changes, sv: 2 } }, { kind: 'resync', reason: 'scope_changed' }],
    ['EVM-097 AC6 another role', { kind: 'ok', claims: { ...changes, r: 'administrator' } }, { kind: 'resync', reason: 'access_changed' }],
    [
      'EVM-097 AC6 no role in a cursor of the current rule',
      { kind: 'ok', claims: { ...changes, r: undefined } },
      { kind: 'resync', reason: 'access_changed' },
    ],
    [
      'EVM-097 AC6 an old cursor without a role is a change of scope, not garbage',
      { kind: 'ok', claims: { ...changes, sv: 2, r: undefined } },
      { kind: 'resync', reason: 'scope_changed' },
    ],
    [
      'EVM-097 AC6 a role outside the closed set',
      { kind: 'ok', claims: { ...changes, r: 'read_only' } },
      { kind: 'resync', reason: 'cursor_invalid' },
    ],
  ] as const)('EVM-096 AC3 %s', (_name, opened, expected) => {
    expect(decideCursor(opened, context())).toMatchObject(expected);
  });

  it('EVM-096 AC6 the flag of the device and the 7 days apply to the phase of changes; a snapshot in progress is the resync itself', () => {
    const ok = { kind: 'ok', claims: changes } as const;
    expect(decideCursor(ok, context()).kind).toBe('proceed');
    expect(decideCursor(ok, context({ state: { lastFullSyncAt: NOW, resyncRequestedReason: 'access_changed' } }))).toEqual({
      kind: 'resync',
      reason: 'access_changed',
    });
    const old = new Date(NOW.getTime() - 7 * 24 * 3_600_000);
    expect(decideCursor(ok, context({ state: { lastFullSyncAt: old, resyncRequestedReason: null } }))).toEqual({
      kind: 'resync',
      reason: 'periodic',
    });
    expect(decideCursor(ok, context({ state: { lastFullSyncAt: new Date(old.getTime() + 1), resyncRequestedReason: null } })).kind).toBe(
      'proceed',
    );
    expect(decideCursor(ok, context({ state: undefined }))).toEqual({ kind: 'resync', reason: 'periodic' });
    expect(decideCursor(ok, context({ state: { lastFullSyncAt: null, resyncRequestedReason: null } }))).toEqual({
      kind: 'resync',
      reason: 'periodic',
    });
    const snapshot = {
      kind: 'ok',
      claims: { ph: 'snapshot', tx: '10', after: null, dl: randomUUID(), u: user, d: device, sv: 1, r: 'editor' },
    } as const;
    expect(decideCursor(snapshot, context({ state: { lastFullSyncAt: old, resyncRequestedReason: 'scope_changed' } })).kind).toBe(
      'proceed',
    );
  });
});

const row = (seq: number, id: string, superseded = false): ChangeLogRow => ({
  seq: String(seq),
  txid: '7',
  type: 'work_order',
  id,
  superseded,
});
const order = (id: string, title = 'T') =>
  workOrderChange({
    id,
    version: 1,
    number: 'ZL-2026-0001',
    title,
    status: 'new',
    customerId: null,
    siteId: null,
    coordinatorUserId: null,
    description: null,
    plannedDate: null,
    createdAt: NOW,
    closedAt: null,
  });

describe('assembly of a page of changes (EVM-096 AC4, AC7)', () => {
  it('EVM-096 AC4 a superseded row emits nothing, a row without a due change emits nothing, the rest in the order of the log', () => {
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    const due = new Map([
      [entityKey({ type: 'work_order', id: a }), order(a)],
      [entityKey({ type: 'work_order', id: b }), deleteChange('work_order', b)],
    ]);
    const page = assemblePage([row(1, a, true), row(2, a), row(3, c), row(4, b)], due, 1_000_000);
    expect(page.consumed).toBe(4);
    expect(page.changes.map((change) => (change.op === 'delete' ? `delete:${change.id}` : change.entity.id))).toEqual([a, `delete:${b}`]);
  });

  it('EVM-096 AC7 the page closes before the budget with the cursor on the last included row; a single change larger than the budget still goes alone', () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const due = new Map(ids.map((id) => [entityKey({ type: 'work_order', id }), order(id, 'x'.repeat(200))]));
    const rows = ids.map((id, index) => row(index + 1, id));
    const one = changeBytes(order(ids[0] ?? '', 'x'.repeat(200)));
    const page = assemblePage(rows, due, one * 2 + 10);
    expect(page.changes).toHaveLength(2);
    expect(page.consumed).toBe(2);
    const alone = assemblePage(rows, due, 10);
    expect(alone.changes).toHaveLength(1);
    expect(alone.consumed).toBe(1);
    expect(assemblePage([], new Map(), 100)).toEqual({ changes: [], consumed: 0 });
  });
});

describe('the serializers list the fields of the contract and nothing else (EVM-096 AC2; SR-SYNC-04)', () => {
  it('EVM-096 AC2 a row with more fields than the projection keeps only the listed ones, and passes the strict check', () => {
    const id = randomUUID();
    const extra = { email: 'x@example.test', taxId: '1234567890', notes: 'n', search_text: 's', deleted_at: NOW, created_by: id };
    const customer = customerChange({ id, version: 2, kind: 'person', displayName: 'Jan Testowy', phone: '+48600000001', ...extra });
    const site = siteChange({
      id,
      version: 1,
      siteType: 'other',
      street: 'ul. Testowa',
      buildingNumber: '1',
      apartmentNumber: null,
      postalCode: '00-001',
      city: 'Warszawa',
      parkingSpotNumber: null,
      garageLevel: null,
      connectionPowerKw: 11,
      managerPartyId: null,
      distributionSystemOperatorPartyId: null,
      notes: null,
      meteringPointId: 'PPE-1',
    } as never);
    const withExtra = workOrderChange({
      id,
      version: 1,
      number: 'ZL-2026-0002',
      title: 'T',
      status: 'new',
      customerId: null,
      siteId: null,
      coordinatorUserId: null,
      description: null,
      plannedDate: '2026-10-30',
      createdAt: NOW,
      closedAt: NOW,
      statusReason: 'SENTINEL',
    } as never);
    for (const change of [customer, site, withExtra, deleteChange('site', id)])
      expect(assertSyncProjectionStrict(change), JSON.stringify(change)).toEqual({ ok: true });
    expect(JSON.stringify([customer, site, withExtra])).not.toMatch(/SENTINEL|PPE-1|example\.test|1234567890/);
    expect(withExtra).toMatchObject({ entity: { createdAt: NOW.toISOString(), closedAt: NOW.toISOString() } });
  });
});

describe('the registry of the synchronised tables (EVM-096 AC1)', () => {
  it('EVM-096 AC1 the registry names each table once, in a scope schema, and every exclusion has a reason', () => {
    const tables = SYNCED_ENTITIES.map((entity) => entity.table);
    expect(new Set(tables).size).toBe(tables.length);
    expect(new Set(SYNCED_ENTITIES.map((entity) => entity.type)).size).toBe(tables.length);
    // `identity.users` is the one carve-out: the other tables of `identity` (credentials, sessions) are not candidates for the phone at all
    for (const table of [...tables, ...Object.keys(SYNC_EXCLUDED_TABLES)].filter((name) => name !== 'identity.users'))
      expect(SYNC_SCOPE_SCHEMAS).toContain(table.split('.')[0]);
    expect(tables.filter((table) => Object.hasOwn(SYNC_EXCLUDED_TABLES, table))).toEqual([]);
  });
});

describe('the serializers of the remaining types list the fields of the contract and nothing else (EVM-097 AC1; SR-SYNC-04)', () => {
  const id = randomUUID();
  const leaks = {
    email: 'party-email@example.invalid',
    notes: 'SENTINEL-NOTES',
    legalForm: 'SENTINEL-LEGAL',
    role: 'administrator',
    lastLoginAt: NOW,
    eventCode: 'payment_milestone_status_changed',
    eventPayload: { amount: 1 },
    createdBy: id,
    deletedAt: NOW,
    search_text: 'SENTINEL-SEARCH',
  };

  it('EVM-097 AC1 a row with more fields than the projection keeps only the listed ones, for each of the five types, and passes the strict check', () => {
    const party = partyChange({
      id,
      version: 1,
      kind: 'supplier',
      displayName: 'Dostawca',
      contactPersonName: null,
      phone: null,
      ...leaks,
    });
    const item = scopeItemChange({
      ...leaks,
      id,
      version: 1,
      workOrderId: id,
      position: 1,
      code: 'wallbox',
      name: 'Wallbox',
      parameterSetCode: null,
      parameters: { power: 11 },
      quantity: 1,
      notes: 'nota pozycji',
    });
    const stage = procedureStageChange({
      id,
      version: 1,
      workOrderId: id,
      procedureId: id,
      procedureCode: 'connection',
      procedureName: 'Przylaczenie',
      code: 'design',
      name: 'Projekt',
      position: 1,
      status: 'todo',
      dueDate: '2026-11-01',
      responsibleUserId: null,
      waitingOn: null,
      waitingPartyId: null,
      waitingSince: null,
      blockedReason: null,
      startedAt: NOW,
      completedOn: null,
      ...leaks,
    });
    const entry = timelineEntryChange({
      id,
      version: 1,
      workOrderId: id,
      kind: 'note',
      noteCategory: 'phone_call',
      body: 'tresc',
      procedureStageId: null,
      authorUserId: id,
      createdAt: NOW,
      origin: 'web',
      capturedAt: NOW,
      supersedesEntryId: null,
      supersededByEntryId: null,
      redactedAt: NOW,
      ...leaks,
    });
    const named = userChange({ id, version: 3, displayName: 'Jan Testowy', ...leaks });
    const all = [party, item, stage, entry, named];
    for (const change of all) expect(assertSyncProjectionStrict(change), JSON.stringify(change)).toEqual({ ok: true });
    expect(JSON.stringify(all)).not.toMatch(/SENTINEL|example\.invalid|payment_milestone|administrator|lastLoginAt/);
    expect(named).toEqual({ op: 'upsert', entity: { type: 'user', id, version: 3, displayName: 'Jan Testowy' } });
    expect(stage).toMatchObject({ entity: { startedAt: NOW.toISOString(), procedureCode: 'connection' } });
  });
});

describe('the serializers keep a missing time as null (EVM-097 AC1)', () => {
  it('EVM-097 AC1 a stage that has not started, an entry without the time of the phone and one that is not redacted carry null, not a date', () => {
    const id = randomUUID();
    const stage = procedureStageChange({
      id,
      version: 1,
      workOrderId: id,
      procedureId: id,
      procedureCode: 'connection',
      procedureName: 'Przylaczenie',
      code: 'design',
      name: 'Projekt',
      position: 1,
      status: 'todo',
      dueDate: null,
      responsibleUserId: null,
      waitingOn: null,
      waitingPartyId: null,
      waitingSince: null,
      blockedReason: null,
      startedAt: null,
      completedOn: null,
    });
    const entry = timelineEntryChange({
      id,
      version: 1,
      workOrderId: id,
      kind: 'comment',
      noteCategory: null,
      body: 'tresc',
      procedureStageId: null,
      authorUserId: null,
      createdAt: NOW,
      origin: 'web',
      capturedAt: null,
      supersedesEntryId: null,
      supersededByEntryId: null,
      redactedAt: null,
    });
    expect(stage).toMatchObject({ entity: { startedAt: null } });
    expect(entry).toMatchObject({ entity: { capturedAt: null, redactedAt: null, createdAt: NOW.toISOString() } });
    for (const change of [stage, entry]) expect(assertSyncProjectionStrict(change)).toEqual({ ok: true });
  });
});

describe('the cursor claims of the snapshot carry a sub-cursor and a role from closed sets (EVM-097; SR-SYNC-07)', () => {
  const base = { ph: 'snapshot', tx: '10', after: randomUUID(), dl: randomUUID(), u: randomUUID(), d: randomUUID(), sv: 292, r: 'editor' };

  it('EVM-097 AC3 the sub-cursor is a strict object of an order and the key (type:id) of the last entity sent; anything else in it, or a stray claim, is refused', () => {
    const key = `timeline_entry:${randomUUID()}`;
    expect(cursorClaims.safeParse({ ...base, sub: { o: randomUUID(), k: key } }).success).toBe(true);
    expect(cursorClaims.safeParse({ ...base, sub: { o: randomUUID(), k: 'timeline_entry:short' } }).success).toBe(false);
    expect(cursorClaims.safeParse({ ...base, sub: { o: randomUUID(), n: 5 } }).success).toBe(false);
    expect(cursorClaims.safeParse({ ...base, sub: { o: 'not-a-uuid', k: key } }).success).toBe(false);
    expect(cursorClaims.safeParse({ ...base, sub: { o: randomUUID(), k: key, extra: 1 } }).success).toBe(false);
    expect(cursorClaims.safeParse({ ...base, stray: 1 }).success).toBe(false);
    const changesPhase = { ph: 'changes', tx: '1', sq: '0', u: base.u, d: base.d, sv: 292, r: 'editor' };
    expect(cursorClaims.safeParse({ ...changesPhase, sub: { o: randomUUID(), k: key } }).success).toBe(false);
  });
});

describe('the version of the rule of scope (EVM-097 AC6)', () => {
  it('EVM-097 AC6 it is above the 1 of EVM-096, differs for every N and counter, and is an int32 at the bounds of the configuration', () => {
    const at = (configured: number, closedDays: number) => effectiveScopeRuleVersion({ configured, closedDays });
    expect(at(1, 30)).toBeGreaterThan(1);
    expect(at(1, 1)).toBeGreaterThan(1);
    const versions = new Set<number>();
    for (let configured = 1; configured <= 3; configured += 1)
      for (let days = 1; days <= MAX_CLOSED_DAYS; days += 1) versions.add(at(configured, days));
    expect(versions.size).toBe(3 * MAX_CLOSED_DAYS);
    expect(at(MAX_SCOPE_RULE_COUNTER, MAX_CLOSED_DAYS)).toBeLessThanOrEqual(2_147_483_647);
  });
});
