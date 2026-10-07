/**
 * The phrase of a customer search (EVM-020 AC1, AC3; SR-API-04, SR-INPUT-03, SR-INPUT-05): normalised by the platform (NFC once,
 * trimmed, white space collapsed, 3–100 characters). A phrase made only of digits, `+`, spaces, brackets and hyphens (with at least
 * 3 digits) is a TELEPHONE phrase and is reduced to its digits (a `00` prefix cut), so "+48 600 000 001", "600000001" and
 * "600 000 001" meet the digits the search text holds. The phrase is compared with `ILIKE … ESCAPE '\'` by the platform
 * (`searchTextMatches`): `%`, `_` and `\` match literally. The errors name the field and the code — never the phrase (SR-ERR-02).
 */
import { normalizeSearchPhrase, type SearchPhraseResult } from '../../../platform/input/search-phrase.ts';

export { SEARCH_QUERY_MAX, SEARCH_QUERY_MIN } from '../../../platform/input/search-phrase.ts';

export type SearchQueryResult = { readonly ok: true; readonly term: string } | Extract<SearchPhraseResult, { readonly ok: false }>;

const PHONE_PHRASE = /^[+\d\s()-]+$/;

export function resolveSearchQuery(raw: string): SearchQueryResult {
  const result = normalizeSearchPhrase(raw);
  if (!result.ok) return result;
  const { phrase } = result;
  if (PHONE_PHRASE.test(phrase)) {
    const digits = phrase.replace(/\D/g, '').replace(/^00/, '');
    if (digits.length >= 3) return { ok: true, term: digits };
  }
  return { ok: true, term: phrase };
}
