/**
 * Opaque tokens of the mobile channel (SR-CRYPTO-01, SR-SESS-09; ASVS V7.2.1–V7.2.3, V11.2.1): 256 bits from the CSPRNG, base64url, with a prefix that secret
 * scanners recognise (`evia_at_`, `evia_rt_`). The database holds only the SHA-256 (the entropy makes a fast hash sufficient). The challenge of the first
 * step and the installation secret have the bare 43-character shape the contract fixes (`newToken`).
 */
import { newToken } from './tokens.ts';

export const ACCESS_TOKEN_PREFIX = 'evia_at_';
export const REFRESH_TOKEN_PREFIX = 'evia_rt_';

const REFRESH_TOKEN = /^evia_rt_[A-Za-z0-9_-]{43}$/;
const BEARER = /^Bearer (evia_at_[A-Za-z0-9_-]{43})$/;

export const newAccessToken = (): string => `${ACCESS_TOKEN_PREFIX}${newToken()}`;
export const newRefreshToken = (): string => `${REFRESH_TOKEN_PREFIX}${newToken()}`;

export const isRefreshToken = (value: string): boolean => REFRESH_TOKEN.test(value);

/**
 * The token of an `Authorization` header — parsed strictly (one space, the scheme exactly `Bearer`, the whole shape of a token), so that anything else is
 * refused before the database is asked. @returns undefined for a missing header or any other shape
 */
export function parseBearer(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  return BEARER.exec(header)?.[1];
}
