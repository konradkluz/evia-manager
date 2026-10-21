/**
 * Helpers of the tests of the protection against guessing passwords (EVM-026): a hasher that records every verification, a sleeper that looks at the
 * database while the app waits, the counters as they stand in the table, the key of an address (computed from the key of the app under test) and a run
 * of wrong passwords. Synthetic data only.
 */
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { Argon2PasswordHasher } from '../../src/modules/identity/infrastructure/argon2-password-hasher.ts';
import { accountKey, browserKey } from '../../src/modules/identity/domain/throttle-keys.ts';
import type { AppConfig } from '../../src/platform/config/config.ts';
import { APP_CONFIG } from '../../src/platform/tokens.ts';
import { RecordingSleeper, type IdentityApp } from './identity-app.ts';
import { firstStep } from './login-flows.ts';
import type { PanelClient } from './panel-client.ts';

export const WRONG = 'Wrong-pass-0000-x';

/** Records every verification: the hash it ran against (the stored one or the dummy), the password and how many waits had been asked for by then. */
export class CountingHasher extends Argon2PasswordHasher {
  readonly verifications: Array<{ hash: string; password: string; waitsBefore: number }> = [];
  sleeper: RecordingSleeper | undefined;

  override verify(hashed: string, password: string): Promise<boolean> {
    this.verifications.push({ hash: hashed, password, waitsBefore: this.sleeper?.slept.length ?? 0 });
    return super.verify(hashed, password);
  }
}

/** A sleeper that, at the moment the app waits, counts the transactions the app holds open (the wait must be outside any). */
export class InspectingSleeper extends RecordingSleeper {
  readonly openTransactions: number[] = [];
  readonly #app: () => IdentityApp | undefined;

  constructor(app: () => IdentityApp | undefined) {
    super();
    this.#app = app;
  }

  override async sleep(milliseconds: number): Promise<void> {
    const app = this.#app();
    if (app !== undefined) {
      const { rows } = await sql<{ open: string }>`
        select count(*)::text as open from pg_stat_activity
        where datname = current_database() and state like 'idle in transaction%' and pid <> pg_backend_pid()`.execute(app.database.admin);
      this.openTransactions.push(Number(rows[0]?.open ?? '0'));
    }
    return super.sleep(milliseconds);
  }
}

export interface ThrottleRow {
  scope_key: Buffer;
  scope: string;
  window_started_at: Date;
  failures: number;
  second_step_failures: number;
  locked_until: Date | null;
  lock_cause: string | null;
  expires_at: Date;
}

export async function throttleRows(app: IdentityApp): Promise<ThrottleRow[]> {
  const { rows } =
    await sql<ThrottleRow>`select * from identity.login_throttle where scope <> 'spike' order by window_started_at, scope_key`.execute(
      app.database.admin,
    );
  return rows;
}

const keyOf = (app: IdentityApp): Buffer => app.app.get<AppConfig>(APP_CONFIG, { strict: false }).loginThrottleKey;

/** The counter of an account for the browsers it does not know — the row of the address. */
export async function accountRow(app: IdentityApp, email: string): Promise<ThrottleRow | undefined> {
  const wanted = accountKey(keyOf(app), email);
  return (await throttleRows(app)).find((row) => row.scope_key.equals(wanted));
}

/** The counter of one known browser. */
export async function browserRow(app: IdentityApp, deviceId: string): Promise<ThrottleRow | undefined> {
  const wanted = browserKey(keyOf(app), deviceId);
  return (await throttleRows(app)).find((row) => row.scope_key.equals(wanted));
}

export const accountKeyOf = (app: IdentityApp, email: string): Buffer => accountKey(keyOf(app), email);
export const browserKeyOf = (app: IdentityApp, deviceId: string): Buffer => browserKey(keyOf(app), deviceId);

/** `count` wrong passwords for `email`, one after the other, `everyMs` apart on the clock of the app (default 3 s: all in one window, each in its own second). */
export async function wrongPasswords(
  app: IdentityApp,
  email: string,
  count: number,
  options: { panel?: () => PanelClient; everyMs?: number } = {},
): Promise<Response[]> {
  const responses: Response[] = [];
  for (let attempt = 0; attempt < count; attempt += 1) {
    responses.push(await firstStep((options.panel ?? (() => app.panel()))(), email, WRONG));
    app.clock.advance(options.everyMs ?? 3000);
  }
  return responses;
}

/** The identifier of the only browser the account has in the register. */
export async function deviceIdsOf(app: IdentityApp, userId: string): Promise<string[]> {
  const { rows } = await sql<{
    id: string;
  }>`select id from identity.browser_devices where user_id = ${userId} order by created_at, id`.execute(app.database.admin);
  return rows.map((row) => row.id);
}

/** The audit events of a lock, newest last. */
export async function lockEvents(
  app: IdentityApp,
): Promise<Array<{ action: string; reason_code: string | null; object_id: string | null; actor_type: string; outcome: string }>> {
  const { rows } = await sql<{ action: string; reason_code: string | null; object_id: string | null; actor_type: string; outcome: string }>`
    select action, reason_code, object_id, actor_type, outcome from audit.events
    where action in ('account.locked', 'account.browser_locked') order by occurred_at, id`.execute(app.database.admin);
  return rows;
}

export async function alertCodes(app: IdentityApp): Promise<string[]> {
  const { rows } = await sql<{
    alert_code: string;
  }>`select alert_code from platform.security_alert_outbox order by occurred_at, id`.execute(app.database.admin);
  return rows.map((row) => row.alert_code);
}
