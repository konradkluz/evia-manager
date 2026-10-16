/**
 * Queries of the second factors that are not a passkey (EVM-023): the TOTP factor and the recovery codes. Every state change is a conditional
 * UPDATE … RETURNING, so of two parallel requests exactly one wins (CWE-362) — the caller reads the result, never a value it read earlier.
 */
import { sql } from 'kysely';
import type { IdentityDb } from './tables.ts';

export interface TotpFactorRecord {
  readonly id: string;
  readonly state: 'pending' | 'active';
  /** The sealed envelope of `platform/crypto/field-encryption` — never the secret. */
  readonly secretCiphertext: Buffer;
  /** The time step of the last accepted code; null before the first one. */
  readonly lastUsedStep: number | null;
}

/** The TOTP factor of the account (`FOR UPDATE` when `lock`). */
export async function findTotpFactor(db: IdentityDb, userId: string, lock: boolean = false): Promise<TotpFactorRecord | undefined> {
  let query = db
    .selectFrom('identity.totp_factors')
    .select(['id', 'state', 'secret_ciphertext as secretCiphertext', 'last_used_step as lastUsedStep'])
    .where('user_id', '=', userId);
  if (lock) query = query.forUpdate();
  const row = await query.executeTakeFirst();
  return row === undefined ? undefined : { ...row, lastUsedStep: row.lastUsedStep === null ? null : Number(row.lastUsedStep) };
}

/** Does the account have an ACTIVE TOTP factor (a pending one is not a factor)? */
export async function hasActiveTotp(db: IdentityDb, userId: string): Promise<boolean> {
  const row = await db
    .selectFrom('identity.totp_factors')
    .select('id')
    .where('user_id', '=', userId)
    .where('state', '=', 'active')
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * Stores a new pending secret, replacing an earlier PENDING one (a second setup before confirming gives a fresh secret). An active factor is never
 * touched. @returns false when the account already has an active factor
 */
export async function upsertPendingTotp(db: IdentityDb, factor: { userId: string; secretCiphertext: Buffer; now: Date }): Promise<boolean> {
  const row = await db
    .insertInto('identity.totp_factors')
    .values({
      user_id: factor.userId,
      secret_ciphertext: factor.secretCiphertext,
      state: 'pending',
      last_used_step: null,
      created_at: factor.now,
      confirmed_at: null,
    })
    .onConflict((conflict) =>
      conflict
        .column('user_id')
        .doUpdateSet({ secret_ciphertext: factor.secretCiphertext, last_used_step: null, created_at: factor.now })
        .where('identity.totp_factors.state', '=', 'pending'),
    )
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

/** Makes the pending factor active and records the step of the code that confirmed it (that code can never sign in). @returns false if there was none */
export async function activateTotp(db: IdentityDb, userId: string, step: number, now: Date): Promise<boolean> {
  const row = await db
    .updateTable('identity.totp_factors')
    .set({ state: 'active', last_used_step: step, confirmed_at: now })
    .where('user_id', '=', userId)
    .where('state', '=', 'pending')
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

/** Spends a time step of an ACTIVE factor: only a step later than the last accepted one (replay guard). @returns false for a replayed or older step */
export async function claimTotpStep(db: IdentityDb, userId: string, step: number): Promise<boolean> {
  const row = await db
    .updateTable('identity.totp_factors')
    .set({ last_used_step: step })
    .where('user_id', '=', userId)
    .where('state', '=', 'active')
    .where((eb) => eb.or([eb('last_used_step', 'is', null), eb('last_used_step', '<', String(step))]))
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

export interface RecoveryCodeRecord {
  readonly id: string;
  readonly hash: string;
}

/** The unused codes of the current generation of the account, in the order they were made. */
export async function listAvailableRecoveryCodes(db: IdentityDb, userId: string): Promise<RecoveryCodeRecord[]> {
  return db
    .selectFrom('identity.recovery_codes')
    .select(['id', 'code_hash as hash'])
    .where('user_id', '=', userId)
    .where('used_at', 'is', null)
    .where('superseded_at', 'is', null)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
}

export async function countAvailableRecoveryCodes(db: IdentityDb, userId: string): Promise<number> {
  const row = await db
    .selectFrom('identity.recovery_codes')
    .select(sql<string>`count(*)`.as('count'))
    .where('user_id', '=', userId)
    .where('used_at', 'is', null)
    .where('superseded_at', 'is', null)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

/** Spends one code: single use, and never a code of a retired generation. @returns false when it was already spent or retired */
export async function consumeRecoveryCode(db: IdentityDb, id: string, now: Date): Promise<boolean> {
  const row = await db
    .updateTable('identity.recovery_codes')
    .set({ used_at: now })
    .where('id', '=', id)
    .where('used_at', 'is', null)
    .where('superseded_at', 'is', null)
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

/** The sessions that asked for the codes of the current (not retired) generation — empty when the account never had any. */
export async function currentRecoveryGenerationSessions(db: IdentityDb, userId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('identity.recovery_codes')
    .select('session_id')
    .distinct()
    .where('user_id', '=', userId)
    .where('superseded_at', 'is', null)
    .execute();
  return rows.map((row) => row.session_id);
}

/** Does the account have, or has it ever had, a generation of codes? */
export async function hasRecoveryCodeHistory(db: IdentityDb, userId: string): Promise<boolean> {
  const row = await db.selectFrom('identity.recovery_codes').select('id').where('user_id', '=', userId).limit(1).executeTakeFirst();
  return row !== undefined;
}

/** Retires the current generation (a new one replaces it in the same transaction). */
export async function supersedeRecoveryCodes(db: IdentityDb, userId: string, now: Date): Promise<void> {
  await db
    .updateTable('identity.recovery_codes')
    .set({ superseded_at: now })
    .where('user_id', '=', userId)
    .where('superseded_at', 'is', null)
    .execute();
}

export async function insertRecoveryCodes(
  db: IdentityDb,
  generation: { userId: string; generationId: string; sessionId: string; hashes: readonly string[]; now: Date },
): Promise<void> {
  await db
    .insertInto('identity.recovery_codes')
    .values(
      generation.hashes.map((hash) => ({
        user_id: generation.userId,
        generation_id: generation.generationId,
        session_id: generation.sessionId,
        code_hash: hash,
        created_at: generation.now,
        used_at: null,
        superseded_at: null,
      })),
    )
    .execute();
}

/** Counts a wrong code of step-up in the session. @returns the number of wrong codes so far (atomic — parallel failures all count) */
export async function recordFailedStepUp(db: IdentityDb, sessionId: string): Promise<number> {
  const row = await db
    .updateTable('identity.sessions')
    .set({ step_up_failed_attempts: sql<number>`step_up_failed_attempts + 1` })
    .where('id', '=', sessionId)
    .returning('step_up_failed_attempts')
    .executeTakeFirst();
  return row?.step_up_failed_attempts ?? 0;
}
