import { getSite, type Site } from '@evia/contracts';
import { Button, InlineAlert, List, ListItem, Skeleton } from '@evia/ui-web';
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { siteTypeLabels } from '../i18n/catalog-labels.ts';
import { SITE_SUGGESTIONS_KEY } from '../work-orders/query-keys.ts';
import { formatSiteLine } from './format.ts';
import type { PickedSite } from './site-form.ts';
import type { SiteSuggestion } from './use-site-suggestions.ts';

/**
 * What the form keeps of a site read by its identifier: ONLY the fields of the chosen site (an allow-list) — the notes, the PPE, the
 * power and the parties of the card never enter the memory of the form (SR-DATA-03, SR-WEB-05).
 */
export function pickedSiteOf(site: Site): PickedSite {
  return {
    id: site.id,
    siteType: site.siteType,
    street: site.street,
    buildingNumber: site.buildingNumber,
    ...(site.apartmentNumber === undefined ? {} : { apartmentNumber: site.apartmentNumber }),
    postalCode: site.postalCode,
    city: site.city,
    ...(site.parkingSpotNumber === undefined ? {} : { parkingSpotNumber: site.parkingSpotNumber }),
    ...(site.garageLevel === undefined ? {} : { garageLevel: site.garageLevel }),
  };
}

const typeLabel = (siteType: string): string | undefined =>
  Object.hasOwn(siteTypeLabels, siteType) ? siteTypeLabels[siteType as keyof typeof siteTypeLabels] : undefined;

export interface SiteSuggestionsProps {
  readonly customerId: string;
  readonly online: boolean;
  readonly suggestions: UseQueryResult<SiteSuggestion[]>;
  /** The site the person chose, read in full by its identifier (ONE request per click). */
  readonly onPick: (site: PickedSite) => void;
}

/**
 * "Lokalizacje z poprzednich zleceń klienta (n)" above the search of W-05 (EVM-043 AC1–AC4; List, styleguide § 3.6): the address and the
 * type of the object of each location of the customer's earlier orders and the button "Wybierz". Nothing is shown for a customer
 * without orders (AC2); while loading — a skeleton; offline — a short notice; a failure — a notice with "Spróbuj ponownie" (a `403`
 * says nothing). A choice is ONE `getSite` (the buttons are blocked meanwhile, the answer of a gone component is ignored); `404` means
 * the site is gone meanwhile — a message and the list is read again, no site is set.
 */
export function SiteSuggestions({ customerId, online, suggestions, onPick }: SiteSuggestionsProps) {
  const { t } = useTranslation();
  const client = useApi();
  const queryClient = useQueryClient();
  const headingId = useId();
  const running = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<'gone' | 'rateLimited' | 'error' | null>(null);
  const [retryAfter, setRetryAfter] = useState(60);

  useEffect(
    () => () => {
      running.current?.abort();
    },
    [],
  );

  const choose = async (siteId: string) => {
    if (running.current !== null) return;
    const own = new AbortController();
    running.current = own;
    setPending(true);
    setFailure(null);
    try {
      const site = await unwrap(getSite({ client, signal: own.signal, path: { siteId } }));
      if (!own.signal.aborted) onPick(pickedSiteOf(site));
    } catch (error) {
      if (own.signal.aborted) return;
      const api = error instanceof ApiError ? error : null;
      if (api?.status === 404) {
        setFailure('gone');
        void queryClient.invalidateQueries({ queryKey: [SITE_SUGGESTIONS_KEY, customerId] });
      } else if (api?.status === 429) {
        setRetryAfter(api.retryAfterSeconds ?? 60);
        setFailure('rateLimited');
      } else setFailure('error');
    } finally {
      if (running.current === own) running.current = null;
      if (!own.signal.aborted) setPending(false);
    }
  };

  // A constant live region: it is in the DOM before its text changes, so assistive technology announces the loading and the offline notice.
  const announce = (message: string | null, content: ReactNode = null, visible = false) => (
    <>
      <p role="status" className={visible ? 'text-body-sm text-text-secondary' : 'sr-only'}>
        {message}
      </p>
      {content}
    </>
  );

  if (!online) return announce(t('sites.suggestions.offline'), null, true);
  if (suggestions.isError) {
    const error = suggestions.error;
    if (error instanceof ApiError && error.status === 403) return announce(null);
    if (error instanceof ApiError && error.status === 429)
      return announce(
        null,
        <p className="text-body-sm text-text-secondary">
          {t('sites.suggestions.rateLimited', { seconds: error.retryAfterSeconds ?? 60 })}
        </p>,
      );
    return announce(
      null,
      <InlineAlert
        tone="error"
        action={
          <Button
            variant="secondary"
            onClick={() => {
              void suggestions.refetch();
            }}
          >
            {t('sites.suggestions.retry')}
          </Button>
        }
      >
        {t('sites.suggestions.error')}
      </InlineAlert>,
    );
  }
  if (suggestions.isLoading) {
    return announce(
      t('sites.suggestions.loading'),
      <div aria-busy="true" className="flex flex-col gap-stack-sm">
        <Skeleton />
        <Skeleton />
      </div>,
    );
  }
  const found = suggestions.data ?? [];
  if (found.length === 0) return announce(null);

  return announce(
    null,
    <section aria-labelledby={headingId} className="flex flex-col gap-stack-sm">
      <h2 id={headingId} className="text-heading-4 text-text-primary">
        {t('sites.suggestions.heading', { count: found.length })}
      </h2>
      <List labelledBy={headingId}>
        {found.map((site) => {
          const address = formatSiteLine(site);
          return (
            <ListItem key={site.id}>
              <div className="flex flex-wrap items-center justify-between gap-inline-md">
                <span className="break-words">
                  {t('sites.suggestions.line', { address, type: typeLabel(site.siteType) ?? t('sites.suggestions.unknownType') })}
                </span>
                <Button
                  variant="secondary"
                  disabled={pending}
                  aria-label={t('sites.suggestions.chooseLabel', { address })}
                  onClick={() => {
                    void choose(site.id);
                  }}
                >
                  {t('sites.suggestions.choose')}
                </Button>
              </div>
            </ListItem>
          );
        })}
      </List>
      {failure === null ? null : (
        <InlineAlert tone="error">
          {failure === 'gone'
            ? t('sites.suggestions.gone')
            : failure === 'rateLimited'
              ? t('sites.suggestions.rateLimitedChoose', { seconds: retryAfter })
              : t('sites.suggestions.chooseError')}
        </InlineAlert>
      )}
    </section>,
  );
}
