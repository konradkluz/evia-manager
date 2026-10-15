/**
 * Amounts of the instalments (EVM-053; api-guidelines → "kwota", styleguide § 6.3). The API carries an amount as whole grosze
 * (`amountMinor`) — the panel never holds an amount as a fraction of a złoty: the typed text is parsed digit by digit into
 * grosze (no `parseFloat` and no `× 100`, so "0,29" is 29 and never 28.999…), and an amount is shown from grosze by integer
 * division. The checks here are a convenience for the person; the server decides (SR-INPUT-01).
 */

/** The largest amount the API accepts (`Money.amountMinor` ≤ 99 999 999 999 — 999 999 999,99 zł). */
export const MONEY_MAX_MINOR = 99_999_999_999;

const NBSP = '\u00a0';
/** Every space a person or a copied text may use between the groups of digits (space, NBSP, narrow NBSP, thin space). */
const SPACES = /[\s\u00a0\u202f\u2009]/g;
const AMOUNT = /^(\d+)(?:[.,](\d+))?$/;
/** Nine digits of złote at most (999 999 999); more is above `MONEY_MAX_MINOR`. */
const MAX_WHOLE_DIGITS = 9;

/** "3600" → "3 600": the digits grouped by three with a non-breaking space (§ 6.3 — four-digit numbers too). */
function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** The amount as digits: "3 600,00" (grouped, decimal comma, always two places). */
function amountDigits(amountMinor: number): string {
  const whole = Math.trunc(amountMinor / 100);
  const fraction = amountMinor % 100;
  return `${group(String(whole))},${String(fraction).padStart(2, '0')}`;
}

/** An amount in grosze as "3 600,00 zł" (styleguide § 6.3: non-breaking spaces, decimal comma, two places, "zł" after a NBSP). */
export function formatMoney(amountMinor: number): string {
  return `${amountDigits(amountMinor)}${NBSP}zł`;
}

export type ParsedAmount =
  | { readonly kind: 'amount'; readonly amountMinor: number }
  | { readonly kind: 'empty' | 'invalid' | 'precision' | 'notPositive' | 'tooLarge' };

/**
 * Typed text → grosze. Accepted: digits with spaces between the groups, a decimal comma or dot and at most two places
 * ("1500", "1 500,5", "3600.10"); "zł" at the end is ignored. Refused: more than two places (`precision`), zero or a minus
 * (`notPositive`), more than the API accepts (`tooLarge`) and anything else (`invalid`).
 */
export function parseAmount(text: string): ParsedAmount {
  const compact = text.replace(SPACES, '').replace(/zł$/i, '');
  if (compact === '') return { kind: 'empty' };
  if (compact.startsWith('-') || compact.startsWith('\u2212')) return { kind: 'notPositive' };
  const match = AMOUNT.exec(compact);
  if (match === null) return { kind: 'invalid' };
  const whole = (match[1] ?? '').replace(/^0+(?=\d)/, '');
  const fraction = match[2] ?? '';
  if (fraction.length > 2) return { kind: 'precision' };
  if (whole.length > MAX_WHOLE_DIGITS) return { kind: 'tooLarge' };
  // Both parts are small whole numbers (≤ 999 999 999 and ≤ 99), so this arithmetic is exact.
  const amountMinor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (amountMinor === 0) return { kind: 'notPositive' };
  return { kind: 'amount', amountMinor };
}

/** The text of an amount field after it is left: "1500" → "1 500,00" (§ 6.3); text that is not an amount stays as typed. */
export function formatAmountInput(text: string): string {
  const parsed = parseAmount(text);
  return parsed.kind === 'amount' ? amountDigits(parsed.amountMinor) : text;
}

/** The text an amount field starts with: the amount of the instalment without "zł" (the field has the suffix), or nothing. */
export const amountInputOf = (amountMinor: number | undefined): string => (amountMinor === undefined ? '' : amountDigits(amountMinor));
