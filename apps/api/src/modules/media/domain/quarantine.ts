/**
 * The quarantine of a file (EVM-049; P4, P5; SR-DATA-07, SR-FILE-05). Pure rules, no framework:
 * - a file is `held` from its FIRST entry into quarantine (`quarantined_at`, write-once) until a clean result of a new scan releases it or the
 *   retention removes its object (`purged`); a file that a new scan has taken (`scanning` with `quarantined_at`) is still `held`;
 * - the deadline is 30 calendar days from the first entry, counted in the business zone (the database function
 *   `media.quarantine_expires_at`, which the sweeper and the API both use); a new scan never moves it;
 * - the reason is shown only to the one who may manage the quarantine (policy `mediaQuarantine.manage`, module `authorization`);
 * - an alert about the signatures of the scanner: one per episode past 24 h, one per day past 72 h.
 */
import type { FileState, ReasonCode } from './scan-outcome.ts';

/** P4/P5: the retention of a quarantined file; a domain constant, not a setting. */
export const QUARANTINE_RETENTION_DAYS = 30;

export type QuarantineState = 'held' | 'purged';

export interface QuarantineFacts {
  readonly state: FileState;
  readonly quarantined_at: Date | null;
  readonly purged_at: Date | null;
}

export interface QuarantineView {
  readonly state: QuarantineState;
  readonly expiresAt: Date;
  readonly purgedAt: Date | null;
}

/** @returns the state of the quarantine, or `null` when the file is not in it (never was, or a clean scan released it) */
export function quarantineOf(file: QuarantineFacts, expiresAt: Date | null): QuarantineView | null {
  if (file.quarantined_at === null || expiresAt === null) return null;
  if (file.purged_at !== null) return { state: 'purged', expiresAt, purgedAt: file.purged_at };
  return file.state === 'quarantined' || file.state === 'scanning' ? { state: 'held', expiresAt, purgedAt: null } : null;
}

export type QuarantineReason = Extract<ReasonCode, 'malware_detected' | 'type_mismatch'>;

/** The reason of a file that is stopped now (`quarantined` with a reason of a scan); `undefined` otherwise. */
export function quarantineReasonOf(
  file: QuarantineFacts & { readonly state_reason_code: ReasonCode | null },
): QuarantineReason | undefined {
  if (file.state !== 'quarantined' || file.purged_at !== null) return undefined;
  return file.state_reason_code === 'malware_detected' || file.state_reason_code === 'type_mismatch' ? file.state_reason_code : undefined;
}

/** After this age of the signatures the monitor raises `signature_stale` (once per episode); the scan goes on with the older signatures. */
export const SIGNATURE_STALE_MS = 24 * 3_600_000;
/** After this age `signature_stale_72h` is raised every day. */
export const SIGNATURE_STALE_72H_MS = 72 * 3_600_000;
export const SIGNATURE_REPEAT_MS = 24 * 3_600_000;
/** A date of the signatures this far ahead of the clock is not a date the scanner could have written (a clock or a parser error). */
export const SIGNATURE_FUTURE_SKEW_MS = 5 * 60_000;

export type SignatureAlertCode = 'signature_stale' | 'signature_stale_72h';

export interface SignatureAlertInput {
  readonly now: Date;
  /** When the signatures were last known to be built, or — when the age is unknown — when the monitor lost sight of them. */
  readonly since: Date;
  /** The newest alert of each code, from the outbox (the deduplication is in the database, so it holds across workers and restarts). */
  readonly lastStaleAlert: Date | null;
  readonly last72hAlert: Date | null;
}

/**
 * Which alerts are due. `signature_stale`: older than 24 h and no `signature_stale` since `since + 24 h` (one per episode: a new build of
 * the signatures starts a new one). `signature_stale_72h`: older than 72 h and none in the last 24 h (daily).
 */
export function signatureAlertsDue(input: SignatureAlertInput): SignatureAlertCode[] {
  const age = input.now.getTime() - input.since.getTime();
  const due: SignatureAlertCode[] = [];
  const episodeStart = input.since.getTime() + SIGNATURE_STALE_MS;
  if (age > SIGNATURE_STALE_MS && (input.lastStaleAlert === null || input.lastStaleAlert.getTime() < episodeStart))
    due.push('signature_stale');
  const dayAgo = input.now.getTime() - SIGNATURE_REPEAT_MS;
  if (age > SIGNATURE_STALE_72H_MS && (input.last72hAlert === null || input.last72hAlert.getTime() <= dayAgo))
    due.push('signature_stale_72h');
  return due;
}
