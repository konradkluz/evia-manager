import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, type RouterHistory } from '@tanstack/react-router';
import type { i18n } from 'i18next';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { createI18n } from './i18n/i18n.ts';
import { createAppRouter } from './router.tsx';
import { ErrorBoundary } from './shell/error-boundary.tsx';
import { ErrorState } from './shell/error-state.tsx';

export interface AppProps {
  readonly history?: RouterHistory;
  readonly i18n?: i18n;
}

/** The panel: i18n (pl) → error boundary → TanStack Query → router. No query cache persistence, no devtools (SR-WEB-05). */
export function App({ history, i18n }: AppProps) {
  const [instances] = useState(() => ({ i18n: i18n ?? createI18n(), router: createAppRouter(history), queryClient: new QueryClient() }));
  const { router, queryClient } = instances;
  return (
    <I18nextProvider i18n={instances.i18n}>
      <ErrorBoundary fallback={<ErrorState />}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ErrorBoundary>
    </I18nextProvider>
  );
}
