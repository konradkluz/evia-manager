/**
 * The first step of a sign-in, as the second step finds it again (EVM-067 AC4; EVM-023 B3): shared by the passkey, the code of the authenticator app
 * and the recovery code, so that all three count against ONE budget of failures and refuse in the same way.
 *
 * An attempt that is unknown, already spent or of another account's token is no first step at all (`unauthenticated` — one answer for all); one that
 * ran out is `login_expired` and is audited. A failed second step does not spend the attempt (the person may retry) but is counted on it: the fifth
 * ends it, whatever the method. The audit event and the counter of `LoginFailures` carry the account (so the lock of an account, EVM-026, counts them).
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { EventContext } from '../../../platform/events/event-bus.ts';
import { LOGIN_MAX_FAILED_SECOND_STEPS } from '../domain/constants.ts';
import { hashToken } from '../domain/tokens.ts';
import { findLoginAttempt, recordFailedKey, type LoginAttemptRecord } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import type { LoginFailure, LoginFailures } from './login-failures.ts';

export type AttemptRefusal = 'unauthenticated' | 'login_expired';
export type OpenedAttempt = { readonly attempt: LoginAttemptRecord } | { readonly refusal: AttemptRefusal };

export async function openLoginAttempt(
  transaction: Kysely<Database>,
  failures: LoginFailures,
  loginToken: string,
  now: Date,
  context: EventContext,
): Promise<OpenedAttempt> {
  const attempt = await findLoginAttempt(identityTables(transaction), hashToken(loginToken));
  if (attempt === undefined || attempt.usedAt !== null) return { refusal: 'unauthenticated' };
  if (attempt.expiresAt > now) return { attempt };
  await failures.record(transaction, 'login_expired', attempt.userId, context);
  return { refusal: 'login_expired' };
}

/** Counts a failed second step on the attempt (the fifth ends it) and audits it. */
export async function recordSecondStepFailure(
  transaction: Kysely<Database>,
  failures: LoginFailures,
  attempt: LoginAttemptRecord,
  reason: Extract<LoginFailure, 'passkey_failed' | 'totp_failed' | 'recovery_code_failed'>,
  now: Date,
  context: EventContext,
): Promise<void> {
  await recordFailedKey(identityTables(transaction), attempt.id, now, LOGIN_MAX_FAILED_SECOND_STEPS);
  await failures.record(transaction, reason, attempt.userId, context);
}
