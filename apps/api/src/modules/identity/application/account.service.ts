/**
 * The own account of the signed-in person (EVM-028 AC1, AC3, AC5; SR-DATA-03, SR-AUTHZ-05): the profile and the list of the methods of the second step for
 * the page W-15, and the change of the name shown to others. The account is ALWAYS the one of the session — there is no identifier of an account in any
 * request, so there is nothing to point at somebody else's (IDOR is closed by the shape of the API, not by a check).
 *
 * The answer holds personal data (the address, the name, the names of the keys): the global `Cache-Control: no-store` applies. It never holds a secret, a
 * public key, a credential id or a hash. A change of the name is audited WITHOUT the name (the trail cannot be erased, RODO art. 17).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Account } from '@evia/contracts';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { normalizeDisplayName } from '../domain/account-input.ts';
import { DEFAULT_PASSKEY_NAME } from '../domain/constants.ts';
import type { IdentityEvent } from '../events.ts';
import {
  currentRecoveryGenerationAt,
  findActiveTotpSummary,
  listPasskeySummaries,
  updateDisplayName,
} from '../infrastructure/account-queries.ts';
import { countAvailableRecoveryCodes } from '../infrastructure/mfa-queries.ts';
import { findUserById } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import type { ClientInfo } from './activation.service.ts';

@Injectable()
export class AccountService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;

  constructor(@Inject(DATABASE) db: Kysely<Database>, @Inject(CLOCK) clock: Clock, @Inject(EVENT_BUS) events: EventBus) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
  }

  async get(principal: Principal): Promise<Account> {
    return this.#read(identityTables(this.#db), principal.userId);
  }

  async updateProfile(principal: Principal, rawDisplayName: string, client: ClientInfo): Promise<Account> {
    const name = normalizeDisplayName(rawDisplayName);
    if (!name.ok) throw new ProblemException('validation_failed', { errors: name.errors });
    return runInTransaction(this.#db, async (transaction) => {
      const tx = identityTables(transaction);
      const user = await findUserById(tx, principal.userId, true);
      if (user?.status !== 'active') throw new ProblemException('session_revoked');
      await updateDisplayName(tx, principal.userId, name.value, this.#clock.now());
      const updated: IdentityEvent = {
        type: 'account.profile_updated',
        actor: { type: 'user', userId: principal.userId },
        outcome: 'success',
        objectType: 'user',
        objectId: principal.userId,
      };
      await this.#events.publish(transaction, updated, { ...client.context, sessionId: principal.sessionId });
      return this.#read(tx, principal.userId);
    });
  }

  async #read(tx: ReturnType<typeof identityTables>, userId: string): Promise<Account> {
    const user = await findUserById(tx, userId);
    if (user === undefined) throw new ProblemException('session_revoked');
    const passkeys = await listPasskeySummaries(tx, userId);
    const totp = await findActiveTotpSummary(tx, userId);
    const generatedAt = await currentRecoveryGenerationAt(tx, userId);
    return {
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      secondStep: {
        passkeys: passkeys.map((key) => ({
          id: key.id,
          name: key.name ?? DEFAULT_PASSKEY_NAME,
          createdAt: key.createdAt.toISOString(),
          deviceType: key.deviceType,
          backedUp: key.backedUp,
        })),
        totp: totp === undefined ? null : { addedAt: totp.addedAt.toISOString() },
        recoveryCodes:
          generatedAt === undefined
            ? null
            : { remaining: await countAvailableRecoveryCodes(tx, userId), generatedAt: generatedAt.toISOString() },
      },
    };
  }
}
