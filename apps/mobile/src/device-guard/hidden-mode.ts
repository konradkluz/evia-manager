/**
 * The "hidden data" mode (EVM-101 AC1, AC2, AC8; SR-MOB-05/06): one derived value decides whether names, addresses, phones and
 * contents of entries may be shown. The camera and the queue keep working in it (only their labels are hidden).
 */
import type { ContactStatus } from '@evia/sync-core';

export type HiddenReason =
  /** AC1: no screen lock on the phone. */
  | 'screen_lock_off'
  /** AC2: the window without contact elapsed (7 days or the shorter one of the server). */
  | 'contact_expired'
  /** AC2: the clock was set back, a restart removed the checkpoint, or there is no readable record — fail-closed. */
  | 'clock_anomaly'
  /** AC4: a wipe is running or still has to be finished. */
  | 'wipe_in_progress'
  /** Before the first evaluation of a session nothing is shown (fail-closed); lasts milliseconds. */
  | 'checking';

export interface ContactView {
  /** `unknown` until the first evaluation of a signed-in session (nothing is shown before it ends: fail-closed). */
  readonly kind: 'unknown' | 'ok' | 'expired' | 'anomaly';
  readonly elapsedMs: number | null;
  readonly windowDays: number;
}

export const DAY_MS = 86_400_000;

export const UNKNOWN_CONTACT: ContactView = { kind: 'unknown', elapsedMs: null, windowDays: 7 };

/** Maps the result of `ContactClock.status` (one checkpoint write; no second algorithm here — architect 4). */
export function contactView(status: ContactStatus | null, windowDays: number): ContactView {
  if (status === null) return { kind: 'ok', elapsedMs: null, windowDays };
  if (status.visible) return { kind: 'ok', elapsedMs: status.elapsedMs, windowDays };
  return { kind: status.reason === 'window_elapsed' ? 'expired' : 'anomaly', elapsedMs: status.elapsedMs, windowDays };
}

/** The reason for hiding, or `null` when the data may be shown. Order = priority of the message. */
export function hiddenReason(input: {
  readonly screenSecure: boolean | null;
  readonly contact: ContactView;
  readonly wiping: boolean;
}): HiddenReason | null {
  if (input.wiping) return 'wipe_in_progress';
  if (input.screenSecure === false) return 'screen_lock_off';
  if (input.screenSecure === null || input.contact.kind === 'unknown') return 'checking';
  if (input.contact.kind === 'expired') return 'contact_expired';
  if (input.contact.kind === 'anomaly') return 'clock_anomaly';
  return null;
}

/**
 * The warning of days 5 and 6 (AC2): thresholds are relative to the window, "window − 2" and "window − 1" days, which are exactly
 * 5 and 6 for the 7-day baseline. `null` = no banner (or the data are already hidden).
 */
export function contactWarning(contact: ContactView): { readonly daysLeft: 1 | 2 } | null {
  if (contact.kind !== 'ok' || contact.elapsedMs === null) return null;
  const elapsedDays = contact.elapsedMs / DAY_MS;
  if (elapsedDays >= contact.windowDays - 1) return { daysLeft: 1 };
  if (elapsedDays >= contact.windowDays - 2) return { daysLeft: 2 };
  return null;
}
