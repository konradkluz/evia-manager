import type { Client } from '@evia/contracts';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, type RouterHistory } from '@tanstack/react-router';
import type { i18n } from 'i18next';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { ApiProvider } from './api/api-context.tsx';
import { ApiError, createApiClient } from './api/client.ts';
import { createI18n } from './i18n/i18n.ts';
import { createAppRouter } from './router.tsx';
import { setCsrfToken } from './session/csrf.ts';
import { setLoginNotice } from './session/login-flow.ts';
import { SESSION_KEY } from './session/session.ts';
import { ErrorBoundary } from './shell/error-boundary.tsx';
import { ErrorState } from './shell/error-state.tsx';
import { ToastProvider } from './shell/toast-context.tsx';

export interface AppProps {
  readonly history?: RouterHistory;
  readonly i18n?: i18n;
  /** API client (tests pass one with a fake `fetch`). */
  readonly client?: Client;
}

const isUnauthorized = (error: unknown): boolean => error instanceof ApiError && error.status === 401;

/**
 * Query cache of the panel: no persistence, no devtools (SR-WEB-05). A `401` means the session is gone (expired, ended
 * elsewhere) — the data of the session and its CSRF token are dropped from the tab at once (data of the previous session
 * must not stay on a shared computer; TM-10, styleguide § 4.17), "Sesja wygasła…" is noted for W-01 when the server said
 * the session expired, and the session is read again, so that the gate sends the tab to W-01 without waiting for a click.
 * The session query itself keeps its error state (the gate reads it), a drop caused by it only removes the other data;
 * the very first read of a visitor without a session drops nothing (there is nothing of a session to drop).
 */
export function createQueryClient(): QueryClient {
  /** `anonymous`: the failed query is the first read of the session (a visitor without a session) — nothing to drop yet. */
  const dropSession = (error: unknown, fromSessionQuery: boolean, anonymous = false) => {
    if (!isUnauthorized(error)) return;
    if ((error as ApiError).code === 'session_expired') setLoginNotice('expired');
    if (anonymous) return;
    setCsrfToken(null);
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== SESSION_KEY[0] });
    if (!fromSessionQuery) void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
  };
  const queryClient: QueryClient = new QueryClient({
    // The panel decides itself what offline looks like (banner, retry); a request is never silently paused.
    defaultOptions: { queries: { networkMode: 'always' }, mutations: { networkMode: 'always' } },
    queryCache: new QueryCache({
      onError: (error, query) => {
        const fromSessionQuery = query.queryKey[0] === SESSION_KEY[0];
        dropSession(error, fromSessionQuery, fromSessionQuery && query.state.data === undefined);
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        dropSession(error, false);
      },
    }),
  });
  return queryClient;
}

/** The panel: i18n (pl) → error boundary → API client → TanStack Query → toasts → router. */
export function App({ history, i18n, client }: AppProps) {
  const [instances] = useState(() => ({
    i18n: i18n ?? createI18n(),
    router: createAppRouter(history),
    queryClient: createQueryClient(),
    client: client ?? createApiClient(),
  }));
  return (
    <I18nextProvider i18n={instances.i18n}>
      <ErrorBoundary fallback={<ErrorState />}>
        <ApiProvider client={instances.client}>
          <QueryClientProvider client={instances.queryClient}>
            <ToastProvider>
              <RouterProvider router={instances.router} />
            </ToastProvider>
          </QueryClientProvider>
        </ApiProvider>
      </ErrorBoundary>
    </I18nextProvider>
  );
}
