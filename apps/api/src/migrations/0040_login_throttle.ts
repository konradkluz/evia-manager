/**
 * 0040 — protection against guessing passwords and the register of known browsers (EVM-026). Expand only, compatible with the code that is still running
 * (two new tables, a nullable column that the old code never reads, and two vocabularies that only grow — the earlier values still satisfy every CHECK).
 *
 * - `identity.login_throttle`: ONE row per scope — the key is an HMAC-SHA-256 of the normalised e-mail (the account, for the browsers it does not know) or
 *   of the identifier of a known browser, under a key of the server (`LOGIN_THROTTLE_KEY`); the table holds neither an address nor a plain hash of one. The
 *   row is the counter of failures in a fixed window of 15 minutes (reserved tries included), how many of them failed at the second step, and the lock
 *   with its cause (`password` | `second_step`). `scope = 'spike'` is the one row that counts failed passwords of all accounts for the alert. A row is
 *   deleted by the job of retention after `expires_at` (30 minutes past its window or lock).
 * - `identity.browser_devices`: the register of browsers an account signed in from (the cookie `__Host-evia_device`): only the SHA-256 of the 256-bit
 *   token, the account and two dates — no user agent, no address, no place. Deleted 30 days after the last use and with the deactivation, the reset of
 *   the second step and the reset of the password.
 * - `identity.login_attempts.throttle_key`: the scope the first step was counted in; the second step counts on it, whatever cookie it arrives with.
 * - `platform.security_alert_outbox.alert_code` knows the alerts of EVM-026 (a flood of failed passwords, failures of the second step, a lock);
 *   `platform.email_outbox.kind` knows `account_locked` and `new_browser`.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table identity.login_throttle (
      scope_key bytea primary key check (length(scope_key) = 32),
      scope text not null check (scope in ('account', 'browser', 'spike')),
      window_started_at timestamptz not null,
      failures integer not null default 0 check (failures >= 0),
      second_step_failures integer not null default 0 check (second_step_failures >= 0),
      locked_until timestamptz,
      lock_cause text check (lock_cause in ('password', 'second_step')),
      expires_at timestamptz not null,
      constraint login_throttle_lock_check check ((locked_until is null) = (lock_cause is null))
    )
  `.execute(db);
  await sql`create index login_throttle_expires_at_idx on identity.login_throttle (expires_at)`.execute(db);
  await sql`grant select, insert, update, delete on identity.login_throttle to evia_app`.execute(db);

  await sql`
    create table identity.browser_devices (
      id uuid primary key default uuidv7(),
      user_id uuid not null references identity.users (id),
      token_sha256 bytea not null unique check (length(token_sha256) = 32),
      created_at timestamptz not null,
      last_seen_at timestamptz not null
    )
  `.execute(db);
  await sql`create index browser_devices_user_id_idx on identity.browser_devices (user_id)`.execute(db);
  await sql`create index browser_devices_last_seen_at_idx on identity.browser_devices (last_seen_at)`.execute(db);
  await sql`grant select, insert, update, delete on identity.browser_devices to evia_app`.execute(db);

  await sql`alter table identity.login_attempts add column throttle_key bytea check (throttle_key is null or length(throttle_key) = 32)`.execute(
    db,
  );

  await sql`
    alter table platform.security_alert_outbox
      drop constraint security_alert_outbox_alert_code_check,
      add constraint security_alert_outbox_alert_code_check
        check (alert_code in ('emergency_reset', 'projection_authz_drift', 'login_failure_spike', 'second_step_failure_spike', 'account_locked'))
  `.execute(db);
  await sql`
    alter table platform.email_outbox
      drop constraint email_outbox_kind_check,
      add constraint email_outbox_kind_check
        check (kind in (
          'user_invitation', 'administrator_alert', 'password_reset', 'password_changed', 'mfa_changed', 'recovery_code_used',
          'account_locked', 'new_browser'
        ))
  `.execute(db);
}
