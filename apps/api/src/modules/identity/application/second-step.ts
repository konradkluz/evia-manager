/**
 * The second step of a sign-in, started (EVM-067 AC4; EVM-025 K1, K2; EVM-023): a single-use `loginToken` (256 bits from the CSPRNG, only its SHA-256 is
 * stored, 5 minutes) that the screen W-02 exchanges for a session after a passkey, a code of the authenticator app or a recovery code. It is the one way
 * both the password step of the sign-in and the end of a password reset reach W-02, so a reset cannot become a way around the second step.
 *
 * The caller decides WHEN it is allowed to call this (a proven password, a proven reset link) and runs it in its own transaction.
 */
import type { Channel } from '@evia/contracts';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { LOGIN_ATTEMPT_RETENTION_MS, LOGIN_ATTEMPT_TTL_MS } from '../domain/constants.ts';
import { totpAllowedForRole } from '../domain/channel-rules.ts';
import { hashToken, newToken } from '../domain/tokens.ts';
import { countAvailableRecoveryCodes, hasActiveTotp } from '../infrastructure/mfa-queries.ts';
import { deleteStaleLoginAttempts, findUserById, hasPasskey, insertLoginAttempt } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';

export type SecondStepMethod = 'passkey' | 'totp' | 'recovery_code';

/**
 * The second factors the account really has and may use in this channel (not a constant): empty means there is no second step to offer, and nothing
 * may start one. The role is read from the database now, never from a session (SR-AUTHZ-12). A pending TOTP factor is no factor. A recovery code is a
 * way back in, not a factor: it is offered only beside a factor, so an account that has codes but no factor still has to enrol.
 */
export async function secondStepMethods(tx: Kysely<Database>, userId: string, channel: Channel = 'web'): Promise<SecondStepMethod[]> {
  const db = identityTables(tx);
  const user = await findUserById(db, userId);
  if (user === undefined) return [];
  const methods: SecondStepMethod[] = [];
  if (await hasPasskey(db, userId)) methods.push('passkey');
  if (totpAllowedForRole(user.role, channel) && (await hasActiveTotp(db, userId))) methods.push('totp');
  if (methods.length > 0 && (await countAvailableRecoveryCodes(db, userId)) > 0) methods.push('recovery_code');
  return methods;
}

/**
 * Stores a new attempt for the account and @returns its raw token (it exists only in memory and in the response). `throttleKey` is the scope the first
 * step was counted in (EVM-026): the second step counts its failures there, whatever cookie its request carries.
 */
export async function openSecondStep(tx: Kysely<Database>, userId: string, now: Date, throttleKey: Buffer): Promise<string> {
  const loginToken = newToken();
  const db = identityTables(tx);
  await deleteStaleLoginAttempts(db, new Date(now.getTime() - LOGIN_ATTEMPT_RETENTION_MS));
  await insertLoginAttempt(db, {
    userId,
    tokenHash: hashToken(loginToken),
    now,
    expiresAt: new Date(now.getTime() + LOGIN_ATTEMPT_TTL_MS),
    throttleKey,
  });
  return loginToken;
}
