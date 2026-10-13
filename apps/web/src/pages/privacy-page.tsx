import { Button, CircleAlert, EmptyState, Skeleton, WifiOff } from '@evia/ui-web';
import { useRouterState } from '@tanstack/react-router';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PRIVACY_ANCHORS } from '../paths.ts';
import { ErrorBoundary } from '../shell/error-boundary.tsx';
import { useOnline } from '../shell/use-online.ts';
import { usePageTitle } from '../shell/use-page-title.ts';

/** The content is a chunk of its own: while it loads (or cannot be loaded offline) the page has real states (AC6). */
const loadSections = () => import('../privacy/privacy-sections.tsx');
type Load = typeof loadSections;

function LoadFailed({ onRetry }: { readonly onRetry: () => void }) {
  const { t } = useTranslation();
  const online = useOnline();
  return (
    <EmptyState
      icon={online ? CircleAlert : WifiOff}
      title={online ? t('privacy.state.errorTitle') : t('privacy.state.offlineTitle')}
      description={online ? t('privacy.state.errorDescription') : t('privacy.state.offlineDescription')}
      action={<Button onClick={onRetry}>{t('privacy.state.retry')}</Button>}
    />
  );
}

/** Loads the body and shows its states: skeleton while loading, a message with a retry when the chunk cannot be loaded. */
export function LoadedSections({ load = loadSections }: { readonly load?: Load }) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [Content, setContent] = useState(() => lazy(load));
  const retry = () => {
    setContent(() => lazy(load));
    setAttempt((count) => count + 1);
  };
  return (
    <ErrorBoundary key={attempt} fallback={<LoadFailed onRetry={retry} />}>
      <Suspense
        fallback={
          <div aria-busy="true" className="flex flex-col gap-stack-md">
            <p role="status" className="sr-only">
              {t('privacy.loading')}
            </p>
            <Skeleton className="w-1/2" />
            <Skeleton />
            <Skeleton />
            <Skeleton className="w-3/4" />
          </div>
        }
      >
        <Content />
      </Suspense>
    </ErrorBoundary>
  );
}

/**
 * W-19 "Prywatność i pomoc" (EVM-063; flow 15): static content with the same order in the panel and before logging in
 * (the layout comes from the gate). The title and its hierarchy stay in every state; focus goes to the h1, or to the
 * section heading when the address carries `#pomoc` / `#prywatnosc` (done by the body once it is loaded).
 */
export function PrivacyPage() {
  const { t } = useTranslation();
  usePageTitle(t('privacy.title'));
  const heading = useRef<HTMLHeadingElement>(null);
  const hash = useRouterState({ select: (state) => state.location.hash });
  const [entryHash] = useState(hash);
  useEffect(() => {
    if (!PRIVACY_ANCHORS.includes(entryHash)) heading.current?.focus();
  }, [entryHash]);
  return (
    <div className="flex flex-col gap-stack-lg">
      <h1 ref={heading} tabIndex={-1} className="font-display text-heading-1 text-text-primary focus-visible:focus-ring">
        {t('privacy.title')}
      </h1>
      <LoadedSections />
    </div>
  );
}
