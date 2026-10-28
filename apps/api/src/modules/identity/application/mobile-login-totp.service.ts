/**
 * Sign-in of the phone, second step: the code of the authenticator app (EVM-094 AC1–AC3, AC5; SR-AUTH-07, SR-AUTH-05, SR-SESS-04, SR-AUTH-15; CWE-362,
 * CWE-367, CWE-294). One transaction does everything or nothing, in this order:
 *
 * 1. the challenge is found (a challenge of the other channel, a spent, an expired or an unknown one are the same `401 invalid_credentials`) and the try is
 *    reserved on its scope; a wrong code is counted on the challenge (the fifth ends it) and on the scope (the tenth locks), like in the panel;
 * 2. the ACCOUNT is locked (`FOR UPDATE`) before anything is counted: two parallel second steps of one account queue here, so the limit of devices cannot be
 *    passed by two phones at once (A1), and a deactivation cannot slip in between the check and the insert;
 * 3. the credentials are the ones the challenge was issued for (the password was not changed, the code factor is the same and still active — A5);
 * 4. the code is checked and its step spent by a conditional UPDATE — the SAME step as in the panel (`last_used_step`), so a code does not work once in the
 *    panel and once on the phone;
 * 5. the challenge is spent by an atomic UPDATE; from here every refusal (the role, the limit of devices, a wipe ordered between the steps) has used it up;
 * 6. the account is `active`; the role may use the mobile channel (`403 channel_not_allowed` — a read-only person has none); the limit of two devices holds
 *    for a device the account does not know (`403 device_limit_reached`), counted among the devices that have a valid session;
 * 7. the device is registered (or the one the first step recognised is updated), the installation secret rotated in two phases, earlier sessions of the same
 *    device ended, a new session with its tokens issued, and — for a new device — the owner (and the Administrators, for an Administrator) told.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { FieldEncryption } from '../../../platform/crypto/field-encryption.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import { enqueueEmail } from '../../../platform/email/email-outbox.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import { CLOCK, DATABASE, EVENT_BUS, FIELD_ENCRYPTION } from '../../../platform/tokens.ts';
import { channelAllowedForRole } from '../domain/channel-rules.ts';
import { MAX_MOBILE_DEVICES } from '../domain/constants.ts';
import { issueSecret, type SecretState } from '../domain/device-rules.ts';
import { hashToken, newToken } from '../domain/tokens.ts';
import type { IdentityEvent, ReasonCode } from '../events.ts';
import {
  countOtherActiveDevices,
  findDeviceById,
  findMobileChallenge,
  insertDevice,
  revokeSessionsOfDevice,
  updateDeviceAtLogin,
  type DeviceRecord,
  type MobileChallengeRecord,
} from '../infrastructure/device-queries.ts';
import { claimTotpStep, findTotpFactor } from '../infrastructure/mfa-queries.ts';
import { consumeLoginAttempt, findUserById, listActiveAdministratorIds, recordLogin } from '../infrastructure/queries.ts';
import { identityTables, type IdentityDb } from '../infrastructure/tables.ts';
import { TOTP_ENGINE, type TotpEngine } from '../infrastructure/totp-engine.ts';
import type { ClientInfo } from './activation.service.ts';
import { LoginAttemptGate, problemOf, type AttemptRefusal } from './login-attempt.ts';
import { LoginFailures } from './login-failures.ts';
import { startMobileSession, type StartedMobileSession } from './mobile-session.ts';
import { openTotpSecret } from './totp-secret.ts';

export interface SignedInDevice extends StartedMobileSession {
  readonly deviceId: string;
  readonly installationSecret: string;
  readonly user: { readonly id: string; readonly displayName: string; readonly role: 'administrator' | 'editor' | 'read_only' };
  readonly serverTime: Date;
}

type Refusal =
  { readonly refusal: 'invalid_credentials' | 'channel_not_allowed' | 'device_limit_reached' | 'device_wipe_required' } | AttemptRefusal;

/** The challenge of the other channel, a spent one and an expired one are the one answer of the contract. */
const answer = (refusal: Refusal): Refusal =>
  refusal.refusal === 'unauthenticated' || refusal.refusal === 'login_expired' ? { refusal: 'invalid_credentials' } : refusal;

@Injectable()
export class MobileLoginTotpService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #encryption: FieldEncryption;
  readonly #engine: TotpEngine;
  readonly #failures: LoginFailures;
  readonly #gate: LoginAttemptGate;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(FIELD_ENCRYPTION) encryption: FieldEncryption,
    @Inject(TOTP_ENGINE) engine: TotpEngine,
    @Inject(LoginFailures) failures: LoginFailures,
    @Inject(LoginAttemptGate) gate: LoginAttemptGate,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#encryption = encryption;
    this.#engine = engine;
    this.#failures = failures;
    this.#gate = gate;
  }

  async verify(challengeToken: string, code: string, client: ClientInfo): Promise<SignedInDevice> {
    // The wait that the failures so far demand comes first — outside any transaction and before the code is looked at.
    await this.#gate.wait(challengeToken);
    const now = this.#clock.now();
    const outcome = await runInTransaction(this.#db, (transaction) =>
      this.#verifyInTransaction(transaction, challengeToken, code, client, now),
    );
    // Raised after the commit: the counters and the audit rows of a refused try stay.
    if ('refusal' in outcome) throw problemOf(answer(outcome));
    return outcome;
  }

  async #verifyInTransaction(
    transaction: Kysely<Database>,
    challengeToken: string,
    code: string,
    client: ClientInfo,
    now: Date,
  ): Promise<SignedInDevice | Refusal> {
    const opened = await this.#gate.open(transaction, challengeToken, now, client.context, 'mobile');
    if ('refusal' in opened) return opened;
    const { attempt, ticket } = opened;
    const tx = identityTables(transaction);
    const fail = async (): Promise<Refusal> => {
      await this.#gate.fail(transaction, attempt, ticket, 'totp_failed', now, client.context);
      return { refusal: 'invalid_credentials' };
    };

    const account = await findUserById(tx, attempt.userId, true);
    if (account === undefined) return { refusal: 'invalid_credentials' };
    const challenge = await findMobileChallenge(tx, attempt.id, attempt.userId);
    if (challenge === undefined) {
      // The password was changed or the code factor replaced since the first step: the challenge is void, and spent (A5).
      await this.#gate.pass(transaction, ticket, now);
      await consumeLoginAttempt(tx, attempt.id, now);
      return { refusal: 'invalid_credentials' };
    }

    const factor = await findTotpFactor(tx, attempt.userId);
    if (factor?.state !== 'active' || factor.id !== challenge.totpFactorId) return fail();
    const secret = openTotpSecret(this.#encryption, attempt.userId, factor.secretCiphertext);
    const step = this.#engine.match(secret, code, now);
    secret.fill(0);
    if (step === null || !(await claimTotpStep(tx, attempt.userId, step))) return fail();

    // The code was right: the try gives its reservation back (it does not zero the counter, RR-26) and the challenge is spent — atomically.
    await this.#gate.pass(transaction, ticket, now);
    if (!(await consumeLoginAttempt(tx, attempt.id, now))) return { refusal: 'invalid_credentials' };
    if (account.status !== 'active' || account.deletedAt !== null) {
      await this.#failures.record(transaction, 'not_active', attempt.userId, client.context);
      return { refusal: 'invalid_credentials' };
    }
    if (!channelAllowedForRole(account.role, 'mobile')) return this.#denied(transaction, 'channel_not_allowed', attempt.userId, client);

    const matched = await this.#matchedDevice(tx, challenge, attempt.userId);
    if (matched?.state === 'wipe_required') return this.#denied(transaction, 'device_wipe_required', attempt.userId, client);
    if ((await countOtherActiveDevices(tx, attempt.userId, matched?.id, now)) >= MAX_MOBILE_DEVICES) {
      return this.#denied(transaction, 'device_limit_reached', attempt.userId, client);
    }

    const secretValue = newToken();
    const secrets = issueSecret(
      matched?.secrets,
      matched === undefined ? undefined : (challenge.matchedBy ?? undefined),
      hashToken(secretValue),
      now,
    );
    const deviceId = await this.#registerDevice(transaction, {
      matched,
      secrets,
      challenge,
      userId: attempt.userId,
      role: account.role,
      client,
      now,
    });
    await recordLogin(tx, attempt.userId, now);
    const session = await startMobileSession(transaction, this.#events, { userId: attempt.userId, deviceId, client, now });
    const succeeded: IdentityEvent = {
      type: 'login.succeeded',
      actor: { type: 'user', userId: attempt.userId },
      outcome: 'success',
      objectType: 'session',
      objectId: session.sessionId,
    };
    await this.#events.publish(transaction, succeeded, { ...client.context, sessionId: session.sessionId });
    return {
      ...session,
      deviceId,
      installationSecret: secretValue,
      user: { id: account.id, displayName: account.displayName, role: account.role },
      serverTime: now,
    };
  }

  /** The device the first step recognised, locked, if it is still this account's, in use and not removed; otherwise the phone is a new device. */
  async #matchedDevice(tx: IdentityDb, challenge: MobileChallengeRecord, userId: string): Promise<DeviceRecord | undefined> {
    if (challenge.matchedDeviceId === null) return undefined;
    const device = await findDeviceById(tx, challenge.matchedDeviceId, true);
    if (device === undefined || device.userId !== userId || device.removed) return undefined;
    // A wiped device has no valid secret any more: the phone is a new one.
    return device.state === 'wiped' ? undefined : device;
  }

  async #registerDevice(
    transaction: Kysely<Database>,
    request: {
      readonly matched: DeviceRecord | undefined;
      readonly secrets: SecretState;
      readonly challenge: MobileChallengeRecord;
      readonly userId: string;
      readonly role: 'administrator' | 'editor' | 'read_only';
      readonly client: ClientInfo;
      readonly now: Date;
    },
  ): Promise<string> {
    const { matched, secrets, challenge, userId, role, client, now } = request;
    const tx = identityTables(transaction);
    const actor = { type: 'user', userId } as const;
    if (matched !== undefined) {
      await updateDeviceAtLogin(tx, matched.id, { secrets, description: challenge.description, now });
      // A new sign-in of the same phone replaces its earlier sessions (a response lost on the way leaves one that nobody holds).
      for (const sessionId of await revokeSessionsOfDevice(tx, matched.id, 'rotated', now)) {
        const ended: IdentityEvent = {
          type: 'session.revoked',
          actor,
          outcome: 'success',
          reasonCode: 'rotated',
          objectType: 'session',
          objectId: sessionId,
        };
        await this.#events.publish(transaction, ended, { ...client.context, sessionId });
      }
      if (challenge.matchedBy === 'previous') {
        await this.#publishDevice(transaction, 'device.recognized', matched.id, userId, client, 'previous_secret');
      }
      return matched.id;
    }
    const deviceId = await insertDevice(tx, { userId, secrets, description: challenge.description, now });
    await this.#publishDevice(
      transaction,
      'device.registered',
      deviceId,
      userId,
      client,
      challenge.secretMismatch ? 'secret_mismatch' : undefined,
    );
    // SR-AUTH-15: the owner is told about a phone the account did not know; the Administrators too when the owner is an Administrator.
    await enqueueEmail(transaction, { kind: 'new_device', variant: null, recipientUserId: userId, now });
    if (role === 'administrator') {
      for (const recipientUserId of await listActiveAdministratorIds(tx)) {
        await enqueueEmail(transaction, { kind: 'administrator_alert', variant: 'administrator_new_device', recipientUserId, now });
      }
    }
    return deviceId;
  }

  #publishDevice(
    transaction: Kysely<Database>,
    type: 'device.registered' | 'device.recognized',
    deviceId: string,
    userId: string,
    client: ClientInfo,
    reasonCode: ReasonCode | undefined,
  ): Promise<void> {
    const event: IdentityEvent = {
      type,
      actor: { type: 'user', userId },
      outcome: 'success',
      ...(reasonCode === undefined ? {} : { reasonCode }),
      objectType: 'device',
      objectId: deviceId,
    };
    return this.#events.publish(transaction, event, client.context);
  }

  /** A refusal after a correct code: audited (the account is known now) and returned for the answer; the challenge is spent. */
  async #denied(
    transaction: Kysely<Database>,
    reason: 'channel_not_allowed' | 'device_limit_reached' | 'device_wipe_required',
    userId: string,
    client: ClientInfo,
  ): Promise<Refusal> {
    const event: IdentityEvent = {
      type: 'login.failed',
      actor: { type: 'user', userId },
      outcome: 'denied',
      reasonCode: reason,
      objectType: 'user',
      objectId: userId,
    };
    await this.#events.publish(transaction, event, client.context);
    return { refusal: reason };
  }
}
