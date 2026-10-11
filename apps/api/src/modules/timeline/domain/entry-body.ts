/**
 * The text of a journal entry at the boundary (EVM-037 AC4; SR-INPUT-05, SR-WEB-03, ASVS V1.1.1, V1.3.3, CWE-20, CWE-1007): ONE
 * pure function, applied once, in this order — the same order everywhere, so the length that is checked is the length that is stored:
 *   1. a lone UTF-16 surrogate is refused (`invalid_characters`): PostgreSQL would answer a database error (a `500`) for it;
 *   2. NFC (a composed form may be longer or shorter than the input, so the length is taken AFTER it);
 *   3. CRLF and a lone CR become LF;
 *   4. control characters are REMOVED (C0 and C1 — NUL included, which PostgreSQL refuses — but the new line), together with the
 *      characters that reverse or isolate the direction of the text (U+202A–U+202E, U+2066–U+2069: the "Trojan Source" trick) and
 *      the line and paragraph separators (U+2028, U+2029);
 *   5. trimmed; empty is `required`;
 *   6. at most {@link MAX_ENTRY_BODY_LENGTH} code points (`too_long`).
 * The value is TEXT and nothing else: it is stored as it is (no HTML escaping in the database) and rendered as text by the panel.
 * An error is a code, never the value (SR-ERR-02) — a note may name a customer.
 */
export const MAX_ENTRY_BODY_LENGTH = 10_000;

export type EntryBodyResult =
  { readonly ok: true; readonly value: string } | { readonly ok: false; readonly code: 'required' | 'too_long' | 'invalid_characters' };

/** Every control character but the new line, the direction controls and the line and paragraph separators. */
const REMOVED = /(?!\n)\p{Cc}|[\u2028\u2029\u202A-\u202E\u2066-\u2069]/gu;

export function normalizeEntryBody(raw: string): EntryBodyResult {
  if (!raw.isWellFormed()) return { ok: false, code: 'invalid_characters' };
  const text = raw.normalize('NFC').replaceAll('\r\n', '\n').replaceAll('\r', '\n').replace(REMOVED, '').trim();
  if (text === '') return { ok: false, code: 'required' };
  // the length in code points: a pair of surrogates (the text is well formed, see 1.) counts once
  let points = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) index += 1;
    points += 1;
    if (points > MAX_ENTRY_BODY_LENGTH) return { ok: false, code: 'too_long' };
  }
  return { ok: true, value: text };
}
