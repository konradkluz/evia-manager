import type { AuditAction, AuditOutcome, ListAuditEventsData } from '@evia/contracts';
import { addDays, endOfDay, startOfDay } from './period.ts';

/**
 * Filters of the audit log live only in the memory of the tab — not in the address and not in the title (a person is
 * personal data; styleguide § 3.7, SR-WEB-05). Empty strings mean "all".
 */
export interface AuditFilters {
  readonly action: AuditAction | '';
  readonly outcome: AuditOutcome | '';
  readonly actorUserId: string;
  /** `YYYY-MM-DD` days in Warsaw; both empty = the last 30 days chosen by the server. */
  readonly from: string;
  readonly to: string;
}

export const NO_FILTERS: AuditFilters = { action: '', outcome: '', actorUserId: '', from: '', to: '' };

/** Events on a page: the story EVM-029 AC5 (25) — within the API limit of 100. */
export const PAGE_SIZE = 25;

export const isFiltered = (filters: AuditFilters): boolean =>
  filters.action !== '' || filters.outcome !== '' || filters.actorUserId !== '' || filters.from !== '' || filters.to !== '';

export type QuickRange = 'today' | 'days7' | 'days30' | null;

/** The quick range that the period equals (the chips "Dziś", "7 dni", "30 dni"), or none. */
export function quickRangeOf(filters: AuditFilters, today: string): QuickRange {
  if (filters.from === '' && filters.to === '') return 'days30';
  if (filters.to !== today) return null;
  if (filters.from === today) return 'today';
  return filters.from === addDays(today, -6) ? 'days7' : null;
}

export function periodOf(range: Exclude<QuickRange, null>, today: string): Pick<AuditFilters, 'from' | 'to'> {
  switch (range) {
    case 'today':
      return { from: today, to: today };
    case 'days7':
      return { from: addDays(today, -6), to: today };
    case 'days30':
      return { from: '', to: '' };
  }
}

/** The query of `listAuditEvents` for the filters: Warsaw days become instants; an empty filter is left out. */
export function toQuery(filters: AuditFilters, cursor: string | undefined): NonNullable<ListAuditEventsData['query']> {
  const from = filters.from === '' ? null : startOfDay(filters.from);
  const to = filters.to === '' ? null : endOfDay(filters.to);
  return {
    limit: PAGE_SIZE,
    ...(filters.action === '' ? {} : { action: filters.action }),
    ...(filters.outcome === '' ? {} : { outcome: filters.outcome }),
    ...(filters.actorUserId === '' ? {} : { actorUserId: filters.actorUserId }),
    ...(from === null ? {} : { from }),
    ...(to === null ? {} : { to }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}
