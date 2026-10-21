/**
 * The cookie of a known browser (EVM-026 AC5; SR-AUTH-15; ASVS V3.3.1–V3.3.3; CWE-614, CWE-1004): `__Host-evia_device`, Secure, HttpOnly, SameSite=Strict,
 * Path=/, no Domain (the prefix makes the browser refuse it otherwise), 30 days. The token is 256 bits from the CSPRNG and the database holds only its SHA-256.
 * It names a browser the account has signed in from — it authenticates nobody and skips no step of the sign-in. A malformed cookie, and a request with two
 * such cookies (one may be planted, cookie tossing), is no cookie at all.
 */
import { DEVICE_COOKIE_NAME, DEVICE_RETENTION_MS } from '../domain/constants.ts';
import { TOKEN_PATTERN } from '../domain/tokens.ts';

/** @returns the token of the one well-formed cookie of the request, otherwise `undefined` */
export function readDeviceCookie(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const values = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${DEVICE_COOKIE_NAME}=`))
    .map((part) => part.slice(DEVICE_COOKIE_NAME.length + 1));
  const [token] = values;
  return values.length === 1 && token !== undefined && TOKEN_PATTERN.test(token) ? token : undefined;
}

const MAX_AGE_SECONDS = Math.floor(DEVICE_RETENTION_MS / 1000);

export const deviceCookie = (token: string): string =>
  `${DEVICE_COOKIE_NAME}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE_SECONDS}`;
