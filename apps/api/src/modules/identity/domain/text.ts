/** Text normalisation of the identity module: e-mail addresses (stored normalised) and display names. */

/** NFC, trimmed, lower case — the form stored in `users.email` (api-guidelines.md → Typy danych). */
export const normalizeEmail = (input: string): string => input.normalize('NFC').trim().toLowerCase();

/** The default display name of a new account: the local part of the address (edited later, EVM-028). */
export const displayNameFromEmail = (email: string): string => email.split('@')[0]?.slice(0, 200) || email.slice(0, 200);
