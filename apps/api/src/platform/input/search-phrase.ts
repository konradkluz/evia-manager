/**
 * The phrase of a search in the body of a request (SR-API-04, SR-INPUT-03, SR-INPUT-05): NFC once, white space collapsed, trimmed,
 * 3–100 characters, no control or invisible formatting characters. A phrase shorter than 3 characters would not use the trigram
 * index and would invite a full scan, so it is refused (`too_short`). The errors name the field and the code — never the phrase.
 */
import type { FieldIssue } from './field-issues.ts';

export const SEARCH_QUERY_MIN = 3;
export const SEARCH_QUERY_MAX = 100;

export type SearchPhraseResult =
  { readonly ok: true; readonly phrase: string } | { readonly ok: false; readonly errors: readonly FieldIssue[] };

const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export function normalizeSearchPhrase(raw: string): SearchPhraseResult {
  const phrase = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  const fail = (code: string): SearchPhraseResult => ({ ok: false, errors: [{ pointer: '/query', code }] });
  if (CONTROL.test(phrase)) return fail('invalid_characters');
  const length = Array.from(phrase).length;
  if (length < SEARCH_QUERY_MIN) return fail('too_short');
  if (length > SEARCH_QUERY_MAX) return fail('too_long');
  return { ok: true, phrase };
}
