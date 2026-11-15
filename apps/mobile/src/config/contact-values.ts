/**
 * Contact data of the office for the help screen (EVM-102 AC3). The repository is public, so the address and the number never live in
 * the source: they come from the build (EVIA_CONTACT_EMAIL, EVIA_CONTACT_PHONE → `extra` of the Expo configuration) and are validated
 * at build time and again at run time. Pure code without imports: shared by plugins/expo-config.ts and the runtime configuration.
 * Both are functional contacts of the office, never of a person (UX flow 16, M-11).
 */

export interface ContactConfig {
  /** `null` = the build has no address: the screen tells to ask the supervisor. */
  readonly email: string | null;
  /** `null` = no number: the "Zadzwoń do biura" action is not shown. */
  readonly phone: string | null;
}

export const NO_CONTACT: ContactConfig = { email: null, phone: null };

const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$/;
// digits with an optional leading +, grouped by single spaces or hyphens; 7–15 digits (E.164 allows 15)
const PHONE_PATTERN = /^\+?\d(?:[ -]?\d){6,14}$/;

/** @returns the trimmed address, `null` when absent, `undefined` when present but malformed */
export function parseContactEmail(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  if (value === '') return null;
  return EMAIL_PATTERN.test(value) ? value : undefined;
}

/** @returns the trimmed number, `null` when absent, `undefined` when present but malformed */
export function parseContactPhone(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  if (value === '') return null;
  return PHONE_PATTERN.test(value) ? value : undefined;
}

/** Run time: a malformed value is dropped (the screen then behaves as without it), it never breaks the screen. */
export function readContactConfig(extra: unknown): ContactConfig {
  if (typeof extra !== 'object' || extra === null) return NO_CONTACT;
  const record = extra as Record<string, unknown>;
  return { email: parseContactEmail(record['contactEmail']) ?? null, phone: parseContactPhone(record['contactPhone']) ?? null };
}
