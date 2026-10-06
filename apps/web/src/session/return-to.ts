import { ACTIVATE_PATH, LOGIN_PATH, WORK_ORDERS_PATH } from '../paths.ts';

/** Where a login without a usable `returnTo` ends: the list of work orders (W-10). */
export const DEFAULT_RETURN_TO = WORK_ORDERS_PATH;

/** Paths a return would loop through or that are not pages of the panel: the API and the pages before the session. */
const FORBIDDEN_PREFIXES = ['/auth', '/api', LOGIN_PATH, ACTIVATE_PATH] as const;

const isForbiddenPath = (pathname: string): boolean =>
  FORBIDDEN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

// Control characters, space and backslash: for the browser they hide other hosts (`/\evil`, `/<TAB>/evil`).
// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused here
const REFUSED_CHARACTERS = /[\u0000- \u007f\\]/;

/**
 * The path to open after logging in (AC1, SR-WEB-06, CWE-601): only a relative path of the panel is accepted. The value
 * is resolved with `new URL(value, panelOrigin)` and its origin compared — a text prefix check is not enough (`/\evil`,
 * `/<TAB>/evil` or `//evil` are other hosts for the browser). Whitespace, control characters and backslashes are refused
 * outright, and so is a path that decodes to a protocol-relative address (`/%2F%2Fevil`). Anything else → W-10.
 */
export function resolveReturnTo(value: unknown, panelOrigin: string): string {
  if (typeof value !== 'string' || !value.startsWith('/') || REFUSED_CHARACTERS.test(value)) return DEFAULT_RETURN_TO;
  let url: URL;
  let decoded: string;
  try {
    url = new URL(value, panelOrigin);
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return DEFAULT_RETURN_TO;
  }
  if (url.origin !== new URL(panelOrigin).origin) return DEFAULT_RETURN_TO;
  if (decoded.startsWith('//') || decoded.includes('\\')) return DEFAULT_RETURN_TO;
  if (isForbiddenPath(url.pathname) || isForbiddenPath(decoded)) return DEFAULT_RETURN_TO;
  return `${url.pathname}${url.search}`;
}
