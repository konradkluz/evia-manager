/**
 * Starting a session at sign-in (SR-SESS-02, SR-AUTH-14; CWE-384), shared by both steps of the login. One transaction
 * of the caller: a new token from the CSPRNG, the session of the `web` channel (the channel is given by the path, never
 * by the client), the revocation of the session of the request's cookie with the reason `rotated` — only when the request
 * carried exactly one such cookie (a doubled cookie may be planted: nothing is revoked on its word) — and the audit
 * events of both.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import { SESSION_ABSOLUTE_MS } from '../domain/constants.ts';
import { deadlinesAt } from '../domain/session-policy.ts';
import { deriveCsrfToken, hashToken, newToken } from '../domain/tokens.ts';
import type { IdentityEvent } from '../events.ts';
import { insertSession, revokeSessionByTokenHash } from '../infrastructure/queries.ts';
import { identityTables, type SessionsTable } from '../infrastructure/tables.ts';
import type { ClientInfo, NewSessionResult } from './activation.service.ts';

export interface StartedSession extends NewSessionResult {
  readonly sessionId: string;
}

export async function startSession(
  transaction: Kysely<Database>,
  events: EventBus,
  request: {
    readonly userId: string;
    readonly state: SessionsTable['state'];
    /** The session token of the request's cookie, when it carried exactly one. */
    readonly previousSessionToken: string | undefined;
    readonly client: ClientInfo;
    readonly now: Date;
    /** `now` for the sign-in with a passkey; null for every other way (password only, recovery code — SR-SESS-08). */
    readonly passkeyAuthenticatedAt: Date | null;
  },
): Promise<StartedSession> {
  const { userId, state, previousSessionToken, client, now, passkeyAuthenticatedAt } = request;
  const tx = identityTables(transaction);
  const actor = { type: 'user', userId } as const;
  const sessionToken = newToken();

  const revoked =
    previousSessionToken === undefined ? [] : await revokeSessionByTokenHash(tx, hashToken(previousSessionToken), 'rotated', now);
  for (const id of revoked) {
    const event: IdentityEvent = {
      type: 'session.revoked',
      actor,
      outcome: 'success',
      reasonCode: 'rotated',
      objectType: 'session',
      objectId: id,
    };
    await events.publish(transaction, event, { ...client.context, sessionId: id });
  }

  const sessionId = await insertSession(tx, {
    userId,
    channel: 'web',
    state,
    tokenHash: hashToken(sessionToken),
    linkId: null,
    now,
    passkeyAuthenticatedAt,
    ...deadlinesAt(now),
    ip: client.context.ip,
    userAgent: client.userAgent,
  });
  const created: IdentityEvent = { type: 'session.created', actor, outcome: 'success', objectType: 'session', objectId: sessionId };
  await events.publish(transaction, created, { ...client.context, sessionId });

  return { sessionId, sessionToken, csrfToken: deriveCsrfToken(sessionToken), maxAgeSeconds: Math.floor(SESSION_ABSOLUTE_MS / 1000) };
}
