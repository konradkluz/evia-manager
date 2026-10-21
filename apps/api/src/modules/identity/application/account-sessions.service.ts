/**
 * "Moje sesje" (EVM-028 AC6, AC8; SR-SESS-07, SR-SESS-04, SR-AUTHZ-05, SR-DATA-03, P9; CWE-639, CWE-200): the person sees and ends the sessions of THEIR OWN
 * account. The guard has already asked for a fresh step-up (the window of 15 minutes). Ownership is in the WHERE of every query: the session of somebody else,
 * a missing one and one that is already over are the same `404 not_found` (the same body, no hint). The current session is ended by "Wyloguj", not here
 * (`409 current_session`).
 *
 * The list shows the browser and the system out of the closed dictionary (`describeUserAgent`) — never the raw user agent, never the hash of the token — and
 * the FULL address of the session of the owner (P9: kept 30 days, shown to the owner only). The identifier is the opaque id of the row.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { AccountSessionList, EndedSessions } from '@evia/contracts';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { describeUserAgent } from '../domain/user-agent.ts';
import type { IdentityEvent } from '../events.ts';
import { listOpenWebSessions, revokeOtherSessions, revokeOwnSession } from '../infrastructure/account-queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import type { ClientInfo } from './activation.service.ts';

@Injectable()
export class AccountSessionsService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;

  constructor(@Inject(DATABASE) db: Kysely<Database>, @Inject(CLOCK) clock: Clock, @Inject(EVENT_BUS) events: EventBus) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
  }

  async list(principal: Principal): Promise<AccountSessionList> {
    const rows = await listOpenWebSessions(identityTables(this.#db), principal.userId, this.#clock.now());
    return {
      items: rows.map((row) => ({
        id: row.id,
        current: row.id === principal.sessionId,
        ...describeUserAgent(row.userAgent),
        ipAddress: row.ipAddress,
        lastSeenAt: row.lastSeenAt.toISOString(),
      })),
    };
  }

  async end(principal: Principal, sessionId: string, client: ClientInfo): Promise<void> {
    if (sessionId === principal.sessionId) throw new ProblemException('current_session');
    await runInTransaction(this.#db, async (transaction) => {
      const ended = await revokeOwnSession(identityTables(transaction), principal.userId, sessionId, 'ended_by_user', this.#clock.now());
      if (!ended) throw new ProblemException('not_found');
      await this.#publish(transaction, principal, client, sessionId);
    });
  }

  async endOthers(principal: Principal, client: ClientInfo): Promise<EndedSessions> {
    return runInTransaction(this.#db, async (transaction) => {
      const ended = await revokeOtherSessions(
        identityTables(transaction),
        principal.userId,
        principal.sessionId,
        'ended_by_user',
        this.#clock.now(),
      );
      for (const sessionId of ended) await this.#publish(transaction, principal, client, sessionId);
      return { ended: ended.length };
    });
  }

  #publish(transaction: Kysely<Database>, principal: Principal, client: ClientInfo, sessionId: string): Promise<void> {
    const event: IdentityEvent = {
      type: 'session.revoked',
      actor: { type: 'user', userId: principal.userId },
      outcome: 'success',
      reasonCode: 'ended_by_user',
      objectType: 'session',
      objectId: sessionId,
    };
    return this.#events.publish(transaction, event, { ...client.context, sessionId });
  }
}
