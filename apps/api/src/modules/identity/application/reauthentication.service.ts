/**
 * The full re-authentication of the account (EVM-028 AC2, AC3, AC5; SR-AUTH-10, SR-AUTH-05; ASVS V7.5.1, V6.3.1, V6.3.8; CWE-287, CWE-294, CWE-307): the proof a
 * person gives before changing the password or the methods of the second step, EVERY time — no window of 15 minutes. It is a MARK on the session, not a token:
 * `POST /account/reauthentication` verifies the proof and sets `reauthenticated_at` and `reauth_purpose` on the row of the session; the operation that follows
 * spends the mark with a conditional UPDATE in its own transaction (one use, one session, one purpose, 5 minutes). Nothing is returned that could leak, and
 * the mark is not carried when the session is rotated (a step-up between the two asks again).
 *
 * `second_step_change`: the current password, then the second step (a passkey or a code of the app; never a recovery code — decision 16). `password_change`:
 * the second step alone (the current password is given to the change itself). The password is checked FIRST; with a wrong one the second step is not looked at
 * and its challenge or code step is not spent (K4). A wrong password, a wrong key and a wrong code are ONE answer — `401 reauthentication_failed` — so the
 * door says nothing about which factor failed.
 *
 * Every try goes through the counter against guessing of the sign-in (`VerificationGate`, K2): the wait, one verification, a failure counted (and audited by
 * `LoginFailures`) or the reservation given back. While the lock holds nothing is verified: `429` and the session ends. The wrong codes of the app are
 * counted on the session besides, as in the step-up, with ONE budget for both (K3).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ReauthenticationRequestWritable } from '@evia/contracts';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException, type FieldError } from '../../../platform/http/problem.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import type { IdentityEvent } from '../events.ts';
import { findPasswordHash, grantReauthMark } from '../infrastructure/account-queries.ts';
import { PASSWORD_HASHER, type PasswordHasher } from '../infrastructure/ports.ts';
import { identityTables } from '../infrastructure/tables.ts';
import type { ClientInfo } from './activation.service.ts';
import { SecondStepProof, type SecondStepProofBody } from './second-step-proof.ts';
import { VerificationGate, type VerificationTry } from './verification-gate.ts';

type Outcome =
  | { readonly done: true }
  | { readonly refusal: 'reauthentication_failed' | 'session_revoked' | 'forbidden' }
  | { readonly refusal: 'rate_limited'; readonly retryAfterSeconds: number };

type Reason = 'bad_password' | 'passkey_failed' | 'totp_failed';

@Injectable()
export class ReauthenticationService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #hasher: PasswordHasher;
  readonly #proof: SecondStepProof;
  readonly #gate: VerificationGate;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(PASSWORD_HASHER) hasher: PasswordHasher,
    @Inject(SecondStepProof) proof: SecondStepProof,
    @Inject(VerificationGate) gate: VerificationGate,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#hasher = hasher;
    this.#proof = proof;
    this.#gate = gate;
  }

  async reauthenticate(
    principal: Principal,
    body: ReauthenticationRequestWritable,
    client: ClientInfo,
    deviceToken: string | undefined,
  ): Promise<void> {
    const errors = shapeErrors(body);
    if (errors.length > 0) throw new ProblemException('validation_failed', { errors });
    const attempt = await this.#gate.begin(principal, deviceToken, client, 'reauthentication.failed');

    // The password first — outside any transaction (CPU work, no connection held); with a wrong one the second step is never looked at.
    let outcome: Outcome | undefined;
    if (body.purpose === 'second_step_change') {
      const hash = await findPasswordHash(identityTables(this.#db), principal.userId);
      const matches = hash !== undefined && (await this.#hasher.verify(hash, (body.password ?? '').normalize('NFC')));
      if (!matches) outcome = await runInTransaction(this.#db, (tx) => this.#refuse(tx, principal, client, attempt, 'bad_password'));
    }
    outcome ??= await runInTransaction(this.#db, (transaction) => this.#secondStep(transaction, principal, body, client, attempt));

    if ('done' in outcome) return;
    throw new ProblemException(outcome.refusal, outcome.refusal === 'rate_limited' ? { retryAfterSeconds: outcome.retryAfterSeconds } : {});
  }

  async #secondStep(
    transaction: Kysely<Database>,
    principal: Principal,
    body: ReauthenticationRequestWritable,
    client: ClientInfo,
    attempt: VerificationTry,
  ): Promise<Outcome> {
    const now = this.#clock.now();
    const proof = await this.#proof.verify(transaction, principal, proofOf(body), now, client.context);
    if (!proof.ok) {
      if (proof.reason === 'forbidden') {
        // No such method for the account (an Administrator's code of the app): not a guess, the reservation goes back.
        await this.#gate.pass(transaction, attempt, now);
        return { refusal: 'forbidden' };
      }
      const sessionEnded = proof.reason === 'session_revoked';
      return this.#refuse(transaction, principal, client, attempt, sessionEnded ? 'totp_failed' : proof.reason, sessionEnded);
    }
    await this.#gate.pass(transaction, attempt, now);
    if (!(await grantReauthMark(identityTables(transaction), principal.sessionId, principal.userId, body.purpose, now))) {
      return { refusal: 'session_revoked' };
    }
    await this.#publish(transaction, principal, client, 'success');
    return { done: true };
  }

  /** A wrong factor: counted, audited (the reason is a code, never a value), and the answer is the one `reauthentication_failed` — or `429` when it brought the lock. */
  async #refuse(
    transaction: Kysely<Database>,
    principal: Principal,
    client: ClientInfo,
    attempt: VerificationTry,
    reason: Reason,
    sessionEnded: boolean = false,
  ): Promise<Outcome> {
    const now = this.#clock.now();
    await this.#publish(transaction, principal, client, 'failed', reason);
    const failed = await this.#gate.fail(transaction, attempt, reason, client, now);
    if (failed.lockedForSeconds !== undefined) return { refusal: 'rate_limited', retryAfterSeconds: failed.lockedForSeconds };
    return { refusal: sessionEnded ? 'session_revoked' : 'reauthentication_failed' };
  }

  #publish(
    transaction: Kysely<Database>,
    principal: Principal,
    client: ClientInfo,
    outcome: 'success' | 'failed',
    reason?: Reason,
  ): Promise<void> {
    const event: IdentityEvent = {
      type: outcome === 'success' ? 'reauthentication.succeeded' : 'reauthentication.failed',
      actor: { type: 'user', userId: principal.userId },
      outcome,
      ...(reason === undefined ? {} : { reasonCode: reason }),
      objectType: 'session',
      objectId: principal.sessionId,
    };
    return this.#events.publish(transaction, event, { ...client.context, sessionId: principal.sessionId });
  }
}

/** The password belongs to `second_step_change` and only to it; the contract cannot say "required by the value of another field". */
function shapeErrors(body: ReauthenticationRequestWritable): FieldError[] {
  if (body.purpose === 'second_step_change' && body.password === undefined) return [{ pointer: '/password', code: 'required' }];
  if (body.purpose === 'password_change' && body.password !== undefined) return [{ pointer: '/password', code: 'not_allowed' }];
  return [];
}

function proofOf(body: ReauthenticationRequestWritable): SecondStepProofBody {
  return 'credential' in body ? { credential: body.credential } : { method: 'totp', code: body.code };
}
