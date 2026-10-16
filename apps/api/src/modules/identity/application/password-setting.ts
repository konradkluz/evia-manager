/**
 * Setting a new password (SR-AUTH-01, SR-AUTH-02; ASVS V6.2.x, V11.4.2), shared by the activation of an account and the reset of a
 * forgotten password — one set of rules, one place. Order of work (the caller has already checked its link, so an invalid link costs no
 * CPU and no outbound traffic): local policy (length, popular and contextual passwords) → Pwned Passwords (k-anonymity) → Argon2id.
 *
 * The password is hashed in its NFC form: the same password typed with a different Unicode composition must verify (EVM-067).
 * Pwned Passwords is a second opinion: when it cannot be reached the local checks stand and the work goes on (the log says so,
 * without the password or its hash prefix).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Clock } from '../../../platform/clock/clock.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import type { Logger } from '../../../platform/logging/logger.ts';
import { CLOCK, LOGGER } from '../../../platform/tokens.ts';
import { checkPassword } from '../domain/password-policy.ts';
import { BREACHED_PASSWORD_CHECK, PASSWORD_HASHER, type BreachedPasswordCheck, type PasswordHasher } from '../infrastructure/ports.ts';

/** What the policy knows about the account: words that make a password weak in context. */
export interface PasswordContext {
  readonly email: string;
  readonly displayName: string;
}

@Injectable()
export class PasswordSetting {
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #hasher: PasswordHasher;
  readonly #breaches: BreachedPasswordCheck;

  constructor(
    @Inject(CLOCK) clock: Clock,
    @Inject(LOGGER) logger: Logger,
    @Inject(PASSWORD_HASHER) hasher: PasswordHasher,
    @Inject(BREACHED_PASSWORD_CHECK) breaches: BreachedPasswordCheck,
  ) {
    this.#clock = clock;
    this.#logger = logger;
    this.#hasher = hasher;
    this.#breaches = breaches;
  }

  /** @returns the Argon2id hash of the NFC form of an acceptable password; @throws `400 validation_failed` on `/password` otherwise */
  async hashAcceptable(password: string, context: PasswordContext): Promise<string> {
    const fault = checkPassword(password, { email: context.email, displayName: context.displayName, now: this.#clock.now() });
    if (fault !== null) throw new ProblemException('validation_failed', { errors: [{ pointer: '/password', code: fault }] });
    await this.#rejectBreached(password);
    return this.#hasher.hash(password.normalize('NFC'));
  }

  async #rejectBreached(password: string): Promise<void> {
    const result = await this.#breaches.check(password.normalize('NFC'));
    if (result === 'breached') throw new ProblemException('validation_failed', { errors: [{ pointer: '/password', code: 'too_weak' }] });
    if (result === 'unavailable') this.#logger.warn('pwned passwords unavailable; the local password checks were used');
  }
}
