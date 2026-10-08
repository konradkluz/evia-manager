/**
 * Optimistic concurrency of a resource (ADR-0004, api-guidelines.md → Współbieżność; SR-API-06, ASVS V2.3.3). The entity tag is
 * the STRONG tag of the `version` column — `"<version>"`. A command on a shared object needs `If-Match`:
 * - the header is missing → `428 precondition_required` (the client has not said which version it decided on);
 * - the header is not a strong tag of a version (weak `W/"1"`, a list, `*`, no quotes, a number that is not a positive 32-bit
 *   integer) → `400 validation_failed` pointing at the header, never at its value. A list and `*` are refused on purpose: "any
 *   version" would defeat the precondition;
 * - the version differs from the one in the database → `412 version_conflict` (decided by the use case, UNDER the lock of the row,
 *   never on an earlier read).
 */
import { ProblemException } from './problem.ts';

/** The largest value of an `integer` column (the type of `version`). */
const MAX_VERSION = 2_147_483_647;

const STRONG_TAG = /^"([1-9][0-9]{0,9})"$/;

/** The strong entity tag of a version (what a read answers in `ETag`). */
export const entityTag = (version: number): string => `"${version}"`;

/** @param header the `If-Match` header as received (`undefined` when absent); @returns the version the client decided on */
export function parseIfMatch(header: string | undefined): number {
  if (header === undefined) throw new ProblemException('precondition_required');
  const match = STRONG_TAG.exec(header);
  const version = match === null ? Number.NaN : Number(match[1]);
  if (!(version >= 1 && version <= MAX_VERSION)) {
    throw new ProblemException('validation_failed', { errors: [{ pointer: '/headers/If-Match', code: 'invalid_format' }] });
  }
  return version;
}
