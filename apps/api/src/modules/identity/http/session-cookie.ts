/**
 * The session cookie (SR-SESS-01, SR-SESS-06; ASVS V3.3.1–V3.3.3, V7.2.3): `__Host-evia_session`, Secure, HttpOnly,
 * SameSite=Strict, Path=/, no Domain. The `__Host-` prefix makes the browser refuse the cookie without Secure and Path=/,
 * so there is no switch that turns it off — local development uses HTTPS or `localhost` (a secure context). The token
 * is opaque and is checked against the pattern before it is hashed; a request with two such cookies is not trusted.
 */
import { SESSION_COOKIE_NAME } from '../domain/constants.ts';
import { TOKEN_PATTERN } from '../domain/tokens.ts';

export type SessionCookie =
  | { readonly kind: 'token'; readonly token: string }
  | { readonly kind: 'none' }
  /** More than one cookie of that name: an attacker may have planted one (cookie tossing) — no principal. */
  | { readonly kind: 'ambiguous' };

export function readSessionCookie(header: string | undefined): SessionCookie {
  if (header === undefined) return { kind: 'none' };
  const values = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`))
    .map((part) => part.slice(SESSION_COOKIE_NAME.length + 1));
  if (values.length > 1) return { kind: 'ambiguous' };
  const [token] = values;
  return token !== undefined && TOKEN_PATTERN.test(token) ? { kind: 'token', token } : { kind: 'none' };
}

const ATTRIBUTES = 'Path=/; Secure; HttpOnly; SameSite=Strict';

export const sessionCookie = (token: string, maxAgeSeconds: number): string =>
  `${SESSION_COOKIE_NAME}=${token}; ${ATTRIBUTES}; Max-Age=${maxAgeSeconds}`;

/** Expires the cookie with the attributes it was set with (otherwise the browser would keep it). */
export const clearedSessionCookie = (): string => `${SESSION_COOKIE_NAME}=; ${ATTRIBUTES}; Max-Age=0`;
