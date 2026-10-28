/**
 * Starting a session of the phone and issuing its tokens (EVM-094; ADR-0005, SR-SESS-09; CWE-384), shared by the second step of the sign-in and the renewal of
 * tokens. One transaction of the caller. A session of the `mobile` channel belongs to a device; its deadlines are its own (14 days without a refresh, 30 days
 * from the sign-in) — the 60 minutes and 12 hours of the panel do not apply to it. The row of the session carries a hash of random bytes nobody holds as its
 * `token_hash`: the phone has no cookie, and no value anyone could send in a cookie opens it.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import { MOBILE_ABSOLUTE_MS, MOBILE_ACCESS_TOKEN_TTL_MS, MOBILE_IDLE_MS } from '../domain/constants.ts';
import { newAccessToken, newRefreshToken } from '../domain/mobile-tokens.ts';
import { hashToken } from '../domain/tokens.ts';
import type { IdentityEvent } from '../events.ts';
import { expireAccessTokens, insertAccessToken, insertRefreshToken } from '../infrastructure/mobile-token-queries.ts';
import { insertSession } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import type { ClientInfo } from './activation.service.ts';

export interface IssuedTokens {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
}

const min = (left: Date, right: Date): Date => (left < right ? left : right);

/** A new pair of tokens for the session; the earlier access tokens of the session stop at once. `parentId`: the refresh token this one succeeds. */
export async function issueTokenPair(
  transaction: Kysely<Database>,
  request: { readonly sessionId: string; readonly parentId: string | null; readonly now: Date; readonly absoluteExpiresAt: Date },
): Promise<IssuedTokens & { readonly refreshTokenId: string; readonly idleExpiresAt: Date }> {
  const { sessionId, parentId, now, absoluteExpiresAt } = request;
  const db = identityTables(transaction);
  const accessToken = newAccessToken();
  const refreshToken = newRefreshToken();
  const accessTokenExpiresAt = min(new Date(now.getTime() + MOBILE_ACCESS_TOKEN_TTL_MS), absoluteExpiresAt);
  const refreshTokenExpiresAt = min(new Date(now.getTime() + MOBILE_IDLE_MS), absoluteExpiresAt);
  await expireAccessTokens(db, sessionId, now);
  await insertAccessToken(db, { tokenHash: hashToken(accessToken), sessionId, now, expiresAt: accessTokenExpiresAt });
  const refreshTokenId = await insertRefreshToken(db, {
    tokenHash: hashToken(refreshToken),
    sessionId,
    parentId,
    now,
    expiresAt: refreshTokenExpiresAt,
  });
  return { accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt, refreshTokenId, idleExpiresAt: refreshTokenExpiresAt };
}

export interface StartedMobileSession extends IssuedTokens {
  readonly sessionId: string;
}

export async function startMobileSession(
  transaction: Kysely<Database>,
  events: EventBus,
  request: { readonly userId: string; readonly deviceId: string; readonly client: ClientInfo; readonly now: Date },
): Promise<StartedMobileSession> {
  const { userId, deviceId, client, now } = request;
  const absoluteExpiresAt = new Date(now.getTime() + MOBILE_ABSOLUTE_MS);
  const sessionId = await insertSession(identityTables(transaction), {
    userId,
    channel: 'mobile',
    state: 'active',
    tokenHash: createHash('sha256').update(randomBytes(32)).digest(),
    linkId: null,
    now,
    passkeyAuthenticatedAt: null,
    totpAuthenticatedAt: now,
    idleExpiresAt: new Date(now.getTime() + MOBILE_IDLE_MS),
    absoluteExpiresAt,
    ip: client.context.ip,
    userAgent: undefined,
    deviceId,
  });
  const created: IdentityEvent = {
    type: 'session.created',
    actor: { type: 'user', userId },
    outcome: 'success',
    objectType: 'session',
    objectId: sessionId,
  };
  await events.publish(transaction, created, { ...client.context, sessionId });
  const tokens = await issueTokenPair(transaction, { sessionId, parentId: null, now, absoluteExpiresAt });
  return { sessionId, ...tokens };
}
