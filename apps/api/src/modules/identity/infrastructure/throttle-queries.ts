/**
 * The queries of the counters against guessing and of the register of known browsers (EVM-026; SR-AUTH-05). The state machine is in
 * `domain/throttle-policy.ts`; here only the rows. Every change of a counter happens under `FOR UPDATE` of its row (inside the transaction of the caller),
 * so two requests of one scope are decided one after the other.
 */
import { sql } from 'kysely';
import { expiryOf, SPIKE_WINDOW_MS, THROTTLE_RETENTION_MS, type ThrottleState } from '../domain/throttle-policy.ts';
import type { IdentityDb, LoginThrottleTable } from './tables.ts';

type Scope = LoginThrottleTable['scope'];

const toState = (row: LoginThrottleTable): ThrottleState => ({
  windowStartedAt: row.window_started_at,
  failures: row.failures,
  secondStepFailures: row.second_step_failures,
  lockedUntil: row.locked_until,
  lockCause: row.lock_cause,
});

/** The row of a scope without a lock — to look at the state (the wait before the second step); `undefined` when nothing is counted. */
export async function readThrottle(db: IdentityDb, key: Buffer): Promise<ThrottleState | undefined> {
  const row = await db.selectFrom('identity.login_throttle').selectAll().where('scope_key', '=', key).executeTakeFirst();
  return row === undefined ? undefined : toState(row);
}

/**
 * The row of a scope, locked `FOR UPDATE` — created empty when there is none (`ON CONFLICT DO NOTHING`, so two first requests do not fail on the key
 * and queue on the row instead). A row that a job deleted between the two statements is created again.
 */
export async function lockThrottle(
  db: IdentityDb,
  key: Buffer,
  scope: Scope,
  now: Date,
): Promise<{ readonly state: ThrottleState; readonly scope: Scope }> {
  for (;;) {
    await db
      .insertInto('identity.login_throttle')
      .values({
        scope_key: key,
        scope,
        window_started_at: now,
        failures: 0,
        second_step_failures: 0,
        locked_until: null,
        lock_cause: null,
        expires_at: new Date(now.getTime() + THROTTLE_RETENTION_MS),
      })
      .onConflict((conflict) => conflict.column('scope_key').doNothing())
      .execute();
    const row = await db.selectFrom('identity.login_throttle').selectAll().where('scope_key', '=', key).forUpdate().executeTakeFirst();
    if (row !== undefined) return { state: toState(row), scope: row.scope };
  }
}

/** Writes the state of a row that the caller holds locked. */
export async function saveThrottle(db: IdentityDb, key: Buffer, state: ThrottleState): Promise<void> {
  await db
    .updateTable('identity.login_throttle')
    .set({
      window_started_at: state.windowStartedAt,
      failures: state.failures,
      second_step_failures: state.secondStepFailures,
      locked_until: state.lockedUntil,
      lock_cause: state.lockCause,
      expires_at: expiryOf(state),
    })
    .where('scope_key', '=', key)
    .execute();
}

/**
 * The end of a reset of the password lifts the lock whose cause is the password (EVM-026 AC7): the row goes — unless a failure of the second step is in
 * it, which a new password does not undo. A row that a sign-in holds locked at this moment is SKIPPED, never waited for: that sign-in may be waiting for
 * the row of the account which the caller holds (users → counter in one transaction, counter → users in the other: a deadlock). A skipped lock ends
 * with its own time. @returns whether a row was deleted
 */
export async function deletePasswordThrottle(db: IdentityDb, key: Buffer): Promise<boolean> {
  const rows = await db
    .deleteFrom('identity.login_throttle')
    .where(
      'scope_key',
      'in',
      db
        .selectFrom('identity.login_throttle')
        .select('scope_key')
        .where('scope_key', '=', key)
        .where('second_step_failures', '=', 0)
        .forUpdate()
        .skipLocked(),
    )
    .returning('scope_key')
    .execute();
  return rows.length > 0;
}

/** The counters of browsers that no longer exist; a row held locked by a sign-in is skipped (see above) — it can match nothing and the retention deletes it. */
export async function deleteThrottles(db: IdentityDb, keys: readonly Buffer[]): Promise<void> {
  if (keys.length === 0) return;
  await db
    .deleteFrom('identity.login_throttle')
    .where(
      'scope_key',
      'in',
      db.selectFrom('identity.login_throttle').select('scope_key').where('scope_key', 'in', keys).forUpdate().skipLocked(),
    )
    .execute();
}

/**
 * One more failed password anywhere, in a window of five minutes (the alert about a flood, SR-LOG-07). One statement: the window starts anew when it is
 * over. @returns the number of failures in the window, this one included
 */
export async function countSpike(db: IdentityDb, key: Buffer, now: Date): Promise<number> {
  const expires = new Date(now.getTime() + SPIKE_WINDOW_MS + THROTTLE_RETENTION_MS);
  const window = sql<number>`${SPIKE_WINDOW_MS / 1000} * interval '1 second'`;
  const row = await db
    .insertInto('identity.login_throttle')
    .values({
      scope_key: key,
      scope: 'spike',
      window_started_at: now,
      failures: 1,
      second_step_failures: 0,
      locked_until: null,
      lock_cause: null,
      expires_at: expires,
    })
    .onConflict((conflict) =>
      conflict.column('scope_key').doUpdateSet({
        window_started_at: sql<Date>`case when login_throttle.window_started_at + ${window} <= ${now} then ${now} else login_throttle.window_started_at end`,
        failures: sql<number>`case when login_throttle.window_started_at + ${window} <= ${now} then 1 else login_throttle.failures + 1 end`,
        expires_at: expires,
      }),
    )
    .returning('failures')
    .executeTakeFirstOrThrow();
  return row.failures;
}

/** The retention (RODO art. 5(1)(e)): rows past their `expires_at`. @returns how many were deleted */
export async function deleteExpiredThrottles(db: IdentityDb, now: Date): Promise<number> {
  const rows = await db.deleteFrom('identity.login_throttle').where('expires_at', '<', now).returning('scope_key').execute();
  return rows.length;
}

// --- the register of known browsers -------------------------------------------------------------------------------------------------------

export interface BrowserDeviceRecord {
  readonly id: string;
  readonly userId: string;
}

/** The browser of a cookie that belongs to THIS account (a cookie of another account is no cookie at all, M5); `forUpdate` for the rotation. */
export async function findBrowserOfUser(
  db: IdentityDb,
  userId: string,
  tokenSha256: Buffer,
  forUpdate = false,
): Promise<BrowserDeviceRecord | undefined> {
  let query = db
    .selectFrom('identity.browser_devices')
    .select(['id', 'user_id as userId'])
    .where('token_sha256', '=', tokenSha256)
    .where('user_id', '=', userId);
  if (forUpdate) query = query.forUpdate();
  return query.executeTakeFirst();
}

/** The cookie of a known browser is replaced by a new one; the identifier of the browser (and its counter) stays. */
export async function rotateBrowser(db: IdentityDb, id: string, tokenSha256: Buffer, now: Date): Promise<void> {
  await db.updateTable('identity.browser_devices').set({ token_sha256: tokenSha256, last_seen_at: now }).where('id', '=', id).execute();
}

export async function insertBrowser(db: IdentityDb, userId: string, tokenSha256: Buffer, now: Date): Promise<void> {
  await db
    .insertInto('identity.browser_devices')
    .values({ user_id: userId, token_sha256: tokenSha256, created_at: now, last_seen_at: now })
    .execute();
}

/** Keeps the newest `keep` browsers of the account (a colleague cannot swell the table by signing in without a cookie). @returns the identifiers deleted */
export async function trimBrowsers(db: IdentityDb, userId: string, keep: number): Promise<string[]> {
  const rows = await db
    .selectFrom('identity.browser_devices')
    .select('id')
    .where('user_id', '=', userId)
    .orderBy('last_seen_at', 'desc')
    .orderBy('id', 'desc')
    .offset(keep)
    .execute();
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) await db.deleteFrom('identity.browser_devices').where('id', 'in', ids).execute();
  return ids;
}

/** Every browser of the account is forgotten. @returns their identifiers (the counters of them go too) */
export async function deleteBrowsersOfUser(db: IdentityDb, userId: string): Promise<string[]> {
  const rows = await db.deleteFrom('identity.browser_devices').where('user_id', '=', userId).returning('id').execute();
  return rows.map((row) => row.id);
}

/** The retention: a browser not seen since `cutoff`. @returns the identifiers deleted */
export async function deleteStaleBrowsers(db: IdentityDb, cutoff: Date): Promise<string[]> {
  const rows = await db.deleteFrom('identity.browser_devices').where('last_seen_at', '<', cutoff).returning('id').execute();
  return rows.map((row) => row.id);
}
