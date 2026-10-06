/**
 * Token of a one-time link (README M1 → "Tokeny w linkach jednorazowych"; AC5, SR-API-04, SR-LOG-02): it arrives only
 * in the fragment of the address (`/activate#<43 characters>`), is moved into this variable and removed from the
 * address bar and the history entry at once, before the router exists. It leaves the tab only in the body of a POST.
 * Not in the router state, storage, the title, a query key or the logs.
 */
import { ACTIVATE_PATH } from '../paths.ts';

/** 256 bits in base64url — the same shape the server and the contract accept. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

let token: string | null = null;

/**
 * Takes the token out of the fragment. Only the activation page and fragments shaped like a token are touched, so
 * anchors of other pages stay (e.g. `#drugi-krok`). A fragment that is not a token is dropped without being kept.
 */
export function captureActivationToken(
  location: Pick<Location, 'pathname' | 'search' | 'hash'>,
  history: Pick<History, 'replaceState' | 'state'>,
): void {
  const fragment = location.hash.slice(1);
  if (fragment === '') return;
  const isToken = TOKEN_PATTERN.test(fragment);
  if (location.pathname !== ACTIVATE_PATH && !isToken) return;
  token = isToken ? fragment : null;
  history.replaceState(history.state, '', `${location.pathname}${location.search}`);
}

export function getActivationToken(): string | null {
  return token;
}

/** After the password is set or the link turns out invalid the token must not stay in memory. */
export function clearActivationToken(): void {
  token = null;
}
