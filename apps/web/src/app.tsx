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
 * Query cache of the panel: no persistence, no devtools (SR-WEB-05). A `401` from anything but the session query means
 * the session is gone — the whole cache and the CSRF token of the tab are cleared (data of the previous session must
 * not stay on a shared computer); the session query is read again by the gate and sends the tab to the login page.
 */
export function createQueryClient(): QueryClient {
  const dropSession = () => {
    setCsrfToken(null);
    queryClient.clear();
  };
  const queryClient: QueryClient = new QueryClient({
    // The panel decides itself what offline looks like (banner, retry); a request is never silently paused.
    defaultOptions: { queries: { networkMode: 'always' }, mutations: { networkMode: 'always' } },
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (isUnauthorized(error) && query.queryKey[0] !== SESSION_KEY[0]) dropSession();
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        if (isUnauthorized(error)) dropSession();
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
