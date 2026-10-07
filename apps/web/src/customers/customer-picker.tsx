import { Button, Combobox } from '@evia/ui-web';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatPhone } from './format.ts';
import { useCustomerSearch } from './use-customer-search.ts';

/** The customer chosen in the form: only what the form shows (the API answers with nothing more, SR-DATA-03). */
export interface PickedCustomer {
  readonly id: string;
  readonly displayName: string;
  readonly phone: string;
}

export interface CustomerPickerProps {
  readonly selected: PickedCustomer | null;
  readonly onSelect: (customer: PickedCustomer) => void;
  readonly onClear: () => void;
  /** "Dodaj klienta" from the empty result (opens the dialog). */
  readonly onAdd: () => void;
}

/**
 * Section "1. Klient" of W-05 (EVM-020 AC1, AC8): a combobox that searches customers by what is typed (3 or more characters,
 * the phrase goes in the body of a POST), and after the choice a line with the customer and "Zmień klienta". The states:
 * loading — skeleton of 3 rows, no results — "Brak wyników dla „…”. [Dodaj klienta]", offline, `429`, a server error.
 * The typed phrase lives only in this component (memory of the tab), never in the address or the title of the tab.
 */
export function CustomerPicker({ selected, onSelect, onClear, onAdd }: CustomerPickerProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const search = useCustomerSearch(text, selected === null);
  const summary = useRef<HTMLParagraphElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const previous = useRef(selected?.id);

  // After a choice the field is gone and after "Zmień klienta" the line is: the focus follows (WCAG 2.4.3).
  useEffect(() => {
    if (previous.current === selected?.id) return;
    previous.current = selected?.id;
    (selected === null ? field : summary).current?.focus();
  }, [selected]);

  if (selected !== null) {
    return (
      <div className="flex flex-wrap items-center gap-inline-md">
        <p ref={summary} tabIndex={-1} className="text-body text-text-primary focus-visible:focus-ring">
          {t('customers.selected.summary', { name: selected.displayName, phone: formatPhone(selected.phone) })}
        </p>
        <Button variant="tertiary" onClick={onClear}>
          {t('customers.selected.change')}
        </Button>
      </div>
    );
  }

  const phrase = text.trim();
  let notice: ReactNode = null;
  if (search.state === 'ok') {
    if (!search.online) notice = <p>{t('customers.search.offline')}</p>;
    else if (search.error?.status === 429)
      notice = <p>{t('customers.search.rateLimited', { seconds: search.error.retryAfterSeconds ?? 60 })}</p>;
    else if (search.error !== undefined) {
      notice = (
        <>
          <p>{t('customers.search.error')}</p>
          <Button variant="secondary" onClick={search.retry}>
            {t('customers.search.retry')}
          </Button>
        </>
      );
    } else if (search.items?.length === 0) {
      notice = (
        <>
          <p>{t('customers.search.empty', { query: phrase })}</p>
          <Button onClick={onAdd}>{t('customers.search.add')}</Button>
        </>
      );
    }
  }
  const items = search.items ?? [];
  const announcement = search.loading
    ? t('customers.search.loading')
    : search.items === undefined
      ? ''
      : t('customers.search.found', { count: search.items.length });

  return (
    <Combobox
      label={t('customers.field.label')}
      placeholder={t('customers.field.placeholder')}
      value={text}
      onValueChange={setText}
      options={items.map((item) => ({ id: item.id, label: item.displayName, description: formatPhone(item.phone) }))}
      onSelect={(option) => {
        const item = items.find((candidate) => candidate.id === option.id);
        if (item !== undefined) {
          setText('');
          onSelect({ id: item.id, displayName: item.displayName, phone: item.phone });
        }
      }}
      listLabel={t('customers.field.listLabel')}
      loading={search.loading}
      notice={notice}
      announcement={announcement}
      hint={search.state === 'short' ? t('customers.field.hintShort') : search.state === 'long' ? t('customers.field.hintLong') : undefined}
      inputRef={field}
    />
  );
}
