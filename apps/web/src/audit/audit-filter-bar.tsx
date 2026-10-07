import type { AuditAction, AuditOutcome } from '@evia/contracts';
import { Button, DateField, FilterChip, Select, type SelectGroup, type SelectOption } from '@evia/ui-web';
import { useTranslation } from 'react-i18next';
import { auditActionGroups, auditActionLabels, auditOutcomeLabels } from '../i18n/audit-labels.ts';
import { NO_FILTERS, periodOf, quickRangeOf, type AuditFilters, type QuickRange } from './filters.ts';
import { checkPeriod, formatDay, todayIn } from './period.ts';

export interface AuditFilterBarProps {
  readonly filters: AuditFilters;
  /** Persons known so far (`userId` → `displayName`), from the events already seen. */
  readonly people: ReadonlyMap<string, string>;
  /** Offline: filters are disabled and say why. */
  readonly disabled: boolean;
  /** The server's estimate of now, for "Dziś" and the quick ranges. */
  readonly now: number;
  readonly onChange: (next: AuditFilters) => void;
}

/**
 * FilterBar of W-18 (styleguide § 3.7; EVM-029 AC5): action, person, outcome and period with quick ranges. Filters apply
 * at once (no "Zastosuj"); active ones are chips with an `x` and there is "Wyczyść filtry". The period is checked before
 * anything is sent (order and length). The person list is built from the events seen so far — the list of accounts (W-16)
 * does not exist yet.
 */
export function AuditFilterBar({ filters, people, disabled, now, onChange }: AuditFilterBarProps) {
  const { t } = useTranslation();
  const today = todayIn(now);
  const quick = quickRangeOf(filters, today);
  const problem = checkPeriod(filters.from, filters.to);
  const periodError =
    problem === 'order' ? t('audit.filters.periodOrder') : problem === 'length' ? t('audit.filters.periodLength') : undefined;
  const actionOptions: Array<SelectOption | SelectGroup> = [
    { value: '', label: t('audit.filters.allActions') },
    ...auditActionGroups.map((group) => ({
      label: group.label,
      options: group.actions.map((action) => ({ value: action, label: auditActionLabels[action] })),
    })),
  ];
  const peopleOptions: SelectOption[] = [
    { value: '', label: t('audit.filters.allPeople') },
    ...[...people].sort((a, b) => a[1].localeCompare(b[1], 'pl')).map(([value, label]) => ({ value, label })),
  ];
  const outcomeOptions: SelectOption[] = [
    { value: '', label: t('audit.filters.allOutcomes') },
    ...(['success', 'denied', 'failed'] as const).map((value) => ({ value, label: auditOutcomeLabels[value] })),
  ];
  const quickChips: ReadonlyArray<{ readonly range: Exclude<QuickRange, null>; readonly label: string }> = [
    { range: 'today', label: t('audit.filters.today') },
    { range: 'days7', label: t('audit.filters.days7') },
    { range: 'days30', label: t('audit.filters.days30') },
  ];
  const hint = disabled ? t('audit.filters.offlineHint') : undefined;
  const chips: Array<{ readonly key: string; readonly label: string; readonly clear: Partial<AuditFilters> }> = [];
  if (filters.action !== '') {
    chips.push({
      key: 'action',
      label: t('audit.filters.chipAction', { value: auditActionLabels[filters.action] }),
      clear: { action: '' },
    });
  }
  if (filters.actorUserId !== '') {
    const name = people.get(filters.actorUserId) ?? '';
    chips.push({ key: 'person', label: t('audit.filters.chipPerson', { value: name }), clear: { actorUserId: '' } });
  }
  if (filters.outcome !== '') {
    chips.push({
      key: 'outcome',
      label: t('audit.filters.chipOutcome', { value: auditOutcomeLabels[filters.outcome] }),
      clear: { outcome: '' },
    });
  }
  if (filters.from !== '' || filters.to !== '') {
    const open = t('audit.filters.periodOpen');
    chips.push({
      key: 'period',
      label: t('audit.filters.chipPeriod', {
        from: filters.from === '' ? open : formatDay(filters.from),
        to: filters.to === '' ? open : formatDay(filters.to),
      }),
      clear: { from: '', to: '' },
    });
  }
  return (
    <section aria-label={t('audit.filters.label')} className="flex flex-col gap-stack-md p-inset-md rounded-card bg-bg-surface-subtle">
      <div className="flex flex-wrap items-start gap-inline-md">
        <Select
          label={t('audit.filters.action')}
          value={filters.action}
          options={actionOptions}
          disabled={disabled}
          {...(hint === undefined ? {} : { hint })}
          onChange={(value) => {
            onChange({ ...filters, action: value as AuditAction | '' });
          }}
        />
        <Select
          label={t('audit.filters.person')}
          value={filters.actorUserId}
          options={peopleOptions}
          disabled={disabled}
          onChange={(value) => {
            onChange({ ...filters, actorUserId: value });
          }}
        />
        <Select
          label={t('audit.filters.outcome')}
          value={filters.outcome}
          options={outcomeOptions}
          disabled={disabled}
          onChange={(value) => {
            onChange({ ...filters, outcome: value as AuditOutcome | '' });
          }}
        />
        <DateField
          label={t('audit.filters.from')}
          value={filters.from}
          disabled={disabled}
          {...(periodError === undefined ? {} : { error: periodError })}
          onChange={(value) => {
            onChange({ ...filters, from: value });
          }}
        />
        <DateField
          label={t('audit.filters.to')}
          value={filters.to}
          disabled={disabled}
          onChange={(value) => {
            onChange({ ...filters, to: value });
          }}
        />
      </div>
      <div role="group" aria-label={t('audit.filters.quick')} className="flex flex-wrap items-center gap-inline-sm">
        {quickChips.map(({ range, label }) => (
          <FilterChip
            key={range}
            variant="choice"
            label={label}
            selected={quick === range}
            disabled={disabled}
            onClick={() => {
              onChange({ ...filters, ...periodOf(range, today) });
            }}
          />
        ))}
      </div>
      {chips.length === 0 ? null : (
        <div role="group" aria-label={t('audit.filters.active')} className="flex flex-wrap items-center gap-inline-sm">
          {chips.map((chip) => (
            <FilterChip
              key={chip.key}
              variant="active"
              label={chip.label}
              removeLabel={t('audit.filters.remove', { filter: chip.label })}
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
              onChange(NO_FILTERS);
            }}
          >
            {t('audit.filters.clear')}
          </Button>
        </div>
      )}
    </section>
  );
}
