import type { UnpaidView } from '@evia/contracts';
import { Button, DateField, FilterChip, Select } from '@evia/ui-web';
import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CustomerPicker } from '../customers/customer-picker.tsx';
import { DAY_MAX, DAY_MIN } from '../work-orders/milestone-days.ts';
import { isFiltered, PAGE_SIZES, rangeProblem, type UnpaidFilters } from './unpaid-filters.ts';

/** The customer of the filter: the identifier goes to the API, the name only to the chip (memory of the tab, never the address). */
export interface PickedFilterCustomer {
  readonly id: string;
  readonly displayName: string;
}

export interface UnpaidFilterBarProps {
  readonly filters: UnpaidFilters;
  readonly customer: PickedFilterCustomer | null;
  readonly pageSize: number;
  readonly disabled: boolean;
  readonly onView: (view: UnpaidView) => void;
  readonly onRange: (range: { readonly dueFrom: string; readonly dueTo: string }) => void;
  readonly onCustomer: (customer: PickedFilterCustomer | null) => void;
  readonly onPageSize: (size: number) => void;
  readonly onClear: () => void;
}

/**
 * The filters of W-11 (EVM-055 AC4; FilterBar § 3.7): "Pokaż" — the chips "Wszystkie wystawione" and "Po terminie" (the status; the
 * only filter in the address; "Do wystawienia" comes with EVM-059), "Termin" — the range of the due dates (two date fields, "od" may
 * not be after "do") and "Klient" — the search of customers by `POST /customers/search`, after the choice a chip with `x`. The range
 * and the customer are the memory of the tab: they are never in the address or the title of the tab. "Na stronie" is the size of a page.
 * Offline the filters are disabled (they would ask the server).
 */
export function UnpaidFilterBar({
  filters,
  customer,
  pageSize,
  disabled,
  onView,
  onRange,
  onCustomer,
  onPageSize,
  onClear,
}: UnpaidFilterBarProps) {
  const { t } = useTranslation();
  const groupId = useId();
  const problem = rangeProblem(filters);
  const rangeError =
    problem === 'order' ? t('payments.filters.rangeOrder') : problem === 'range' ? t('payments.filters.rangeYears') : undefined;
  return (
    <div className="flex flex-col gap-stack-md">
      <div role="group" aria-labelledby={groupId} className="flex flex-wrap items-center gap-inline-sm">
        <span id={groupId} className="text-label text-text-primary">
          {t('payments.filters.view')}
        </span>
        <FilterChip
          variant="choice"
          label={t('payments.filters.all')}
          selected={filters.view === 'unpaid'}
          disabled={disabled}
          onClick={() => {
            onView('unpaid');
          }}
        />
        <FilterChip
          variant="choice"
          label={t('payments.filters.overdue')}
          selected={filters.view === 'overdue'}
          disabled={disabled}
          onClick={() => {
            onView('overdue');
          }}
        />
        {isFiltered(filters) ? (
          <Button variant="tertiary" disabled={disabled} onClick={onClear}>
            {t('payments.filters.clear')}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-start gap-inline-md">
        <DateField
          label={t('payments.filters.dueFrom')}
          value={filters.dueFrom}
          min={DAY_MIN}
          max={DAY_MAX}
          disabled={disabled}
          onChange={(value) => {
            onRange({ dueFrom: value, dueTo: filters.dueTo });
          }}
        />
        <DateField
          label={t('payments.filters.dueTo')}
          value={filters.dueTo}
          min={DAY_MIN}
          max={DAY_MAX}
          disabled={disabled}
          {...(rangeError === undefined ? {} : { error: rangeError })}
          onChange={(value) => {
            onRange({ dueFrom: filters.dueFrom, dueTo: value });
          }}
        />
        <CustomerFilter customer={customer} disabled={disabled} onChange={onCustomer} />
        <Select
          label={t('payments.list.pageSize')}
          value={String(pageSize)}
          options={PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
          disabled={disabled}
          onChange={(value) => {
            onPageSize(Number(value));
          }}
        />
      </div>
    </div>
  );
}

/** "Klient": the search while none is chosen, a removable chip after the choice; the focus follows the change (WCAG 2.4.3). */
function CustomerFilter({
  customer,
  disabled,
  onChange,
}: {
  readonly customer: PickedFilterCustomer | null;
  readonly disabled: boolean;
  readonly onChange: (customer: PickedFilterCustomer | null) => void;
}) {
  const { t } = useTranslation();
  const frame = useRef<HTMLDivElement>(null);
  const previous = useRef(customer?.id);
  useEffect(() => {
    if (previous.current === customer?.id) return;
    previous.current = customer?.id;
    const target = customer === null ? frame.current?.querySelector('input') : frame.current?.querySelector('button');
    target?.focus();
  }, [customer]);
  return (
    <div ref={frame} className="flex w-full min-w-0 max-w-form-max-width flex-col gap-stack-xs">
      {customer === null ? (
        <CustomerPicker
          selected={null}
          disabled={disabled}
          onSelect={(picked) => {
            onChange({ id: picked.id, displayName: picked.displayName });
          }}
          onClear={() => {
            onChange(null);
          }}
        />
      ) : (
        <>
          <span className="text-label text-text-primary">{t('payments.filters.customer')}</span>
          <div>
            <FilterChip
              variant="active"
              label={customer.displayName}
              removeLabel={t('payments.filters.removeCustomer', { name: customer.displayName })}
              disabled={disabled}
              onClick={() => {
                onChange(null);
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
