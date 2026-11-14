import { useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../shell/use-page-title.ts';
import { LoadedSections } from './privacy-page.tsx';

/** The body is a chunk of its own: while it loads (or cannot be loaded offline) the page has real states (AC6). */
const loadSections = () => import('../guide/guide-sections.tsx');

/**
 * "Instrukcja dla biura" (EVM-066 AC6): static content of the panel's own origin, reachable with and without a session
 * (the gate picks the layout, like for W-19). The title and the h1 stay in every state; focus goes to the h1, or to a
 * heading of the body when the address carries its fragment (done by the body once it is loaded).
 */
export function GuidePage() {
  const { t } = useTranslation();
  usePageTitle(t('guide.title'));
  const heading = useRef<HTMLHeadingElement>(null);
  const hash = useRouterState({ select: (state) => state.location.hash });
  const [entryHash] = useState(hash);
  useEffect(() => {
    if (entryHash === '') heading.current?.focus();
  }, [entryHash]);
  return (
    <div className="flex flex-col gap-stack-lg">
      <h1 ref={heading} tabIndex={-1} className="font-display text-heading-1 text-text-primary focus-visible:focus-ring">
        {t('guide.title')}
      </h1>
      <LoadedSections load={loadSections} />
    </div>
  );
}
