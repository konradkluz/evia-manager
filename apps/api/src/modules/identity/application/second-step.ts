/**
 * The second step of a sign-in, started (EVM-067 AC4; EVM-025 K1, K2): a single-use `loginToken` (256 bits from the CSPRNG, only its SHA-256 is
 * stored, 5 minutes) that the screen W-02 exchanges for a session after a passkey. It is the one way both the password step of the sign-in
 * and the end of a password reset reach W-02, so a reset cannot become a way around the second step.
 *
 * The caller decides WHEN it is allowed to call this (a proven password, a proven reset link) and runs it in its own transaction.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { LOGIN_ATTEMPT_RETENTION_MS, LOGIN_ATTEMPT_TTL_MS } from '../domain/constants.ts';
import { hashToken, newToken } from '../domain/tokens.ts';
import { deleteStaleLoginAttempts, hasPasskey, insertLoginAttempt } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';

export type SecondStepMethod = 'passkey';

/** The second factors the account really has (not a constant): empty means there is no second step to offer, and nothing may start one. */
export async function secondStepMethods(tx: Kysely<Database>, userId: string): Promise<SecondStepMethod[]> {
  return (await hasPasskey(identityTables(tx), userId)) ? ['passkey'] : [];
}

/** Stores a new attempt for the account and @returns its raw token (it exists only in memory and in the response). */
export async function openSecondStep(tx: Kysely<Database>, userId: string, now: Date): Promise<string> {
  const loginToken = newToken();
  const db = identityTables(tx);
  await deleteStaleLoginAttempts(db, new Date(now.getTime() - LOGIN_ATTEMPT_RETENTION_MS));
  await insertLoginAttempt(db, {
    userId,
    tokenHash: hashToken(loginToken),
    now,
    expiresAt: new Date(now.getTime() + LOGIN_ATTEMPT_TTL_MS),
  });
  return loginToken;
}
