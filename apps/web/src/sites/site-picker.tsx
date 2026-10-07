import { Button, Combobox } from '@evia/ui-web';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatAddress, formatSiteDetails } from './format.ts';
import type { PickedSite } from './site-form.ts';
import { useSiteSearch } from './use-site-search.ts';

export interface SitePickerProps {
  readonly selected: PickedSite | null;
  readonly onSelect: (site: PickedSite) => void;
  readonly onClear: () => void;
  /** "Nowa lokalizacja" from the empty result (switches the section to the form of a new site). */
  readonly onNew: () => void;
}

/**
 * "Istniejąca lokalizacja" of W-05 (EVM-021 AC1, AC7): a combobox that searches sites by what is typed (3 or more characters of the
 * address, the phrase in the body of a POST; Polish letters and case do not matter — the server decides), the result shows the type of
 * the object, the address and the parking spot; after the choice a line with the site and "Zmień lokalizację". The states: loading —
 * skeleton of 3 rows, no results — "Brak wyników dla „…”. [Nowa lokalizacja]", offline, `429`, a server error.
 */
export function SitePicker({ selected, onSelect, onClear, onNew }: SitePickerProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const search = useSiteSearch(text, selected === null);
  const summary = useRef<HTMLParagraphElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const previous = useRef(selected?.id);

  // After a choice the field is gone and after "Zmień lokalizację" the line is: the focus follows (WCAG 2.4.3).
  useEffect(() => {
    if (previous.current === selected?.id) return;
    previous.current = selected?.id;
    (selected === null ? field : summary).current?.focus();
  }, [selected]);

  if (selected !== null) {
    return (
      <div className="flex flex-wrap items-center gap-inline-md">
        <p ref={summary} tabIndex={-1} className="text-body text-text-primary focus-visible:focus-ring">
          {t('sites.selected.summary', { address: formatAddress(selected), details: formatSiteDetails(t, selected) })}
        </p>
        <Button variant="tertiary" onClick={onClear}>
          {t('sites.selected.change')}
        </Button>
      </div>
    );
  }

  const phrase = text.trim();
  let notice: ReactNode = null;
  if (search.state === 'ok') {
    if (!search.online) notice = <p>{t('sites.search.offline')}</p>;
    else if (search.error?.status === 429)
      notice = <p>{t('sites.search.rateLimited', { seconds: search.error.retryAfterSeconds ?? 60 })}</p>;
    else if (search.error !== undefined) {
      notice = (
        <>
          <p>{t('sites.search.error')}</p>
          <Button variant="secondary" onClick={search.retry}>
            {t('sites.search.retry')}
          </Button>
        </>
      );
    } else if (search.items?.length === 0) {
      notice = (
        <>
          <p>{t('sites.search.empty', { query: phrase })}</p>
          <Button onClick={onNew}>{t('sites.search.new')}</Button>
        </>
      );
    }
  }
  const items = search.items ?? [];
  const announcement = search.loading
    ? t('sites.search.loading')
    : search.items === undefined
      ? ''
      : t('sites.search.found', { count: search.items.length });

  return (
    <Combobox
      label={t('sites.field.label')}
      placeholder={t('sites.field.placeholder')}
      value={text}
      onValueChange={setText}
      options={items.map((item) => ({ id: item.id, label: formatAddress(item), description: formatSiteDetails(t, item) }))}
      onSelect={(option) => {
        const item = items.find((candidate) => candidate.id === option.id);
        if (item !== undefined) {
          setText('');
          onSelect(item);
        }
      }}
      listLabel={t('sites.field.listLabel')}
      loading={search.loading}
      notice={notice}
      announcement={announcement}
      hint={search.state === 'short' ? t('sites.field.hintShort') : search.state === 'long' ? t('sites.field.hintLong') : undefined}
      inputRef={field}
    />
  );
}
