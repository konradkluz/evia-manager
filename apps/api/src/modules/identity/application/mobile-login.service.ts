/**
 * Sign-in of the phone, first step (EVM-094 AC1–AC3, AC5–AC7; SR-AUTH-05, SR-AUTH-14, SR-SESS-04; CWE-204, CWE-208): e-mail, password and the description of
 * the device. The order is fixed by the contract (EVM-090) and is the reason for most of this file:
 *
 * 1. the version of the app (426) — the guard, before anything here, so before the hashing of the password;
 * 2. the signal of the wipe, BEFORE the password: a pair `deviceId` + secret that fits a device ordered to wipe proves that the caller holds that very
 *    installation (256 bits nobody guesses), so the answer `401 device_wipe_required` tells nothing about any account — and a stolen phone with an expired
 *    token gets the signal although nobody knows the password. It comes before the counters on purpose: a lock that somebody else provoked must not hold back
 *    the order to wipe;
 * 3. the counter against guessing: the device the ACCOUNT knows (a pair that fits a device of this account in the state `active`, the newest or the previous
 *    secret) has its own scope, so a lock caused by strangers does not switch off the technician's phone; every other pair (another account's, a wrong secret,
 *    an unknown device) is ignored and counted in the account's scope (SR-AUTH-05). A known device is a second pool of tries for a thief who holds the secret
 *    (the same trade-off as the cookie of a browser, RR-28);
 * 4. the password — exactly one Argon2id verification whatever the case, and one answer `401 invalid_credentials` for all failures;
 * 5. only after a correct password: `403 mfa_enrollment_required` (no second step at all) and `403 totp_not_configured` (a key only: a phone has no keys);
 * 6. the challenge — a token bound to the account, the description of the device and the device it recognised, valid 5 minutes, once.
 *
 * `channel_not_allowed` and `device_limit_reached` wait for the correct code (the second step): a password alone must not tell the role or the devices.
 */
import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { MobileLoginRequestWritable } from '@evia/contracts';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import type { Sleeper } from '../../../platform/http/response-floor.ts';
import { CLOCK, DATABASE, SLEEPER } from '../../../platform/tokens.ts';
import type { ClientVersion } from '../domain/client-version.ts';
import { LOGIN_ATTEMPT_TTL_MS } from '../domain/constants.ts';
import { matchSecret, type SecretMatch } from '../domain/device-rules.ts';
import { hashToken } from '../domain/tokens.ts';
import { normalizeEmail } from '../domain/text.ts';
import { findDeviceById, insertMobileChallenge, type DeviceDescription, type DeviceRecord } from '../infrastructure/device-queries.ts';
import { findTotpFactor } from '../infrastructure/mfa-queries.ts';
import { PASSWORD_HASHER, type PasswordHasher } from '../infrastructure/ports.ts';
import { findLoginAttempt, findLoginUser, hasPasskey, type LoginUser } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import type { ClientInfo } from './activation.service.ts';
import { LoginFailures, type LoginFailure } from './login-failures.ts';
import { LoginThrottle, type ThrottleTicket } from './login-throttle.ts';
import { openSecondStep } from './second-step.ts';

export interface MobileChallenge {
  readonly challengeToken: string;
  readonly challengeExpiresAt: Date;
}

/** The device a pair names, when the pair is the one of a device of THIS account that the account may use (SR-AUTH-05). */
interface KnownDevice {
  readonly device: DeviceRecord;
  readonly matchedBy: SecretMatch;
}

@Injectable()
export class MobileLoginService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #hasher: PasswordHasher;
  readonly #failures: LoginFailures;
  readonly #throttle: LoginThrottle;
  readonly #sleeper: Sleeper;
  /** Created at start with the current parameters: the unknown-account, the not-active and the locked paths verify against it. */
  readonly #dummyHash: Promise<string>;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(PASSWORD_HASHER) hasher: PasswordHasher,
    @Inject(LoginFailures) failures: LoginFailures,
    @Inject(LoginThrottle) throttle: LoginThrottle,
    @Inject(SLEEPER) sleeper: Sleeper,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#hasher = hasher;
    this.#failures = failures;
    this.#throttle = throttle;
    this.#sleeper = sleeper;
    this.#dummyHash = hasher.hash(randomBytes(32).toString('base64url'));
  }

  async login(body: MobileLoginRequestWritable, version: ClientVersion, client: ClientInfo): Promise<MobileChallenge> {
    const now = this.#clock.now();
    const db = identityTables(this.#db);
    const normalized = normalizeEmail(body.email);
    const found = await findLoginUser(db, normalized);

    // The pair is evaluated whatever the account is: the same two comparisons for a known device, an unknown one and a pair of another account.
    const pair =
      body.deviceId !== undefined && body.installationSecret !== undefined
        ? await this.#evaluatePair(body.deviceId, body.installationSecret, now)
        : undefined;
    if (pair?.matchedBy !== undefined && pair.device?.state === 'wipe_required') {
      await runInTransaction(this.#db, (transaction) =>
        this.#failures.record(transaction, 'device_wipe_required', found?.userId, client.context),
      );
      throw new ProblemException('device_wipe_required');
    }
    const known: KnownDevice | undefined =
      pair?.matchedBy !== undefined && pair.device !== undefined && found !== undefined && this.#isKnownBy(pair.device, found.userId)
        ? { device: pair.device, matchedBy: pair.matchedBy }
        : undefined;

    const scope = known === undefined ? this.#throttle.accountScope(normalized) : this.#throttle.browserScope(known.device.id);
    const reservation = await runInTransaction(this.#db, (transaction) => this.#throttle.reserve(transaction, scope, now));
    if (!reservation.granted) {
      await this.#hasher.verify(await this.#dummyHash, body.password.normalize('NFC'));
      throw new ProblemException('rate_limited', { retryAfterSeconds: reservation.retryAfterSeconds });
    }
    if (reservation.delayMs > 0) await this.#sleeper.sleep(reservation.delayMs);
    const ticket: ThrottleTicket = { scope, reserved: reservation.reserved, active: found?.status === 'active' };

    const verdict = await this.#checkPassword(found, body.password.normalize('NFC'));
    if (verdict.failure !== undefined) return this.#reject(verdict.failure, found?.userId, client, ticket);
    const { user } = verdict;

    const outcome = await runInTransaction(this.#db, async (transaction): Promise<MobileChallenge | { readonly refusal: LoginFailure }> => {
      const tx = identityTables(transaction);
      await this.#throttle.release(transaction, scope, reservation.reserved, now);
      const factor = await findTotpFactor(tx, user.userId);
      if (factor?.state !== 'active') {
        const reason: LoginFailure = (await hasPasskey(tx, user.userId)) ? 'totp_not_configured' : 'mfa_enrollment_required';
        await this.#failures.record(transaction, reason, user.userId, client.context);
        return { refusal: reason };
      }
      const loginToken = await openSecondStep(transaction, user.userId, now, scope.key, 'mobile');
      const attempt = await findLoginAttempt(tx, hashToken(loginToken));
      if (attempt === undefined) throw new Error('the attempt that was just stored is missing');
      await insertMobileChallenge(tx, {
        attemptId: attempt.id,
        description: describe(body, version),
        matchedDeviceId: known?.device.id,
        matchedBy: known?.matchedBy,
        secretMismatch: body.deviceId !== undefined && known === undefined,
        userId: user.userId,
        totpFactorId: factor.id,
      });
      return { challengeToken: loginToken, challengeExpiresAt: new Date(now.getTime() + LOGIN_ATTEMPT_TTL_MS) };
    });
    if ('refusal' in outcome) {
      throw new ProblemException(outcome.refusal === 'totp_not_configured' ? 'totp_not_configured' : 'mfa_enrollment_required');
    }
    return outcome;
  }

  async #evaluatePair(
    deviceId: string,
    secret: string,
    now: Date,
  ): Promise<{ readonly device: DeviceRecord | undefined; readonly matchedBy: SecretMatch | undefined }> {
    const device = await findDeviceById(identityTables(this.#db), deviceId);
    // For an unknown device the comparison runs against decoys: no branch tells whether the identifier exists.
    const matchedBy = matchSecret(device?.removed === true ? undefined : device?.secrets, hashToken(secret), now);
    return { device: device?.removed === true ? undefined : device, matchedBy };
  }

  #isKnownBy(device: DeviceRecord, userId: string): boolean {
    return device.userId === userId && device.state === 'active' && !device.removed;
  }

  /** Exactly one verification whatever the case: against the stored hash of an active account, otherwise against the dummy. */
  async #checkPassword(
    user: LoginUser | undefined,
    password: string,
  ): Promise<{ readonly failure: undefined; readonly user: LoginUser } | { readonly failure: LoginFailure }> {
    const storedHash = user?.status === 'active' ? user.passwordHash : null;
    const matches = await this.#hasher.verify(storedHash ?? (await this.#dummyHash), password);
    if (user === undefined) return { failure: 'unknown_user' };
    if (storedHash === null) return { failure: 'not_active' };
    return matches ? { failure: undefined, user } : { failure: 'bad_password' };
  }

  async #reject(reason: LoginFailure, userId: string | undefined, client: ClientInfo, ticket: ThrottleTicket): Promise<never> {
    await runInTransaction(this.#db, (transaction) => this.#failures.record(transaction, reason, userId, client.context, ticket));
    throw new ProblemException('invalid_credentials');
  }
}

/** The description of the device out of the body and the headers (the platform and the version of the app come from the headers, validated by the guard). */
function describe(body: MobileLoginRequestWritable, version: ClientVersion): DeviceDescription {
  return {
    model: body.device.model,
    osVersion: body.device.osVersion,
    securityPatch: body.device.securityPatch,
    platform: version.platform,
    appVersion: version.version,
    publicKey: body.devicePublicKey,
  };
}
