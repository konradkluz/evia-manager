import { SearchField } from '@evia/ui-web';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WORK_ORDERS_PATH } from '../paths.ts';
import { phraseOf, phraseState } from '../search/use-phrase-search.ts';
import { setWorkOrderPhrase, useWorkOrderSearch } from '../search/work-order-search-store.ts';
import { useDebounced } from './use-debounced.ts';
import { useOnline } from './use-online.ts';

/** The panel leaves for W-10 when typing pauses, so that the list opens for the whole phrase and not for its first letters. */
const NAVIGATE_DELAY_MS = 300;

/**
 * "Szukaj zleceń…" in the TopBar (styleguide § 3.17; EVM-072 AC2, AC8). It writes the phrase to the store of the tab's memory that
 * W-10 reads — the phrase never goes through the router (no address, no `history.state`) and never into the title. Typed on any
 * other screen, a phrase of 3 characters or more leads to W-10 once the typing pauses, and the search runs there; a shorter one
 * is not sent. Offline the field is disabled and says "Wyszukasz po powrocie połączenia." (it stays focusable so that the hint can
 * be read).
 */
export function TopBarSearch() {
  const { t } = useTranslation();
  const online = useOnline();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const onList = pathname.replace(/\/$/, '') === WORK_ORDERS_PATH;
  const { phrase } = useWorkOrderSearch();
  // Only a phrase typed here leads to W-10 — a phrase kept from before must not pull the person away from another screen.
  const [typedHere, setTypedHere] = useState(false);
  const typed = phraseOf(phrase);
  const settled = useDebounced(typed, NAVIGATE_DELAY_MS);
  useEffect(() => {
    if (!typedHere || settled !== typed || phraseState(typed) !== 'ok') return;
    setTypedHere(false);
    if (!onList) void navigate({ to: WORK_ORDERS_PATH });
  }, [typedHere, settled, typed, onList, navigate]);
  return (
    <SearchField
      label={t('workOrders.search.topBar')}
      labelHidden
      value={phrase}
      clearLabel={t('workOrders.search.clear')}
      disabled={!online}
      {...(online ? {} : { hint: t('workOrders.search.offlineHint') })}
      onChange={(next) => {
        setTypedHere(true);
        setWorkOrderPhrase(next);
      }}
    />
  );
}
