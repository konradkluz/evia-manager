import type { CurrentSession } from '@evia/contracts';
import type { QueryClient } from '@tanstack/react-query';
import type { Client } from '@evia/contracts';
import { setCsrfToken } from './csrf.ts';
import { clearDrafts, reconcileDrafts } from './draft-store.ts';
import { setLoginFlow, setLoginNotice } from './login-flow.ts';
import { SESSION_KEY, sessionQueryOptions } from './session.ts';

/**
 * Common end of both login paths (a session answered by the server — `active` after the passkey, `mfa_enrollment` after
 * the password): the CSRF token of the new session replaces the old one, data of any earlier session leaves the cache
 * (a shared computer), the in-memory login state and the notice are cleared, the new session is read, and the drafts
 * of the tab stay only when the same person logged in (AC6). When the session cannot be read the drafts are dropped and
 * the failure is left to the session gate.
 */
export async function completeLogin(client: Client, queryClient: QueryClient, csrfToken: string): Promise<CurrentSession | undefined> {
  setCsrfToken(csrfToken);
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== SESSION_KEY[0] });
  setLoginFlow(null);
  setLoginNotice(null);
  try {
    const session = await queryClient.query({ ...sessionQueryOptions(client), staleTime: 0 });
    reconcileDrafts(session.user.id);
    return session;
  } catch {
    clearDrafts();
    await queryClient.resetQueries({ queryKey: SESSION_KEY });
    return undefined;
  }
}
