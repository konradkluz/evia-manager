/**
 * The one normalisation of the local order search (EVM-103 AC2; architect, story "Decyzje i ograniczenia"): lower case (`pl`),
 * canonical decomposition, combining marks removed, and the letter `ł` replaced explicitly (it has no decomposition). The search key
 * of a row and the query of the technician both go through this function, so they can never drift apart.
 * Pure and total: no input makes it throw, and the text is never used as a pattern (no SQL, no RegExp, no LIKE; security K3).
 */
export function normalizeSearch(text: string): string {
  return text
    .toLocaleLowerCase('pl')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replaceAll('ł', 'l');
}
