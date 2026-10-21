/**
 * The input of the account (EVM-028; SR-INPUT-01, SR-INPUT-07, ASVS V1.2, V1.3): the name shown to others and the name of a key. Both are plain text — NFC,
 * trimmed, without control, formatting (zero-width, bidi) and line or paragraph separator characters — so neither can break a line of a log, change the
 * direction of a text in the panel or pass for another person's name. The check is the one of the invitation (`invitation-input.ts`), with other limits.
 * The answer is a pointer and a code (`required`, `too_long`, `invalid_characters`), never the value.
 */
import type { FieldError } from '../../../platform/http/problem.ts';
import { DEFAULT_PASSKEY_NAME, MAX_PASSKEY_NAME_LENGTH } from './constants.ts';
import { DISPLAY_NAME_MAX_LENGTH } from './invitation-input.ts';

const NOT_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export type TextResult = { readonly ok: true; readonly value: string } | { readonly ok: false; readonly errors: readonly FieldError[] };

function plainText(raw: string, pointer: string, max: number): TextResult {
  const value = raw.normalize('NFC').trim();
  if (value.length === 0) return { ok: false, errors: [{ pointer, code: 'required' }] };
  if (Array.from(value).length > max) return { ok: false, errors: [{ pointer, code: 'too_long' }] };
  if (NOT_TEXT.test(value)) return { ok: false, errors: [{ pointer, code: 'invalid_characters' }] };
  return { ok: true, value };
}

export const normalizeDisplayName = (raw: string): TextResult => plainText(raw, '/displayName', DISPLAY_NAME_MAX_LENGTH);

/** The name of a key; absent means the default name (the answer never has a hole). */
export function normalizePasskeyName(raw: string | undefined): TextResult {
  return raw === undefined ? { ok: true, value: DEFAULT_PASSKEY_NAME } : plainText(raw, '/name', MAX_PASSKEY_NAME_LENGTH);
}
