/**
 * The stage added by hand (EVM-042 AC2; SR-INPUT-01, SR-INPUT-05): its name is plain text typed by the user — NFC, trimmed, with no
 * control characters, 1–120 characters — and the SERVER makes its code (`custom_` and 12 random hexadecimal characters), so a client
 * can neither choose nor collide with the unique code of a process (CWE-209). Errors are a pointer and a code, NEVER the value: the
 * name is free text that may name a person.
 */
import { Collector, type FieldIssue } from '../../../platform/input/field-issues.ts';

export const STAGE_NAME_MAX_LENGTH = 120;
export const MANUAL_STAGE_CODE_PREFIX = 'custom_';
/** The number of hexadecimal characters of the random part of the code of a manual stage (48 bits). */
export const MANUAL_STAGE_CODE_RANDOM_LENGTH = 12;

export type StageNameResult = { readonly ok: true; readonly name: string } | { readonly ok: false; readonly errors: readonly FieldIssue[] };

export function normalizeStageName(raw: string): StageNameResult {
  const issues = new Collector();
  const name = issues.required('/name', raw, { maxLength: STAGE_NAME_MAX_LENGTH });
  return name === null ? { ok: false, errors: issues.errors } : { ok: true, name };
}

/** @param randomHex at least 12 hexadecimal characters from a cryptographic source */
export const manualStageCode = (randomHex: string): string =>
  `${MANUAL_STAGE_CODE_PREFIX}${randomHex.slice(0, MANUAL_STAGE_CODE_RANDOM_LENGTH)}`;
