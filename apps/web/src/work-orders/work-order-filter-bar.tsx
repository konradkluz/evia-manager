import type { WorkOrderSort, WorkOrderStatus } from '@evia/contracts';
import { Button, FilterChip, Select, type SelectOption } from '@evia/ui-web';
import { useTranslation } from 'react-i18next';
import { workOrderSortLabels, workOrderStatusLabels } from '../i18n/work-order-labels.ts';
import { isFiltered, NO_FILTERS, WORK_ORDER_STATUSES, type ViewId, type WorkOrderFilters } from './filters.ts';

export interface WorkOrderFilterBarProps {
  readonly filters: WorkOrderFilters;
  /** Coordinators seen so far (`id` → `displayName`): the list of accounts (W-16) does not exist yet. */
  readonly people: ReadonlyMap<string, string>;
  /** Offline: the filters are disabled and say why. */
  readonly disabled: boolean;
  readonly onChange: (next: WorkOrderFilters) => void;
}

const SORTS: readonly WorkOrderSort[] = ['-number', 'number', '-createdAt', 'createdAt'];

/**
 * FilterBar of W-10 (styleguide § 3.7; EVM-017 AC2): the views "Wszystkie niezamknięte" and "Moje" (chips), the statuses
 * (a chip each — several at once), "Opiekun" and "Sortuj". Filters apply at once (no "Zastosuj"); the active ones are
 * chips with an `x` and there is "Wyczyść filtry". Choosing a status leaves "Wszystkie niezamknięte" (it would exclude
 * the closed statuses the person may be asking for). "Opiekun" lives only in the memory of the tab.
 */
export function WorkOrderFilterBar({ filters, people, disabled, onChange }: WorkOrderFilterBarProps) {
  const { t } = useTranslation();
  const hint = disabled ? t('workOrders.filters.offlineHint') : undefined;
  const select = (view: ViewId) => {
    // "Wszystkie niezamknięte" and a closed status exclude each other; the view takes the statuses back to "all".
    onChange({ ...filters, view, ...(view === 'all_open' ? { statuses: [] } : {}) });
  };
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
  const chips: Array<{ readonly key: string; readonly label: string; readonly clear: Partial<WorkOrderFilters> }> = [];
  for (const status of filters.statuses) {
    chips.push({
      key: `status-${status}`,
      label: t('workOrders.filters.chipStatus', { value: workOrderStatusLabels[status] }),
      clear: { statuses: filters.statuses.filter((entry) => entry !== status) },
    });
  }
  if (filters.coordinatorId !== '') {
    chips.push({
      key: 'coordinator',
      label: t('workOrders.filters.chipCoordinator', { value: people.get(filters.coordinatorId) ?? '' }),
      clear: { coordinatorId: '' },
    });
  }
  return (
    <section aria-label={t('workOrders.filters.label')} className="flex flex-col gap-stack-md p-inset-md rounded-card bg-bg-surface-subtle">
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
          label={t('workOrders.filters.sort')}
          value={filters.sort}
          options={sortOptions}
          disabled={disabled}
          onChange={(value) => {
            onChange({ ...filters, sort: value as WorkOrderSort });
          }}
        />
      </div>
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
