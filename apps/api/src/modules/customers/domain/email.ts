/** E-mail address (EVM-020 AC2): trimmed, lower case; the shape is checked without a backtracking pattern. */
const MAX_LENGTH = 254;
const MAX_LOCAL_LENGTH = 64;

/** @returns the lower-case address, or `undefined` when it is not an address */
export function normalizeEmail(raw: string): string | undefined {
  const email = raw.normalize('NFC').trim().toLowerCase();
  if (email.length === 0 || email.length > MAX_LENGTH || /[\s\p{Cc}\p{Cf}]/u.test(email)) return undefined;
  const parts = email.split('@');
  if (parts.length !== 2) return undefined;
  const [local = '', domain = ''] = parts;
  if (local.length === 0 || local.length > MAX_LOCAL_LENGTH) return undefined;
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some((label) => label.length === 0)) return undefined;
  return email;
}
