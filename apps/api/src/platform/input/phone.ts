/**
 * Telephone numbers (EVM-020 AC2): any common way of writing a number is normalised to E.164 (`^\+[1-9]\d{7,14}$`) without a
 * telephone library (no new dependency; the numbering plans of countries are not validated — only the shape). A bare national
 * number of 9 digits is Polish (+48). The patterns are linear (no nested quantifiers — no ReDoS).
 */
const WRITING = /^[+\d\s().-]+$/;
const E164 = /^\+[1-9]\d{7,14}$/;

/** @returns the E.164 number, or `undefined` when the text is not a telephone number */
export function normalizePhone(raw: string): string | undefined {
  const compact = raw.normalize('NFC').trim();
  if (compact === '' || compact.length > 32 || !WRITING.test(compact)) return undefined;
  if (compact.indexOf('+', 1) !== -1) return undefined;
  const digits = compact.replace(/\D/g, '');
  let international: string;
  if (compact.startsWith('+')) international = `+${digits}`;
  else if (digits.startsWith('00')) international = `+${digits.slice(2)}`;
  else if (digits.length === 9 && !digits.startsWith('0')) international = `+48${digits}`;
  else return undefined;
  return E164.test(international) ? international : undefined;
}
