import type { WorkOrderSort, WorkOrderStatus } from '@evia/contracts';
import { Button, FilterChip, SearchField, Select, TextField, type SelectGroup, type SelectOption } from '@evia/ui-web';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { partyKindLabels, siteTypeLabels } from '../i18n/catalog-labels.ts';
import { phraseState } from '../search/use-phrase-search.ts';
import { workOrderSortLabels, workOrderStatusLabels } from '../i18n/work-order-labels.ts';
import { useDebounced } from '../shell/use-debounced.ts';
import {
  DSO_VIEW,
  isFiltered,
  NO_FILTERS,
  parseWaitingDays,
  WORK_ORDER_STATUSES,
  type ViewId,
  type WaitingTarget,
  type WorkOrderFilters,
} from './filters.ts';
import { useTemplates } from './use-order-lookups.ts';
import { WorkOrderMoreFilters } from './work-order-more-filters.tsx';

export interface WorkOrderFilterBarProps {
  readonly filters: WorkOrderFilters;
  /** Coordinators seen so far (`id` → `displayName`): the list of accounts (W-16) does not exist yet. */
  readonly people: ReadonlyMap<string, string>;
  /** Offline: the filters are disabled and say why. */
  readonly disabled: boolean;
  readonly onChange: (next: WorkOrderFilters) => void;
}

const SORTS: readonly WorkOrderSort[] = ['-number', 'number', '-createdAt', 'createdAt', 'longestWaitingSince', 'nextDueDate'];

/** The panel waits this long after the last key before it asks for the new "dłużej niż [X] dni" (a request per pause, not per key). */
const DAYS_PAUSE_MS = 300;

/** The kinds of party of the filter, in the order of the dictionary (the OSD is the one that matters most — it is the first). */
const KIND_ORDER = Object.keys(partyKindLabels) as Array<keyof typeof partyKindLabels>;

/**
 * FilterBar of W-10 (styleguide § 3.7; EVM-017 AC2): the views "Wszystkie niezamknięte" and "Moje" (chips), the statuses
 * (a chip each — several at once), "Opiekun" and "Sortuj". Filters apply at once (no "Zastosuj"); the active ones are
 * chips with an `x` and there is "Wyczyść filtry". Choosing a status leaves "Wszystkie niezamknięte" (it would exclude
 * the closed statuses the person may be asking for). "Opiekun" lives only in the memory of the tab.
 *
 * EVM-034 AC2, AC3: "Czekamy na" — the customer, any party or a kind of party — with "dłużej niż [X] dni" (1–365, applied after
 * a pause in typing; a value out of the range is told and not sent), and the saved view "Czekamy na OSD > 14 dni". The address
 * carries only the kind of party and X, or the identifier of the view. The view and the filter exclude each other: choosing
 * one takes the other away (the view already is "OSD, 14 days").
 *
 * EVM-072 AC2, AC4: the search field (the phrase is in `filters.phrase`, the memory of the tab; shorter than 3 characters it is
 * never sent) and the panel "Więcej filtrów" ("Typ obiektu", "Szablon" — also memory of the tab). Offline the field is disabled and
 * says "Wyszukasz po powrocie połączenia.".
 */
export function WorkOrderFilterBar({ filters, people, disabled, onChange }: WorkOrderFilterBarProps) {
  const { t } = useTranslation();
  const hint = disabled ? t('workOrders.filters.offlineHint') : undefined;
  const [moreOpen, setMoreOpen] = useState(false);
  const templates = useTemplates(filters.templateId !== '');
  const phrase = phraseState(filters.phrase);
  const searchHint = disabled
    ? t('workOrders.search.offlineHint')
    : phrase === 'long'
      ? t('workOrders.search.hintLong')
      : t('workOrders.search.hint');
  const select = (view: ViewId) => {
    // "Wszystkie niezamknięte" and a closed status exclude each other; the view takes the statuses back to "all".
    // The view "Czekamy na OSD > 14 dni" is a "Czekamy na" filter itself: the filter of the bar is taken away.
    onChange({
      ...filters,
      view,
      ...(view === 'all_open' ? { statuses: [] } : {}),
      ...(view === DSO_VIEW ? { waitingOn: '' as const } : {}),
    });
  };
  const chooseWaiting = (waitingOn: WaitingTarget) => {
    onChange({ ...filters, waitingOn, ...(waitingOn !== '' && filters.view === DSO_VIEW ? { view: 'all_open' as const } : {}) });
  };

  // "dłużej niż [X] dni": what is typed lives here; a valid number goes up after a pause. The field follows the filter when it changes
  // from outside (a chip removed, "Wyczyść filtry", a link).
  const [daysText, setDaysText] = useState(String(filters.waitingDays));
  useEffect(() => {
    setDaysText(String(filters.waitingDays));
  }, [filters.waitingDays]);
  const settledDays = useDebounced(daysText, DAYS_PAUSE_MS);
  useEffect(() => {
    const value = parseWaitingDays(settledDays);
    if (filters.waitingOn !== '' && value !== undefined && value !== filters.waitingDays) onChange({ ...filters, waitingDays: value });
    // Only a settled value of the field matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledDays]);
  const daysInvalid = parseWaitingDays(daysText) === undefined;
  const toggle = (status: WorkOrderStatus) => {
    const chosen = filters.statuses.includes(status);
    const statuses = WORK_ORDER_STATUSES.filter((entry) => (entry === status ? !chosen : filters.statuses.includes(entry)));
    onChange({ ...filters, statuses, view: filters.view === 'all_open' ? 'all' : filters.view });
  };
  const peopleOptions: SelectOption[] = [
    { value: '', label: t('workOrders.filters.allCoordinators') },
    ...[...people].sort((a, b) => a[1].localeCompare(b[1], 'pl')).map(([value, label]) => ({ value, label })),
  ];
  const sortOptions: SelectOption[] = SORTS.map((value) => ({ value, label: workOrderSortLabels[value] }));
  const kindGroup: SelectGroup = {
    label: t('workOrders.filters.waitingKinds'),
    options: KIND_ORDER.map((kind) => ({ value: kind, label: partyKindLabels[kind] })),
  };
  const waitingOptions: Array<SelectOption | SelectGroup> = [
    { value: '', label: t('workOrders.filters.waitingNone') },
    { value: 'customer', label: t('workOrders.filters.waitingCustomer') },
    { value: 'party', label: t('workOrders.filters.waitingAnyParty') },
    kindGroup,
  ];
  const waitingLabel = (target: WaitingTarget): string =>
    target === 'customer'
      ? t('workOrders.filters.waitingCustomer')
      : target === 'party' || target === ''
        ? t('workOrders.filters.waitingAnyParty')
        : partyKindLabels[target];
  const chips: Array<{ readonly key: string; readonly label: string; readonly clear: Partial<WorkOrderFilters> }> = [];
  for (const status of filters.statuses) {
    chips.push({
      key: `status-${status}`,
      label: t('workOrders.filters.chipStatus', { value: workOrderStatusLabels[status] }),
      clear: { statuses: filters.statuses.filter((entry) => entry !== status) },
    });
  }
  if (filters.waitingOn !== '') {
    chips.push({
      key: 'waiting',
      label: t('workOrders.filters.chipWaiting', { who: waitingLabel(filters.waitingOn), days: filters.waitingDays }),
      clear: { waitingOn: '', waitingDays: NO_FILTERS.waitingDays },
    });
  }
  if (filters.coordinatorId !== '') {
    chips.push({
      key: 'coordinator',
      label: t('workOrders.filters.chipCoordinator', { value: people.get(filters.coordinatorId) ?? '' }),
      clear: { coordinatorId: '' },
    });
  }
  if (filters.siteType !== '') {
    chips.push({
      key: 'site-type',
      label: t('workOrders.filters.chipSiteType', { value: siteTypeLabels[filters.siteType] }),
      clear: { siteType: '' },
    });
  }
  if (filters.templateId !== '') {
    chips.push({
      key: 'template',
      label: t('workOrders.filters.chipTemplate', {
        value: templates.data?.find((template) => template.id === filters.templateId)?.name ?? '',
      }),
      clear: { templateId: '' },
    });
  }
  return (
    <section aria-label={t('workOrders.filters.label')} className="flex flex-col gap-stack-md p-inset-md rounded-card bg-bg-surface-subtle">
      <SearchField
        label={t('workOrders.search.label')}
        value={filters.phrase}
        hint={searchHint}
        clearLabel={t('workOrders.search.clear')}
        disabled={disabled}
        onChange={(phraseText) => {
          onChange({ ...filters, phrase: phraseText });
        }}
      />
      <div role="group" aria-label={t('workOrders.filters.views')} className="flex flex-wrap items-center gap-inline-sm">
        <FilterChip
          variant="choice"
          label={t('workOrders.filters.viewAllOpen')}
          selected={filters.view === 'all_open'}
          disabled={disabled}
          onClick={() => {
            select('all_open');
          }}
        />
        <FilterChip
          variant="choice"
          label={t('workOrders.filters.viewMine')}
          selected={filters.view === 'mine'}
          disabled={disabled}
          onClick={() => {
            select(filters.view === 'mine' ? 'all_open' : 'mine');
          }}
        />
        <FilterChip
          variant="choice"
          label={t('workOrders.filters.viewDso')}
          selected={filters.view === DSO_VIEW}
          disabled={disabled}
          onClick={() => {
            select(filters.view === DSO_VIEW ? 'all_open' : DSO_VIEW);
          }}
        />
      </div>
      <div role="group" aria-label={t('workOrders.filters.status')} className="flex flex-wrap items-center gap-inline-sm">
        {WORK_ORDER_STATUSES.map((status) => (
          <FilterChip
            key={status}
            variant="choice"
            label={workOrderStatusLabels[status]}
            selected={filters.statuses.includes(status)}
            disabled={disabled}
            onClick={() => {
              toggle(status);
            }}
          />
        ))}
      </div>
      <div className="grid grid-cols-1 items-start gap-inline-md medium:grid-cols-2 expanded:grid-cols-3">
        <Select
          label={t('workOrders.filters.coordinator')}
          value={filters.coordinatorId}
          options={peopleOptions}
          disabled={disabled}
          {...(hint === undefined ? {} : { hint })}
          onChange={(value) => {
            onChange({ ...filters, coordinatorId: value });
          }}
        />
        <Select
          label={t('workOrders.filters.waiting')}
          value={filters.waitingOn}
          options={waitingOptions}
          disabled={disabled}
          onChange={(value) => {
            chooseWaiting(value as WaitingTarget);
          }}
        />
        {filters.waitingOn === '' ? null : (
          <TextField
            label={t('workOrders.filters.waitingDays')}
            value={daysText}
            inputMode="numeric"
            suffix={t('workOrders.filters.waitingDaysSuffix')}
            disabled={disabled}
            {...(daysInvalid ? { error: t('workOrders.filters.waitingDaysError') } : { hint: t('workOrders.filters.waitingDaysHint') })}
            onChange={(event) => {
              setDaysText(event.target.value);
            }}
          />
        )}
        <Select
          label={t('workOrders.filters.sort')}
          value={filters.sort}
          options={sortOptions}
          disabled={disabled}
          onChange={(value) => {
            onChange({ ...filters, sort: value as WorkOrderSort });
          }}
        />
      </div>
      <WorkOrderMoreFilters
        siteType={filters.siteType}
        templateId={filters.templateId}
        open={moreOpen}
        disabled={disabled}
        onOpenChange={setMoreOpen}
        onChange={(more) => {
          onChange({ ...filters, ...more });
        }}
      />
      {chips.length === 0 && !isFiltered(filters) ? null : (
        <div role="group" aria-label={t('workOrders.filters.active')} className="flex flex-wrap items-center gap-inline-sm">
          {chips.map((chip) => (
            <FilterChip
              key={chip.key}
              variant="active"
              label={chip.label}
              removeLabel={t('workOrders.filters.remove', { filter: chip.label })}
              disabled={disabled}
              onClick={() => {
                onChange({ ...filters, ...chip.clear });
              }}
            />
          ))}
          <Button
            variant="tertiary"
            disabled={disabled}
            onClick={() => {
              onChange({ ...NO_FILTERS, sort: filters.sort });
            }}
          >
            {t('workOrders.filters.clear')}
          </Button>
        </div>
      )}
    </section>
  );
}
