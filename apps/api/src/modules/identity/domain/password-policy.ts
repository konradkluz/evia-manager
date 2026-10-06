/**
 * Password policy P2 (SR-AUTH-01, SR-AUTH-02; ASVS V6.2.1–V6.2.4, V6.2.9, V6.2.11; CWE-521), independent of the framework.
 *
 * - Length is counted in Unicode code points after NFC (spaces count, nothing is trimmed): at least 15, at most 256
 *   (the maximum is the `maxLength` of the contract). Any character is allowed; no composition rules.
 * - Weak: the password equals one of the common passwords (local list) or contains a context word. Matching works on a
 *   normalised form: NFKC, lower case, diacritics removed (also `ł`), everything but letters and digits dropped, and
 *   three "leet" variants (`0→o 3→e 4→a 5→s @→a $→s`, `1→i` or `1→l`). A fragment of at least 4 characters counts as
 *   contained, so `Ev1a-Charge!` and `xx3viaCHARGExx` are weak. Context words: the product and domain words of P2, the
 *   local part and segments of the e-mail, the parts of the display name, the current and the previous year.
 * - Breached-password lookup (Pwned Passwords) is a separate port; this function is the offline, deterministic part.
 */
import { COMMON_PASSWORDS } from './common-passwords.ts';

export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 256;
/** Shorter fragments produce too many false positives (`evia` is the shortest context word). */
export const MIN_FRAGMENT_LENGTH = 4;

export type PasswordFault = 'too_short' | 'too_long' | 'too_weak';

export interface PasswordContext {
  readonly email: string;
  readonly displayName: string;
  /** Business "now" — the current and the previous year are context words. */
  readonly now: Date;
}

const CONTEXT_WORDS = ['evia', 'eviacharge', 'evia charge', 'charge', 'wallbox', 'ładowarka', 'ladowarka', 'garaż', 'garaz', 'manager'];

type Fold = (text: string) => string;

const LEET: Readonly<Record<string, string>> = { '0': 'o', '3': 'e', '4': 'a', '5': 's', '@': 'a', $: 's' };

const strip: Fold = (text) => text.replace(/[^a-z0-9]/g, '');
const lower: Fold = (text) => text.normalize('NFKC').toLowerCase().replaceAll('ł', 'l').normalize('NFD').replace(/\p{M}/gu, '');
const leet =
  (one: 'i' | 'l'): Fold =>
  (text) =>
    text.replace(/[01345@$]/g, (character) => (character === '1' ? one : (LEET[character] ?? character)));

/** The folds a comparison is tried with: plain, and with `1` read as `i` or as `l`. */
const FOLDS: readonly Fold[] = [(text) => strip(text), (text) => strip(leet('i')(text)), (text) => strip(leet('l')(text))];

const isCommon = (() => {
  const known = new Set(COMMON_PASSWORDS.map((entry) => strip(lower(entry))));
  return (password: string): boolean => known.has(strip(lower(password)));
})();

const segments = (text: string): string[] => text.split(/[^\p{L}\p{N}]+/u).filter((part) => part !== '');

/** Business year (Europe/Warsaw) of an instant. */
const businessYear = (now: Date): number =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', year: 'numeric' }).format(now));

function contextFragments({ email, displayName, now }: PasswordContext): string[] {
  const localPart = email.split('@')[0] ?? '';
  const year = businessYear(now);
  return [...CONTEXT_WORDS, localPart, ...segments(localPart), displayName, ...segments(displayName), String(year), String(year - 1)];
}

function containsContext(password: string, context: PasswordContext): boolean {
  const folded = lower(password);
  const fragments = contextFragments(context).map(lower);
  return FOLDS.some((fold) => {
    const haystack = fold(folded);
    return fragments.some((fragment) => {
      const needle = fold(fragment);
      return needle.length >= MIN_FRAGMENT_LENGTH && haystack.includes(needle);
    });
  });
}

/** @returns the first fault of the password, or null when the offline checks pass */
export function checkPassword(password: string, context: PasswordContext): PasswordFault | null {
  const text = password.normalize('NFC');
  const length = Array.from(text).length;
  if (length < PASSWORD_MIN_LENGTH) return 'too_short';
  if (length > PASSWORD_MAX_LENGTH) return 'too_long';
  if (isCommon(text) || containsContext(text, context)) return 'too_weak';
  return null;
}
