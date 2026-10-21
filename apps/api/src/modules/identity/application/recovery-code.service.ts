/**
 * Recovery codes, the third step of the setup (EVM-023 AC4, AC6; SR-AUTH-08, SR-AUTH-10, ASVS V6.3.7, V7.5.1; CWE-640, CWE-312). Ten codes of 20 characters
 * of base32 from the CSPRNG are returned ONCE — there is no operation that reads them again — and stored only as Argon2id hashes.
 *
 * Two ways in, because "generate new codes" would otherwise let any session that is fresh for 15 minutes cancel the codes of the owner and read new ones — a
 * way to take the account for good:
 *   1. NEW CODES FROM THE ACCOUNT (EVM-028 AC5; SR-AUTH-08, SR-AUTH-10; ASVS V7.5.1): the one-time mark of the full re-authentication (`second_step_change`:
 *      the password and a second step), spent by a conditional UPDATE in this very transaction. Always allowed with it; the earlier codes stop working; the
 *      Administrator's account also sends the alert 9 (SR-LOG-07). No window of 15 minutes is needed.
 *   2. THE THIRD STEP OF THE SETUP (EVM-023): a fresh authentication of the session (the window of 15 minutes, checked here), and only when
 *      (a) the account has no codes yet (the first generation — the end of the setup of a second step), or
 *      (b) the current generation was made by THIS session (refreshing the third step: the earlier codes are retired in the same transaction).
 *      Anything else is `403 recovery_codes_regeneration_unavailable`. A session that came from a recovery code has no fresh authentication, so it never gets here.
 *
 * One transaction: the account is locked (two parallel generations are serialised), the case is decided, the current generation is retired
 * (`superseded_at`), the new one is inserted with the session that asked for it, the e-mail about the change goes to the outbox and the event is audited —
 * no code, no hash and no position of a code is in any of them. The Argon2id hashes are computed BEFORE the transaction (CPU work, no connection held).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { RecoveryCodes } from '@evia/contracts';
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { newRecoveryCodes } from '../domain/recovery-codes.ts';
import { lastStepUpAuthentication, stepUpFresh } from '../domain/session-policy.ts';
import type { IdentityEvent } from '../events.ts';
import { consumeReauthMark } from '../infrastructure/account-queries.ts';
import { currentRecoveryGenerationSessions, insertRecoveryCodes, supersedeRecoveryCodes } from '../infrastructure/mfa-queries.ts';
import { PASSWORD_HASHER, type PasswordHasher } from '../infrastructure/ports.ts';
import { findUserById } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import type { ClientInfo } from './activation.service.ts';
import { noticeSecondStepChange } from './second-step-notice.ts';

@Injectable()
export class RecoveryCodeService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #hasher: PasswordHasher;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(PASSWORD_HASHER) hasher: PasswordHasher,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#hasher = hasher;
  }

  async generate(principal: Principal, client: ClientInfo): Promise<RecoveryCodes> {
    const now = this.#clock.now();
    const codes = newRecoveryCodes();
    const hashes = await Promise.all(codes.map((code) => this.#hasher.hash(code)));

    await runInTransaction(this.#db, async (transaction) => {
      const tx = identityTables(transaction);
      // The first lock of the unit of work: two parallel generations of one account are serialised here.
      const user = await findUserById(tx, principal.userId, true);
      if (user?.status !== 'active') throw new ProblemException('forbidden');

      const fromAccount = await consumeReauthMark(tx, principal.sessionId, 'second_step_change', now);
      if (!fromAccount) {
        if (!stepUpFresh(lastStepUpAuthentication(principal), now)) throw new ProblemException('step_up_required');
        const generations = await currentRecoveryGenerationSessions(tx, principal.userId);
        const refresh = generations.length === 1 && generations[0] === principal.sessionId;
        if (generations.length > 0 && !refresh) throw new ProblemException('recovery_codes_regeneration_unavailable');
      }

      await supersedeRecoveryCodes(tx, principal.userId, now);
      await insertRecoveryCodes(tx, { userId: principal.userId, generationId: randomUUID(), sessionId: principal.sessionId, hashes, now });
      // The alert 9 belongs to new codes made from the account; the third step of a setup is part of the activation that the invitation already alerted.
      await noticeSecondStepChange(transaction, { userId: principal.userId, role: user.role }, 'recovery_codes_generated', now, {
        alertAdministrators: fromAccount,
      });
      const generated: IdentityEvent = {
        type: 'mfa.recovery_codes_generated',
        actor: { type: 'user', userId: principal.userId },
        outcome: 'success',
        objectType: 'user',
        objectId: principal.userId,
      };
      await this.#events.publish(transaction, generated, { ...client.context, sessionId: principal.sessionId });
    });
    return { codes: codes as RecoveryCodes['codes'] };
  }
}
