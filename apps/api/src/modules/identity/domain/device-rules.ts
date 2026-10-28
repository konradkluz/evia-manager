/**
 * Rules of the register of mobile devices (EVM-094 AC2; SR-SESS-04, SR-AUTH-14), independent of the framework.
 *
 * The installation secret is rotated in TWO PHASES: every successful sign-in issues a new secret, but the last one the phone PROVED (by using it, or the
 * tokens issued with it) stays valid until the new one is proven — so a response lost in a garage does not make the phone a stranger. At most two secrets
 * are valid at any moment (the newest issued and the last proven); the proven one for at most 7 days. Only SHA-256 hashes are handled here.
 *
 * The comparison is in constant time, and it is made for an UNKNOWN device too (against a decoy of the same length), so that the time of an answer does not
 * tell whether a `deviceId` exists (CWE-208).
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { PREVIOUS_SECRET_VALID_MS } from './constants.ts';

export interface SecretState {
  /** The newest issued secret. */
  readonly current: Buffer;
  /** Has the phone proved `current`? When it has, there is no `previous`. */
  readonly proven: boolean;
  readonly previous: Buffer | null;
  readonly previousValidUntil: Date | null;
}

export type SecretMatch = 'current' | 'previous';
export type Comparator = (left: Buffer, right: Buffer) => boolean;

export const equalHashes: Comparator = (left, right) => left.length === right.length && timingSafeEqual(left, right);

/**
 * Which secret of the device does `presented` (a hash) equal — if any. Always two comparisons whatever the state (an unknown device, a device with no
 * `previous` and an expired `previous` compare against decoys); both are made before the answer is decided.
 */
export function matchSecret(
  state: SecretState | undefined,
  presented: Buffer,
  now: Date,
  compare: Comparator = equalHashes,
): SecretMatch | undefined {
  const decoy = randomBytes(presented.length);
  const previous = state?.previous ?? null;
  const previousUsable = previous !== null && state?.previousValidUntil != null && state.previousValidUntil > now;
  const isCurrent = compare(presented, state?.current ?? decoy);
  const isPrevious = compare(presented, previousUsable ? previous : decoy);
  if (state === undefined) return undefined;
  if (isCurrent) return 'current';
  return previousUsable && isPrevious ? 'previous' : undefined;
}

/**
 * The state after a successful sign-in issued `issued`. `matched` says how the phone introduced itself: a new device has no state; presenting the newest
 * secret proves it (it becomes the previous, valid for 7 days); presenting the previous one (the last answer was lost) keeps it and replaces the newest,
 * which nobody proved, so there are never more than two valid secrets and the previous one is never extended.
 */
export function issueSecret(state: SecretState | undefined, matched: SecretMatch | undefined, issued: Buffer, now: Date): SecretState {
  if (state === undefined || matched === undefined) return { current: issued, proven: false, previous: null, previousValidUntil: null };
  if (matched === 'current') {
    return {
      current: issued,
      proven: false,
      previous: state.current,
      previousValidUntil: new Date(now.getTime() + PREVIOUS_SECRET_VALID_MS),
    };
  }
  return { current: issued, proven: false, previous: state.previous, previousValidUntil: state.previousValidUntil };
}
