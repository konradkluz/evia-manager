import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PurgeSessionsJob } from '../../src/modules/identity/index.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createMobileSession, createPasskey, createUser, type Role } from '../support/identity-fixtures.ts';
import { auditActions, browserOf } from '../support/invitation-fixtures.ts';
import { enrolledAccount } from '../support/login-flows.ts';
import { deviceRow, MOBILE, newPhone } from '../support/mobile-flows.ts';
import { deliverReset, NEW_PASSWORD, RESET } from '../support/password-reset-fixtures.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { addTotp } from '../support/totp-flows.ts';
import { uuidv7 } from '../support/uuid.ts';
import { insertWorkOrders } from '../support/work-order-fixtures.ts';
import { changeRole, deactivate, resetSecondStep } from '../support/user-access-fixtures.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

const DAY = 86_400_000;
const problemOf = (response: { body: unknown }): string => (response.body as { code: string }).code;
const asPhone = (bearer: string) => newPhone(current).get(MOBILE.config, { Authorization: `Bearer ${bearer}` });

/** An account with two phones (a session and an access token each), written into the database. */
async function accountWithPhones(role: Role = 'editor') {
  const user = await createUser(current.database.admin, current.clock, { role });
  const phones = [
    await createMobileSession(current.database.admin, current.clock, user),
    await createMobileSession(current.database.admin, current.clock, user),
  ];
  return { user, phones };
}
const stateOf = async (deviceId: string) => (await deviceRow(current, deviceId))?.['state'];

describe('EVM-095 AC5 the events of the account and the phones (table M-02; SR-MOB-04)', () => {
  it('EVM-095 AC5 a deactivation orders EVERY phone of the account to wipe in the same transaction: the next request is 401 device_wipe_required', async () => {
    const admin = await browserOf(current, { role: 'administrator', key: 'fresh' });
    const { user, phones } = await accountWithPhones();
    const response = await deactivate(current, admin, user.id);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    for (const phone of phones) {
      expect(await stateOf(phone.deviceId)).toBe('wipe_required');
      const refused = await asPhone(phone.bearer);
      expect([refused.status, problemOf(refused)]).toEqual([401, 'device_wipe_required']);
    }
    const events = (await auditActions(current)).filter((event) => event.action === 'device.wipe_ordered');
    expect(events.map((event) => [event.reason_code, event.actor_user_id]).sort()).toEqual([
      ['account_deactivated', admin.user.id],
      ['account_deactivated', admin.user.id],
    ]);
  });

  it('EVM-095 AC5 a change of the role to Read-only orders the wipe; a change between Administrator and Editor only ends the sessions (the phones stay active)', async () => {
    const admin = await browserOf(current, { role: 'administrator', key: 'fresh' });
    const toReadOnly = await accountWithPhones();
    expect((await changeRole(current, admin, toReadOnly.user.id, 'read_only')).status).toBe(200);
    for (const phone of toReadOnly.phones) expect(await stateOf(phone.deviceId)).toBe('wipe_required');

    const secondAdministrator = await accountWithPhones('administrator');
    await createPasskey(current.database.admin, current.clock, secondAdministrator.user);
    expect((await changeRole(current, admin, secondAdministrator.user.id, 'editor')).status).toBe(200);
    for (const phone of secondAdministrator.phones) {
      expect(await stateOf(phone.deviceId)).toBe('active');
      const refused = await asPhone(phone.bearer);
      expect([refused.status, problemOf(refused)]).toEqual([401, 'session_revoked']);
    }
    expect(
      (await auditActions(current)).filter((event) => event.reason_code === 'role_changed' && event.action.startsWith('device.')).length,
    ).toBe(4);
  });

  it('EVM-095 AC5 a reset of the second step ends the sessions of the phones and leaves them active (regression EVM-027)', async () => {
    const admin = await browserOf(current, { role: 'administrator', key: 'fresh' });
    const { user, phones } = await accountWithPhones();
    await createPasskey(current.database.admin, current.clock, user);
    const response = await resetSecondStep(current, admin, user.id);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    for (const phone of phones) {
      expect(await stateOf(phone.deviceId)).toBe('active');
      expect(problemOf(await asPhone(phone.bearer))).toBe('session_revoked');
    }
    expect((await auditActions(current)).filter((event) => event.action === 'device.logged_out').map((event) => event.reason_code)).toEqual(
      ['second_step_reset', 'second_step_reset'],
    );
  });

  it('EVM-095 AC5 a reset of the password ends the sessions of the phones and leaves them active (regression EVM-027)', async () => {
    const enrolled = await enrolledAccount(current, { role: 'editor' });
    await addTotp(current, enrolled);
    const phone = await createMobileSession(current.database.admin, current.clock, enrolled.user);
    expect((await asPhone(phone.bearer)).status).toBe(200);
    const delivered = await deliverReset(current, enrolled);
    expect((await current.panel().post(RESET.complete, { token: delivered.token, password: NEW_PASSWORD })).status).toBe(200);
    expect(await stateOf(phone.deviceId)).toBe('active');
    expect(problemOf(await asPhone(phone.bearer))).toBe('session_revoked');
    expect((await auditActions(current)).filter((event) => event.action === 'device.logged_out')).toMatchObject([
      { reason_code: 'password_reset', object_id: phone.deviceId },
    ]);
  });
});

describe('EVM-095 AC7 retention of the record of a device (P2, P4; SR-DATA-07)', () => {
  const purge = () => current.app.get(PurgeSessionsJob).run();
  const exists = async (deviceId: string) => (await deviceRow(current, deviceId)) !== undefined;

  async function silentDevice(days: number) {
    const user = await createUser(current.database.admin, current.clock, { role: 'editor' });
    const phone = await createMobileSession(current.database.admin, current.clock, user);
    await sql`update identity.devices set last_contact_at = ${new Date(current.clock.now().getTime() - days * DAY)} where id = ${phone.deviceId}`.execute(
      current.database.admin,
    );
    return { user, phone };
  }

  it('EVM-095 AC7 a device with no contact for 89 days stays; one with 91 days goes with its sessions and tokens, and the audit trail stays', async () => {
    const young = await silentDevice(89);
    const old = await silentDevice(91);
    await sql`insert into audit.events (occurred_at, actor_type, actor_user_id, origin, action, outcome, object_type, object_id, trace_id)
      values (now(), 'user', ${old.user.id}, 'web', 'device.logged_out', 'success', 'device', ${old.phone.deviceId}, ${'a'.repeat(32)})`.execute(
      current.database.admin,
    );
    const result = await purge();
    expect(result).toMatchObject({ devices: 1 });
    expect(await exists(young.phone.deviceId)).toBe(true);
    expect(await exists(old.phone.deviceId)).toBe(false);
    const sessions = await sql<{ n: string }>`select count(*) as n from identity.sessions where device_id = ${old.phone.deviceId}`.execute(
      current.database.admin,
    );
    expect(Number(sessions.rows[0]?.n)).toBe(0);
    const tokens = await sql<{
      n: string;
    }>`select count(*) as n from identity.access_tokens where session_id = ${old.phone.sessionId}`.execute(current.database.admin);
    expect(Number(tokens.rows[0]?.n)).toBe(0);
    const audit = await auditActions(current);
    expect(audit.filter((event) => event.object_id === old.phone.deviceId)).toHaveLength(1);
    expect(audit.filter((event) => event.action === 'device.purged')).toMatchObject([{ actor_type: 'system', outcome: 'success' }]);
    const counted = await sql<{ entity_count: number }>`select entity_count from audit.events where action = 'device.purged'`.execute(
      current.database.admin,
    );
    expect(counted.rows[0]?.entity_count).toBe(1);
  });

  it('EVM-095 AC7 a device silent for 91 days but INVALIDATED 10 days ago stays - the signal device_wipe_required lives on; at 91 days after the invalidation it goes', async () => {
    const admin = await browserOf(current, { role: 'administrator', key: 'fresh' });
    const { user, phone } = await silentDevice(91);
    expect((await deactivate(current, admin, user.id)).status).toBe(200);
    expect(await stateOf(phone.deviceId)).toBe('wipe_required');
    await sql`update identity.devices set invalidated_at = ${new Date(current.clock.now().getTime() - 10 * DAY)} where id = ${phone.deviceId}`.execute(
      current.database.admin,
    );
    expect(await purge()).toMatchObject({ devices: 0 });
    expect(await exists(phone.deviceId)).toBe(true);
    await sql`update identity.devices set invalidated_at = ${new Date(current.clock.now().getTime() - 91 * DAY)} where id = ${phone.deviceId}`.execute(
      current.database.admin,
    );
    expect(await purge()).toMatchObject({ devices: 1 });
    expect(await exists(phone.deviceId)).toBe(false);
  });

  it('EVM-095 AC7 M2 a session ended in the last 30 days and an open challenge do not stop the retention; the journal entry and the audit of the device have no foreign key and stay', async () => {
    const db = current.database.admin;
    const { user, phone } = await silentDevice(120);
    await sql`update identity.sessions set revoked_at = now(), revoke_reason = 'sessions_ended' where id = ${phone.sessionId}`.execute(db);
    const attempt = await sql<{ id: string }>`
      insert into identity.login_attempts (user_id, token_hash, created_at, expires_at, channel)
      values (${user.id}, decode(repeat('ab', 32), 'hex'), now(), now() + interval '5 minutes', 'mobile') returning id`.execute(db);
    const attemptId = attempt.rows[0]?.id ?? '';
    await sql`insert into identity.mobile_challenges (attempt_id, model, os_version, security_patch, platform, app_version, matched_device_id, matched_by, password_stamp, totp_factor_id)
      values (${attemptId}, 'Pixel 8', '14', '2026-09-05', 'android', '1.2.0', ${phone.deviceId}, 'current', now(), gen_random_uuid())`.execute(
      db,
    );
    const customerId = await insertCustomer(db, {});
    const siteId = await insertSite(db);
    const [orderId = ''] = [...(await insertWorkOrders(db, [{ number: 'ZL-5300-0001', customerId, siteId }])).values()];
    await sql`insert into timeline.timeline_entries (id, work_order_id, kind, note_category, body, origin, captured_at, created_at, created_by, created_via_device_id)
      values (${uuidv7()}, ${orderId}, 'note', 'phone_call', 'wpis syntetyczny', 'mobile', now(), now(), ${user.id}, ${phone.deviceId})`.execute(
      db,
    );
    await sql`insert into audit.events (occurred_at, actor_type, actor_user_id, origin, action, outcome, object_type, object_id, trace_id)
      values (now(), 'user', ${user.id}, 'web', 'device.logged_out', 'success', 'device', ${phone.deviceId}, ${'b'.repeat(32)})`.execute(
      db,
    );

    expect(await purge()).toMatchObject({ devices: 1 });
    expect(await exists(phone.deviceId)).toBe(false);
    const n = async (query: Promise<{ rows: Array<{ n: string }> }>) => Number((await query).rows[0]?.n);
    expect(await n(sql<{ n: string }>`select count(*) as n from identity.sessions where device_id = ${phone.deviceId}`.execute(db))).toBe(
      0,
    );
    expect(
      await n(sql<{ n: string }>`select count(*) as n from identity.mobile_challenges where attempt_id = ${attemptId}`.execute(db)),
    ).toBe(1);
    expect(
      await n(
        sql<{ n: string }>`select count(*) as n from timeline.timeline_entries where created_via_device_id = ${phone.deviceId}`.execute(db),
      ),
    ).toBe(1);
    expect(await n(sql<{ n: string }>`select count(*) as n from audit.events where object_id = ${phone.deviceId}`.execute(db))).toBe(1);
    const challenge = await sql<{
      matched_device_id: string | null;
    }>`select matched_device_id from identity.mobile_challenges where attempt_id = ${attemptId}`.execute(db);
    expect(challenge.rows[0]?.matched_device_id).toBeNull();
  });

  it('EVM-095 AC7 the job is idempotent and reports a count only: a second run deletes nothing', async () => {
    await silentDevice(120);
    expect(await purge()).toMatchObject({ devices: 1 });
    expect(await purge()).toMatchObject({ devices: 0 });
    expect((await auditActions(current)).filter((event) => event.action === 'device.purged')).toHaveLength(1);
  });
});
