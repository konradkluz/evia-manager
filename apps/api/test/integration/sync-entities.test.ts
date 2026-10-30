import type { Principal } from '../../src/platform/http/principal.ts';
import { USER_SYNC_SOURCE, type UserSyncSource } from '../../src/modules/identity/system-ports.ts';
import { PARTY_SYNC_SOURCE, type PartySyncSource } from '../../src/modules/parties/system-ports.ts';
import { PROCEDURE_STAGE_SYNC_SOURCE, type ProcedureStageSyncSource } from '../../src/modules/procedures/system-ports.ts';
import { SITE_SYNC_SOURCE, type SiteSyncSource } from '../../src/modules/sites/system-ports.ts';
import { TIMELINE_ENTRY_SYNC_SOURCE, type TimelineEntrySyncSource } from '../../src/modules/timeline/system-ports.ts';
import {
  SCOPE_ITEM_SYNC_SOURCE,
  WORK_ORDER_SYNC_SOURCE,
  type ScopeItemSyncSource,
  type WorkOrderSyncSource,
} from '../../src/modules/work-orders/system-ports.ts';
import { KeyRingCursorCodec } from '../../src/platform/crypto/key-ring-cursor.ts';
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../src/platform/config/config.ts';
import { APP_CONFIG } from '../../src/platform/tokens.ts';
import { effectiveScopeRuleVersion } from '../../src/platform/sync/scope-rule.ts';
import { FixedClock } from '../support/clock.ts';
import type { IdentityApp } from '../support/identity-app.ts';
import { MOBILE, signedInPhone } from '../support/mobile-flows.ts';
import {
  adminDb,
  ago,
  bootSync,
  counter,
  drain,
  editor,
  entityOf,
  idsOfType,
  keysOf,
  pull,
  restore,
  scenario,
  scopeVersion,
  SENTINELS,
  renameParty,
  renameUser,
  setQuantity,
  setSiteManager,
  softDelete,
  startStage,
  upsertOf,
  type SyncApp,
} from '../support/sync-harness.ts';
import { insertEntries } from '../support/timeline-fixtures.ts';
import { numberOf } from '../support/work-order-fixtures.ts';
import { totpAccount } from '../support/totp-flows.ts';

let current: SyncApp;
afterEach(async () => {
  await current.app.close();
});
const app = (): IdentityApp => current.app;
const db = () => adminDb(current.app);

async function boot(env: Record<string, string | undefined> = {}): Promise<void> {
  current = await bootSync(env);
}

const REDACTION = 'Treść usunięta przez administratora 05.10.2026.';

describe('the remaining types in the snapshot (EVM-097 AC1; SR-SYNC-04, CWE-213)', () => {
  it('EVM-097 AC1 the first download carries party, scope_item, procedure_stage, timeline_entry and user - every page strict, nothing outside the lists of the contract', async () => {
    await boot();
    const { phone } = await editor(app());
    const s = await scenario(app());
    const result = await drain(phone);

    expect(idsOfType(result.changes, 'scope_item').sort()).toEqual([...s.itemIds].sort());
    expect(idsOfType(result.changes, 'procedure_stage').sort()).toEqual([...s.stageIds].sort());
    expect(idsOfType(result.changes, 'timeline_entry').sort()).toEqual([...s.entryIds].sort());
    expect(idsOfType(result.changes, 'party').sort()).toEqual([s.managerPartyId, s.waitedPartyId].sort());
    expect(idsOfType(result.changes, 'user').sort()).toEqual([s.coordinator.id, s.responsible.id, s.author.id].sort());
    expect(upsertOf(result.changes, 'procedure_stage', s.stageIds[0] ?? '')).toMatchObject({
      procedureId: s.procedureId,
      procedureCode: 'connection',
      procedureName: 'Przylaczenie',
      workOrderId: s.orderId,
      waitingOn: 'party',
      waitingPartyId: s.waitedPartyId,
      responsibleUserId: s.responsible.id,
    });
    expect(upsertOf(result.changes, 'party', s.managerPartyId)).toMatchObject({
      kind: 'property_manager',
      displayName: 'Zarzadca Testowy',
      contactPersonName: 'Anna Testowa',
    });

    // negative test on the WHOLE serialised body of every page (the values, not the keys)
    const raw = JSON.stringify(result.pages);
    for (const forbidden of [
      SENTINELS.partyEmail,
      SENTINELS.partyNotes,
      SENTINELS.partyLegalForm,
      SENTINELS.siteMeter,
      SENTINELS.paymentCode,
      'payment_milestone',
      'designer@example.invalid',
      s.coordinator.email,
      s.responsible.email,
      s.author.email,
      s.stranger.email,
      s.stranger.id,
      s.strayPartyId,
      s.paymentEntryId,
      'lastLoginAt',
      'last_login',
      'eventCode',
      'eventPayload',
    ])
      expect(raw, forbidden).not.toContain(forbidden);
  });

  it('EVM-097 AC1 an Administrator that no order names is in no answer, a stranger party neither (the list of all people is never sent)', async () => {
    await boot();
    const { phone } = await editor(app());
    const s = await scenario(app());
    const result = await drain(phone);
    expect(keysOf(result.changes)).not.toContain(`user:${s.stranger.id}`);
    expect(keysOf(result.changes)).not.toContain(`party:${s.strayPartyId}`);
    expect(JSON.stringify(result.pages)).not.toContain(s.stranger.id);
  });

  it('EVM-097 AC1 an event about a payment is hidden in the query itself: not in the snapshot, not in the changes, not even as a marker; the other events stay', async () => {
    await boot();
    const { phone } = await editor(app());
    const s = await scenario(app());
    const [other = ''] = await insertEntries(db(), s.orderId, s.author.id, [
      { kind: 'event', eventCode: 'stage_status_changed', eventPayload: { objectType: 'work_order' } },
    ]);
    const first = await drain(phone);
    expect(keysOf(first.changes)).toContain(`timeline_entry:${other}`);
    expect(JSON.stringify(first.pages)).not.toContain(s.paymentEntryId);
    // a payment event appears later, and one that exists is touched
    const [later = ''] = await insertEntries(db(), s.orderId, s.author.id, [
      {
        kind: 'event',
        eventCode: 'payment_milestone_deleted',
        eventPayload: { objectType: 'payment_milestone', objectId: '0193a000-0000-7000-8000-0000000000ab' },
      },
    ]);
    const next = await drain(phone, '', first.cursor);
    expect(JSON.stringify(next.pages)).not.toContain(later);
    expect(JSON.stringify(next.pages)).not.toContain(s.paymentEntryId);
    expect(next.changes).toEqual([]);
  });

  it('EVM-097 AC1 the number of statements of a page of the snapshot does not depend on the number of entities (one order per page against five)', async () => {
    await boot();
    // seven orders: neither measured page is the last one (the last page of a snapshot also closes the download)
    for (let index = 0; index < 7; index += 1) await scenario(app());
    const measure = async (limit: number): Promise<number> => {
      const { phone } = await editor(app());
      current.statements.length = 0;
      const response = await pull(phone, `limit=${limit}`);
      expect(response.status).toBe(200);
      return current.statements.length;
    };
    const one = await measure(1);
    const five = await measure(5);
    expect(one).toBeGreaterThan(5);
    expect(five).toBe(one);
  });
});

describe('the remaining types in the phase of changes (EVM-097 AC1; ADR-0021 D4)', () => {
  it('EVM-097 AC1 a change of each type arrives as its current state, every page strict; soft delete is a delete, the restoration an upsert', async () => {
    await boot();
    const { phone } = await editor(app());
    const s = await scenario(app());
    const first = await drain(phone);

    await renameParty(app(), s.managerPartyId, 'Zarzadca Zmieniony');
    await setQuantity(app(), s.itemIds[0] ?? '', 3);
    await startStage(app(), s.stageIds[0] ?? '');
    await renameUser(app(), s.coordinator.id, 'Nowe Nazwisko');
    const changed = await drain(phone, '', first.cursor);
    expect(keysOf(changed.changes).sort()).toEqual(
      [`party:${s.managerPartyId}`, `scope_item:${s.itemIds[0]}`, `procedure_stage:${s.stageIds[0]}`, `user:${s.coordinator.id}`].sort(),
    );
    expect(upsertOf(changed.changes, 'party', s.managerPartyId)).toMatchObject({ displayName: 'Zarzadca Zmieniony', version: 2 });
    expect(upsertOf(changed.changes, 'user', s.coordinator.id)).toEqual({
      type: 'user',
      id: s.coordinator.id,
      version: 2,
      displayName: 'Nowe Nazwisko',
    });

    await softDelete(app(), 'scope_items', s.itemIds[1] ?? '');
    await softDelete(app(), 'stages', s.stageIds[1] ?? '');
    await softDelete(app(), 'entries', s.entryIds[1] ?? '');
    const deleted = await drain(phone, '', changed.cursor);
    expect(deleted.changes).toEqual(
      expect.arrayContaining([
        { op: 'delete', type: 'scope_item', id: s.itemIds[1] },
        { op: 'delete', type: 'procedure_stage', id: s.stageIds[1] },
        { op: 'delete', type: 'timeline_entry', id: s.entryIds[1] },
      ]),
    );
    expect(deleted.changes).toHaveLength(3);

    await restore(app(), 'scope_items', s.itemIds[1] ?? '');
    await restore(app(), 'stages', s.stageIds[1] ?? '');
    await restore(app(), 'entries', s.entryIds[1] ?? '');
    const restored = await drain(phone, '', deleted.cursor);
    expect(keysOf(restored.changes).sort()).toEqual(
      [`scope_item:${s.itemIds[1]}`, `procedure_stage:${s.stageIds[1]}`, `timeline_entry:${s.entryIds[1]}`].sort(),
    );
  });

  it('EVM-097 AC1 a change of the name or the code of a PROCESS reaches the phone through each of its stages (the process is not an entity)', async () => {
    await boot();
    const { phone } = await editor(app());
    const s = await scenario(app());
    const first = await drain(phone);
    await sql`update procedures.procedures set name = 'Nowa nazwa procesu' where id = ${s.procedureId}`.execute(db());
    const changed = await drain(phone, '', first.cursor);
    expect(keysOf(changed.changes).sort()).toEqual(s.stageIds.map((id) => `procedure_stage:${id}`).sort());
    expect(upsertOf(changed.changes, 'procedure_stage', s.stageIds[0] ?? '')).toMatchObject({ procedureName: 'Nowa nazwa procesu' });
    // the deletion of the process takes its stages away
    await softDelete(app(), 'procedures', s.procedureId);
    const gone = await drain(phone, '', changed.cursor);
    expect(gone.changes).toEqual(expect.arrayContaining(s.stageIds.map((id) => ({ op: 'delete', type: 'procedure_stage', id }))));
  });

  it('EVM-097 AC1 the redaction of an entry reaches the phone: the marker and redactedAt, the original text is nowhere; the same for a snapshot', async () => {
    await boot();
    const { phone } = await editor(app());
    const s = await scenario(app());
    const [target = ''] = await insertEntries(db(), s.orderId, s.author.id, [{ body: 'SENTINEL-ORIGINAL-TEXT' }]);
    const first = await drain(phone);
    expect(JSON.stringify(first.pages)).toContain('SENTINEL-ORIGINAL-TEXT');
    await sql`update timeline.timeline_entries set body = ${REDACTION}, redacted_at = ${app().clock.now()}, redacted_by = ${s.author.id},
      version = version + 1 where id = ${target}`.execute(db());
    const next = await drain(phone, '', first.cursor);
    expect(upsertOf(next.changes, 'timeline_entry', target)).toMatchObject({
      body: REDACTION,
      redactedAt: app().clock.now().toISOString(),
    });
    expect(JSON.stringify(next.pages)).not.toContain('SENTINEL-ORIGINAL-TEXT');
    const again = await drain(phone);
    expect(JSON.stringify(again.pages)).not.toContain('SENTINEL-ORIGINAL-TEXT');
  });

  it('EVM-097 AC1 a change of the role or a reset of the second step of a user is NOT a change for the phones (the version goes up, the row of the log does not)', async () => {
    await boot();
    const { phone } = await editor(app());
    const s = await scenario(app());
    const first = await drain(phone);
    await sql`update identity.users set role = 'administrator', version = version + 1 where id = ${s.coordinator.id}`.execute(db());
    await sql`update identity.users set last_login_at = now(), status = 'active', version = version + 1 where id = ${s.author.id}`.execute(
      db(),
    );
    const rows = await sql<{
      n: number;
    }>`select count(*)::int as n from sync.change_log where entity_type = 'user' and entity_id in (${s.coordinator.id}, ${s.author.id})`.execute(
      db(),
    );
    // the rows of the accounts exist from their creation only; nothing was added by the two updates
    const before = rows.rows[0]?.n ?? 0;
    await sql`update identity.users set role = 'editor', version = version + 1 where id = ${s.coordinator.id}`.execute(db());
    const after = await sql<{
      n: number;
    }>`select count(*)::int as n from sync.change_log where entity_type = 'user' and entity_id in (${s.coordinator.id}, ${s.author.id})`.execute(
      db(),
    );
    expect(after.rows[0]?.n).toBe(before);
    const next = await drain(phone, '', first.cursor);
    expect(next.changes).toEqual([]);
  });
});

describe('the scope of the entities without an anchor order (EVM-097 AC2; SR-AUTHZ-03, CWE-639)', () => {
  it('EVM-097 AC2 a change of a party or a user that an order in scope names arrives; of one that no order names, never - and nobody gets a marker for it', async () => {
    await boot();
    const { phone } = await editor(app());
    const s = await scenario(app());
    const first = await drain(phone);
    await renameParty(app(), s.strayPartyId, 'Dostawca Zmieniony');
    await renameUser(app(), s.stranger.id, 'Obcy Zmieniony');
    await renameParty(app(), s.waitedPartyId, 'Projektant Zmieniony');
    await renameUser(app(), s.author.id, 'Autor Zmieniony');
    const next = await drain(phone, '', first.cursor);
    expect(keysOf(next.changes).sort()).toEqual([`party:${s.waitedPartyId}`, `user:${s.author.id}`].sort());
    expect(JSON.stringify(next.pages)).not.toContain('Dostawca Zmieniony');
    expect(JSON.stringify(next.pages)).not.toContain('Obcy Zmieniony');
    expect(JSON.stringify(next.pages)).not.toContain(s.stranger.id);
  });

  it('EVM-097 AC2 the scope is judged at every read, not remembered: a party that stopped being named gets nothing, a party that started to be named arrives', async () => {
    await boot();
    const { phone } = await editor(app());
    const s = await scenario(app());
    const first = await drain(phone);
    // the site now names the stray party instead of the manager
    await setSiteManager(app(), s.siteId, s.strayPartyId);
    await renameParty(app(), s.managerPartyId, 'Dawny Zarzadca');
    await renameParty(app(), s.strayPartyId, 'Nowy Zarzadca');
    const next = await drain(phone, '', first.cursor);
    expect(keysOf(next.changes)).toContain(`party:${s.strayPartyId}`);
    expect(keysOf(next.changes)).toContain(`site:${s.siteId}`);
    expect(keysOf(next.changes)).not.toContain(`party:${s.managerPartyId}`);
    expect(keysOf(next.changes)).not.toContain(`delete:party:${s.managerPartyId}`);
  });

  it('EVM-097 AC2 a marker is due for a deleted party that an order in scope still names; a deleted party that none names gets none (not even a type and an id); a purge sends type and id only', async () => {
    await boot();
    const { phone } = await editor(app());
    const s = await scenario(app());
    const first = await drain(phone);
    await softDelete(app(), 'parties', s.managerPartyId);
    await softDelete(app(), 'parties', s.strayPartyId);
    const next = await drain(phone, '', first.cursor);
    expect(next.changes).toEqual([{ op: 'delete', type: 'party', id: s.managerPartyId }]);
    expect(JSON.stringify(next.pages)).not.toContain(s.strayPartyId);
    expect(JSON.stringify(next.pages)).not.toContain('Zarzadca Testowy');
    // a purge: the log cannot tell whether the phone ever had the row, so the marker (type and id, nothing else) is sent
    await sql`delete from parties.parties where id = ${s.strayPartyId}`.execute(db());
    const purged = await drain(phone, '', next.cursor);
    expect(purged.changes).toEqual([{ op: 'delete', type: 'party', id: s.strayPartyId }]);
  });

  it('EVM-097 AC2 a user who left the orders in scope (a closed order over N days ago) is not sent: the scope of the order decides', async () => {
    await boot();
    const { phone } = await editor(app());
    const old = await scenario(app(), { number: numberOf(2026, 900), status: 'settled', closedAt: ago(app(), 40) });
    const first = await drain(phone);
    expect(first.changes).toEqual([]);
    await renameUser(app(), old.coordinator.id, 'Zmiana Koordynatora');
    await renameUser(app(), old.author.id, 'Zmiana Autora');
    await renameParty(app(), old.managerPartyId, 'Zmiana Strony');
    const next = await drain(phone, '', first.cursor);
    expect(next.changes).toEqual([]);
  });
});

describe('leaving the scope (EVM-097 AC5; ADR-0021 D1)', () => {
  it('EVM-097 AC5 a change of an entry of an order closed over N days ago does not reach the phone; the deletion of an order is a delete of the order only', async () => {
    await boot();
    const { phone } = await editor(app());
    const old = await scenario(app(), { number: numberOf(2026, 901), status: 'settled', closedAt: ago(app(), 40) });
    const live = await scenario(app(), { number: numberOf(2026, 902) });
    const first = await drain(phone);
    expect(idsOfType(first.changes, 'work_order')).toEqual([live.orderId]);
    expect(JSON.stringify(first.pages)).not.toContain(old.orderId);
    await softDelete(app(), 'entries', old.entryIds[0] ?? '');
    await softDelete(app(), 'scope_items', old.itemIds[0] ?? '');
    const quiet = await drain(phone, '', first.cursor);
    expect(quiet.changes).toEqual([]);
    // a permanent deletion of a row: type and id only
    await sql`delete from work_orders.scope_items where id = ${live.itemIds[1]}`.execute(db());
    const purged = await drain(phone, '', quiet.cursor);
    expect(purged.changes).toEqual([{ op: 'delete', type: 'scope_item', id: live.itemIds[1] }]);
    // the order deleted in the office: the marker of the order (its entities leave with it by the anchor, on the phone)
    await softDelete(app(), 'orders', live.orderId);
    const removed = await drain(phone, '', purged.cursor);
    expect(removed.changes).toEqual([{ op: 'delete', type: 'work_order', id: live.orderId }]);
  });

  it('EVM-097 AC5 a closed order within N days stays with all its entities; the answer after a resync has no order outside the scope', async () => {
    await boot();
    const { phone } = await editor(app());
    const recent = await scenario(app(), { number: numberOf(2026, 903), status: 'settled', closedAt: ago(app(), 29) });
    const old = await scenario(app(), { number: numberOf(2026, 904), status: 'cancelled', closedAt: ago(app(), 31) });
    const result = await drain(phone);
    expect(idsOfType(result.changes, 'work_order')).toEqual([recent.orderId]);
    expect(idsOfType(result.changes, 'timeline_entry').sort()).toEqual([...recent.entryIds].sort());
    expect(JSON.stringify(result.pages)).not.toContain(old.entryIds[0]);
    expect(JSON.stringify(result.pages)).not.toContain(old.coordinator.id);
  });
});

describe('access and the rule of scope in the cursor (EVM-097 AC5, AC6; SR-SYNC-07)', () => {
  it('EVM-097 AC6 a cursor issued under one role is a resync (access_changed) once the role of the user is another; after the resync nothing outside the scope arrives', async () => {
    await boot();
    const { account, phone } = await editor(app());
    const old = await scenario(app(), { number: numberOf(2026, 905), status: 'settled', closedAt: ago(app(), 40) });
    const first = await drain(phone);
    await sql`update identity.users set role = 'administrator', version = version + 1 where id = ${account.user.id}`.execute(db());
    const resync = await pull(phone, `cursor=${first.cursor}`);
    expect(resync.status).toBe(200);
    expect(resync.body).toEqual({ result: 'resync_required', reason: 'access_changed', serverTime: expect.any(String) as string });
    expect(counter(app(), 'sync_resync_required_total', { reason: 'access_changed' })).toBe(1);
    const again = await drain(phone);
    expect(JSON.stringify(again.pages)).not.toContain(old.orderId);
  });

  it('EVM-097 AC6 the version of the rule of scope is above the 1 of EVM-096 in the cursor and in client-config; another N is another version (scope_changed)', async () => {
    await boot();
    const { account, phone } = await editor(app());
    const config = await phone.get(MOBILE.config, phone.authorised());
    expect(config.status).toBe(200);
    const version = (config.body as { scopeRuleVersion: number }).scopeRuleVersion;
    expect(version).toBeGreaterThan(1);
    expect(version).toBe(scopeVersion(app()));
    const claims = { ph: 'changes', tx: '1', sq: '0', u: account.user.id, d: phone.deviceId, r: 'editor' };
    const ring = app().app.get<AppConfig>(APP_CONFIG, { strict: false }).sync.cursorKeys;
    const seal = (sv: number) => new KeyRingCursorCodec(ring, new FixedClock(app().clock.now())).seal('getSyncChanges', { ...claims, sv });
    // the baseline of EVM-096 (1) and the version of a server with another N
    for (const sv of [1, effectiveScopeRuleVersion({ configured: 1, closedDays: 31 })]) {
      const response = await pull(phone, `cursor=${seal(sv)}`);
      expect(response.body, String(sv)).toMatchObject({ result: 'resync_required', reason: 'scope_changed' });
    }
    await current.app.close();
    await boot({ SYNC_CLOSED_ORDERS_IN_SCOPE_DAYS: '31' });
    const other = await editor(app());
    const next = await other.phone.get(MOBILE.config, other.phone.authorised());
    expect(next.body).toMatchObject({ closedWorkOrdersInScopeDays: 31 });
    expect((next.body as { scopeRuleVersion: number }).scopeRuleVersion).not.toBe(version);
    expect((next.body as { scopeRuleVersion: number }).scopeRuleVersion).toBe(effectiveScopeRuleVersion({ configured: 1, closedDays: 31 }));
  });
});

describe('an order with more than a page of entities (EVM-097 AC3; the contract limits a page to 500)', () => {
  it('EVM-097 AC3 600 journal entries of one order come in pages of at most 500, each exactly once, through the sub-cursor; the next orders follow', async () => {
    await boot();
    const { phone } = await editor(app());
    const big = await scenario(app());
    const next = await scenario(app());
    const specs = Array.from({ length: 600 }, (_, index) => ({ body: `Wpis ${index}` }));
    const more = await insertEntries(db(), big.orderId, big.author.id, specs);
    const result = await drain(phone, 'limit=1');
    const keys = keysOf(result.changes);
    expect(new Set(keys).size, 'every entity once').toBe(keys.length);
    expect(idsOfType(result.changes, 'timeline_entry')).toEqual(expect.arrayContaining([...more, ...big.entryIds, ...next.entryIds]));
    expect(idsOfType(result.changes, 'work_order').sort()).toEqual([big.orderId, next.orderId].sort());
    expect(result.pages.length).toBeGreaterThan(2);
    for (const page of result.pages) expect(page.changes?.length ?? 0).toBeLessThanOrEqual(500);
    expect(idsOfType(result.changes, 'timeline_entry').filter((id) => more.includes(id))).toHaveLength(600);
  });
});

describe('what the people see of each other (EVM-097 AC1)', () => {
  it('EVM-097 AC1 a second Editor with a phone is not told about the accounts of the colleagues beyond the names the orders point at', async () => {
    await boot();
    const s = await scenario(app());
    const { phone } = await editor(app());
    const other = await totpAccount(app(), { role: 'editor' });
    const otherPhone = await signedInPhone(app(), other);
    for (const device of [phone, otherPhone]) {
      const result = await drain(device);
      for (const change of result.changes) {
        const entity = entityOf(change);
        if (entity?.['type'] === 'user') expect(Object.keys(entity).sort()).toEqual(['displayName', 'id', 'type', 'version']);
      }
      expect(JSON.stringify(result.pages)).not.toContain(s.stranger.email);
    }
  });
});

describe('a deleted or purged object that an order still names (EVM-097 AC1, AC2; ADR-0021 D1)', () => {
  it('EVM-097 AC2 a user soft deleted is a marker while an order names the user, a purged site and a purged user are markers of type and id only', async () => {
    await boot();
    const { phone } = await editor(app());
    const s = await scenario(app());
    const first = await drain(phone);
    await sql`update identity.users set deleted_at = ${app().clock.now()}, version = version + 1 where id = ${s.author.id}`.execute(db());
    const named = await drain(phone, '', first.cursor);
    expect(named.changes).toEqual([{ op: 'delete', type: 'user', id: s.author.id }]);
    // an unnamed user that is deleted gets nothing at all
    await sql`update identity.users set deleted_at = ${app().clock.now()}, version = version + 1 where id = ${s.stranger.id}`.execute(db());
    expect((await drain(phone, '', named.cursor)).changes).toEqual([]);
    // a purge: the log cannot tell whether the phone ever had the row
    await sql`update work_orders.work_orders set site_id = null where id = ${s.orderId}`.execute(db());
    await sql`delete from sites.sites where id = ${s.siteId}`.execute(db());
    await sql`delete from identity.users where id = ${s.stranger.id}`.execute(db());
    const purged = await drain(phone, '', named.cursor);
    expect(purged.changes).toEqual(
      expect.arrayContaining([
        { op: 'delete', type: 'site', id: s.siteId },
        { op: 'delete', type: 'user', id: s.stranger.id },
      ]),
    );
    for (const change of purged.changes) if (change['op'] === 'delete') expect(Object.keys(change).sort()).toEqual(['id', 'op', 'type']);
  });

  it('EVM-097 AC3 a party and a user that are deleted are not in the snapshot of the order, the rest of it is (the phone does not get a name it may not show)', async () => {
    await boot();
    const s = await scenario(app());
    await softDelete(app(), 'parties', s.waitedPartyId);
    await sql`update identity.users set deleted_at = ${app().clock.now()}, version = version + 1 where id = ${s.responsible.id}`.execute(
      db(),
    );
    const { phone } = await editor(app());
    const result = await drain(phone);
    expect(keysOf(result.changes)).not.toContain(`party:${s.waitedPartyId}`);
    expect(keysOf(result.changes)).not.toContain(`user:${s.responsible.id}`);
    expect(keysOf(result.changes)).toContain(`party:${s.managerPartyId}`);
    expect(keysOf(result.changes)).toContain(`user:${s.coordinator.id}`);
  });
});

describe('the ports of the entities answer an empty question with an empty answer, without a query (EVM-097 AC1)', () => {
  it('EVM-097 AC1 no identifiers and no orders: nothing is read and nothing is invented', async () => {
    await boot();
    const tx = db();
    const scope = { closedSince: new Date(0) };
    const principal = { userId: '0193a000-0000-7000-8000-000000000001', role: 'editor' } as unknown as Principal;
    const orders = app().app.get<WorkOrderSyncSource>(WORK_ORDER_SYNC_SOURCE, { strict: false });
    expect((await orders.ordersInScope(tx, principal, scope, [])).size).toBe(0);
    expect((await orders.coordinatorsInScope(tx, principal, scope, [])).size).toBe(0);
    const items = app().app.get<ScopeItemSyncSource>(SCOPE_ITEM_SYNC_SOURCE, { strict: false });
    expect((await items.anchorsOf(tx, [])).size).toBe(0);
    expect((await items.liveOf(tx, [], [])).size).toBe(0);
    expect(await items.ofOrders(tx, [])).toEqual([]);
    const stages = app().app.get<ProcedureStageSyncSource>(PROCEDURE_STAGE_SYNC_SOURCE, { strict: false });
    expect((await stages.anchorsOf(tx, [])).size).toBe(0);
    expect((await stages.liveOf(tx, [], [])).size).toBe(0);
    expect(await stages.ofOrders(tx, [])).toEqual([]);
    expect(await stages.waitingOnParties(tx, [])).toEqual([]);
    expect(await stages.responsibleUsers(tx, [])).toEqual([]);
    const entries = app().app.get<TimelineEntrySyncSource>(TIMELINE_ENTRY_SYNC_SOURCE, { strict: false });
    expect((await entries.anchorsOf(tx, [])).size).toBe(0);
    expect((await entries.liveOf(tx, [], [])).size).toBe(0);
    expect(await entries.ofOrders(tx, [])).toEqual([]);
    expect(await entries.authors(tx, [])).toEqual([]);
    expect((await app().app.get<PartySyncSource>(PARTY_SYNC_SOURCE, { strict: false }).statesOf(tx, principal, [])).size).toBe(0);
    expect((await app().app.get<UserSyncSource>(USER_SYNC_SOURCE, { strict: false }).statesOf(tx, [])).size).toBe(0);
    expect(await app().app.get<SiteSyncSource>(SITE_SYNC_SOURCE, { strict: false }).partyReferences(tx, [])).toEqual([]);
  });
});
