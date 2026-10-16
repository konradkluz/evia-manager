/**
 * Token of a password reset link (EVM-025 AC2; SR-API-04, SR-LOG-02, SR-WEB-05): it arrives only in the fragment of the
 * address (`/reset-password#<43 characters>`), is moved into this variable and removed from the address bar and the
 * history entry at once, before the router and any telemetry exist. It leaves the tab only in the body of a POST.
 * Not in the router state, storage, the title, a query key, the logs or the breadcrumbs. A separate memory from the
 * activation token: a link of one kind must never be offered to the page of the other (CWE-285).
 */
import { TOKEN_PATTERN } from '../activation/activation-token.ts';

/** What the page sees: the token (or none) and a generation that changes whenever another link is taken in. */
export interface ResetTokenSnapshot {
  readonly token: string | null;
  readonly generation: number;
}

let snapshot: ResetTokenSnapshot = { token: null, generation: 0 };
const listeners = new Set<() => void>();

function publish(token: string | null): void {
  snapshot = { token, generation: snapshot.generation + 1 };
  for (const listener of listeners) listener();
}

/** For `useSyncExternalStore`: the page re-reads the token when a new link is opened in the same tab. */
export function subscribeResetToken(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getResetTokenSnapshot(): ResetTokenSnapshot {
  return snapshot;
}

export function getResetToken(): string | null {
  return snapshot.token;
}

/**
 * Takes the token out of the fragment of the reset page. A fragment that is not a token is dropped without being kept
 * (so a forged anchor never reaches the page); a page without a fragment is left alone.
 */
export function captureResetToken(
  location: Pick<Location, 'pathname' | 'search' | 'hash'>,
  history: Pick<History, 'replaceState' | 'state'>,
): void {
  const fragment = location.hash.slice(1);
  if (fragment === '') return;
  publish(TOKEN_PATTERN.test(fragment) ? fragment : null);
  history.replaceState(history.state, '', `${location.pathname}${location.search}`);
}

/** After the password is set or the link turns out invalid the token must not stay in memory. */
export function clearResetToken(): void {
  if (snapshot.token !== null) publish(null);
}
