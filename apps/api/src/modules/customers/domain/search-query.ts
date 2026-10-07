/**
 * The phrase of a customer search (EVM-020 AC1, AC3; SR-API-04, SR-INPUT-03, SR-INPUT-05): NFC once, trimmed, white space
 * collapsed, 3–100 characters. A phrase made only of digits, `+`, spaces, brackets and hyphens (with at least 3 digits) is a
 * TELEPHONE phrase and is reduced to its digits (a `00` prefix cut), so "+48 600 000 001", "600000001" and "600 000 001" meet
 * the digits the search text holds. The phrase is compared with `ILIKE … ESCAPE '\'`: `%`, `_` and `\` are escaped here, so
 * they match literally. The errors name the field and the code — never the phrase (SR-ERR-02).
 */
import type { FieldIssue } from './customer.ts';

export const SEARCH_QUERY_MIN = 3;
export const SEARCH_QUERY_MAX = 100;

export type SearchQueryResult =
  { readonly ok: true; readonly term: string } | { readonly ok: false; readonly errors: readonly FieldIssue[] };

const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const PHONE_PHRASE = /^[+\d\s()-]+$/;

export function resolveSearchQuery(raw: string): SearchQueryResult {
  const phrase = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  const fail = (code: string): SearchQueryResult => ({ ok: false, errors: [{ pointer: '/query', code }] });
  if (CONTROL.test(phrase)) return fail('invalid_characters');
  if (Array.from(phrase).length < SEARCH_QUERY_MIN) return fail('too_short');
  if (Array.from(phrase).length > SEARCH_QUERY_MAX) return fail('too_long');
  if (PHONE_PHRASE.test(phrase)) {
    const digits = phrase.replace(/\D/g, '').replace(/^00/, '');
    if (digits.length >= SEARCH_QUERY_MIN) return { ok: true, term: digits };
  }
  return { ok: true, term: phrase };
}

/** Escapes the three characters that mean something to `LIKE`, for `ESCAPE '\'`. */
export const escapeLike = (term: string): string => term.replace(/[\\%_]/g, (character) => `\\${character}`);
