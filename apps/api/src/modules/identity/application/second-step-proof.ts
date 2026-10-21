/**
 * The proof of the second step of a SIGNED-IN person, shared by the step-up (EVM-029, EVM-023 AC7) and by the full re-authentication of the account
 * (EVM-028; SR-AUTH-10, SR-SESS-08, ASVS V6.3.1, V7.5.3; CWE-287, CWE-294): one implementation, so the two cannot drift apart. Two methods — a passkey of the
 * account, or a code of the authenticator app (Editor and Read-only; never the Administrator in the panel, P1). A recovery code is not accepted (decision 16).
 *
 * Passkey. The challenge is the one of the options of the step-up (purpose `passkey_step_up`, tied to the session and the user), spent by EVERY verification,
 * the failed ones too. The assertion is checked by the code shared with the sign-in (`verifyAssertionOfKey`) and the counter of the key moves.
 *
 * Code of the app. The role is read from the database now; the sealed secret is opened; the code is checked in a window of ±1 step; the step is spent by a
 * conditional UPDATE shared with the sign-in. The wrong codes are counted on the SESSION — ONE budget for the step-up AND the re-authentication (K3): the fifth
 * ends the session, so a thief of a session has no 2 × 5 tries. (The counter against guessing — `VerificationGate` — counts them besides.)
 *
 * The caller owns the transaction, the throttle and the audit of the outcome; this class only decides whether the proof holds.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { StepUpRequestWritable } from '@evia/contracts';
import type { Kysely } from 'kysely';
import type { FieldEncryption } from '../../../platform/crypto/field-encryption.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { EVENT_BUS, FIELD_ENCRYPTION } from '../../../platform/tokens.ts';
import { totpAllowedForRole } from '../domain/channel-rules.ts';
import { STEP_UP_MAX_FAILED_CODES } from '../domain/constants.ts';
import type { IdentityEvent } from '../events.ts';
import { claimTotpStep, findTotpFactor, recordFailedStepUp } from '../infrastructure/mfa-queries.ts';
import { PASSKEY_VERIFIER, type PasskeyVerifier } from '../infrastructure/ports.ts';
import { consumeStepUpChallenges, findPasskeyOfUser, recordKeyUse, revokeSessions } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import { TOTP_ENGINE, type TotpEngine } from '../infrastructure/totp-engine.ts';
import { verifyAssertionOfKey } from './passkey-assertion.ts';
import { openTotpSecret } from './totp-secret.ts';

export type SecondStepProofBody = StepUpRequestWritable;

export type ProofResult =
  | { readonly ok: true }
  /** `forbidden`: no such method for the account (not a guess, not counted); `session_revoked`: the fifth wrong code ended the session. */
  | { readonly ok: false; readonly reason: 'passkey_failed' | 'totp_failed' | 'forbidden' | 'session_revoked' };

@Injectable()
export class SecondStepProof {
  readonly #events: EventBus;
  readonly #verifier: PasskeyVerifier;
  readonly #encryption: FieldEncryption;
  readonly #engine: TotpEngine;

  constructor(
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(PASSKEY_VERIFIER) verifier: PasskeyVerifier,
    @Inject(FIELD_ENCRYPTION) encryption: FieldEncryption,
    @Inject(TOTP_ENGINE) engine: TotpEngine,
  ) {
    this.#events = events;
    this.#verifier = verifier;
    this.#encryption = encryption;
    this.#engine = engine;
  }

  async verify(
    transaction: Kysely<Database>,
    principal: Principal,
    body: SecondStepProofBody,
    now: Date,
    context: EventContext,
  ): Promise<ProofResult> {
    return 'credential' in body
      ? this.#passkey(transaction, principal, body, now)
      : this.#totp(transaction, principal, body.code, now, context);
  }

  async #passkey(
    transaction: Kysely<Database>,
    principal: Principal,
    body: Extract<SecondStepProofBody, { credential: unknown }>,
    now: Date,
  ): Promise<ProofResult> {
    const tx = identityTables(transaction);
    const account = await tx
      .selectFrom('identity.users')
      .select('webauthn_user_handle')
      .where('id', '=', principal.userId)
      .executeTakeFirstOrThrow();
    // The challenge is spent by every verification, the failed ones too (a replayed assertion finds nothing open).
    const open = await consumeStepUpChallenges(tx, principal.sessionId, principal.userId, now);
    const key = await findPasskeyOfUser(tx, principal.userId, body.credential.id);
    const assertion = await verifyAssertionOfKey(this.#verifier, {
      credential: body.credential,
      key,
      userHandle: account.webauthn_user_handle,
      open,
    });
    if (assertion === null) return { ok: false, reason: 'passkey_failed' };
    await recordKeyUse(tx, assertion.passkeyId, assertion.newCounter, now);
    return { ok: true };
  }

  async #totp(transaction: Kysely<Database>, principal: Principal, code: string, now: Date, context: EventContext): Promise<ProofResult> {
    const tx = identityTables(transaction);
    // The role is read now, from the database — the Administrator has no code of the app in the panel (P1), whatever the session says.
    const account = await tx.selectFrom('identity.users').select('role').where('id', '=', principal.userId).executeTakeFirstOrThrow();
    if (!totpAllowedForRole(account.role, principal.channel)) return { ok: false, reason: 'forbidden' };
    const factor = await findTotpFactor(tx, principal.userId);
    if (factor?.state !== 'active') return { ok: false, reason: 'forbidden' };

    const secret = openTotpSecret(this.#encryption, principal.userId, factor.secretCiphertext);
    const step = this.#engine.match(secret, code, now);
    secret.fill(0);
    if (step !== null && (await claimTotpStep(tx, principal.userId, step))) return { ok: true };

    // A wrong code is counted on the session; the fifth ends it (the thief has to start from the password, which he does not have).
    const failures = await recordFailedStepUp(tx, principal.sessionId);
    if (failures < STEP_UP_MAX_FAILED_CODES) return { ok: false, reason: 'totp_failed' };
    for (const sessionId of await revokeSessions(tx, { sessionId: principal.sessionId }, 'step_up_failed', now)) {
      const ended: IdentityEvent = {
        type: 'session.revoked',
        actor: { type: 'user', userId: principal.userId },
        outcome: 'success',
        reasonCode: 'totp_failed',
        objectType: 'session',
        objectId: sessionId,
      };
      await this.#events.publish(transaction, ended, { ...context, sessionId });
    }
    return { ok: false, reason: 'session_revoked' };
  }
}
