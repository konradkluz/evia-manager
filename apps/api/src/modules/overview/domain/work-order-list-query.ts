/**
 * The query of the list of work orders (EVM-017 AC2, AC3; SR-INPUT-01, SR-INPUT-03, SR-API-04; ASVS V2.2.1; CWE-89, CWE-235):
 * a strict schema — an unknown value of `sort`, `view` or `status`, an empty element, a limit that is not 1..100 or a cursor
 * that is not base64url within 512 characters is `400 validation_failed` (never a 500). Pure functions of the input; no
 * database. Filters combine with AND. The values of the filters never reach a log, a metric or the audit trail.
 *
 * `sort` and `view` are closed lists here and extensible in the contract: later stories add values (`longestWaitingSince`,
 * `nextDueDate`, `urgency`; `overdue`, `unpaid`) additively. The sort is a map from the enum to fixed columns — a value of
 * the request never becomes a column name.
 */
import { zPartyKind, zSiteType, zWorkOrderSort, zWorkOrderStatus, zWorkOrderView, zWorkOrderWaitingOnFilter } from '@evia/contracts/zod';
import { z } from 'zod';

export const WORK_ORDER_STATUSES = zWorkOrderStatus.options;
export type WorkOrderStatus = z.infer<typeof zWorkOrderStatus>;
export type WorkOrderSort = z.infer<typeof zWorkOrderSort>;
export type WorkOrderView = z.infer<typeof zWorkOrderView>;
export type WaitingOnFilter = z.infer<typeof zWorkOrderWaitingOnFilter>;
export type SiteType = z.infer<typeof zSiteType>;

/** "Open" is every status but the closed ones (domain-model.md → WorkOrderStatus). */
export const CLOSED_STATUSES: readonly WorkOrderStatus[] = ['settled', 'cancelled'];

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;
export const DEFAULT_SORT: WorkOrderSort = '-number';
const MAX_STATUS_LIST = 20;
export const MIN_WAITING_DAYS = 1;
export const MAX_WAITING_DAYS = 365;

/** The warning threshold of "Czekamy na…" (styleguide § 4.4) and the threshold of the view "Czekamy na OSD > 14 dni" (D2). */
export const WAITING_WARNING_DAYS = 14;
/** The kind of the party of the view "Czekamy na OSD > 14 dni" (D2). */
export const DSO_PARTY_KIND = 'distribution_system_operator';

export type SortKey = 'number' | 'createdAt' | 'longestWaitingSince' | 'nextDueDate' | 'urgency';
export interface SortRule {
  readonly key: SortKey;
  readonly direction: 'asc' | 'desc';
}

/** The only way from a `sort` value to a column and a direction. */
export const SORT_RULES: Readonly<Record<WorkOrderSort, SortRule>> = Object.freeze({
  '-number': { key: 'number', direction: 'desc' },
  number: { key: 'number', direction: 'asc' },
  '-createdAt': { key: 'createdAt', direction: 'desc' },
  createdAt: { key: 'createdAt', direction: 'asc' },
  // "Najdłużej czekamy" and "Termin" (EVM-034 AC4): ascending only, an order without the date last (`infinity`), a tie by the id
  longestWaitingSince: { key: 'longestWaitingSince', direction: 'asc' },
  nextDueDate: { key: 'nextDueDate', direction: 'asc' },
  // "Najpilniejsze" (EVM-056 AC3; ADR-0017 D9): ascending only — the group 1..4, the day of its key (`infinity` in group 4), the id
  urgency: { key: 'urgency', direction: 'asc' },
});

/** Comma separated statuses of the closed list: no empty element, at most 20 elements; the set is normalised (sorted, no duplicates). */
const statusList = z
  .string()
  .max(240)
  .regex(/^[a-z_]+(,[a-z_]+)*$/)
  .transform((value) => value.split(','))
  .pipe(z.array(zWorkOrderStatus).max(MAX_STATUS_LIST))
  .transform((statuses) => [...new Set(statuses)].sort());

const listQueryShape = {
  status: statusList.optional(),
  view: zWorkOrderView.optional(),
  coordinatorId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  // "Więcej filtrów" (EVM-072 AC4): the type of the site (a code) and the template the order came from (an identifier of the catalogue)
  siteType: zSiteType.optional(),
  templateId: z.uuid().optional(),
  // "Czekamy na…" (EVM-034 AC2): codes and a number only — never an identifier of a party or a name (SR-API-04)
  waitingOn: zWorkOrderWaitingOnFilter.optional(),
  waitingOnPartyKind: zPartyKind.optional(),
  waitingLongerThanDays: z
    .string()
    .regex(/^[0-9]{1,3}$/)
    .transform(Number)
    .pipe(z.int().min(MIN_WAITING_DAYS).max(MAX_WAITING_DAYS))
    .optional(),
  sort: zWorkOrderSort.optional(),
  limit: z
    .string()
    .regex(/^[0-9]{1,3}$/)
    .transform(Number)
    .pipe(z.int().min(1).max(MAX_LIMIT))
    .optional(),
  cursor: z
    .string()
    .max(512)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
};

/**
 * `waitingOnPartyKind` names a kind of PARTY: together with `waitingOn=customer` it contradicts itself (`validation_failed` on
 * `/waitingOnPartyKind`, code `invalid` — never an echo of the value). Without `waitingOn` it means `party`.
 */
export const workOrderListQuerySchema = z.strictObject(listQueryShape).superRefine((query, context) => {
  if (query.waitingOn === 'customer' && query.waitingOnPartyKind !== undefined) {
    context.addIssue({ code: 'custom', path: ['waitingOnPartyKind'], message: 'contradicts waitingOn' });
  }
});

/** The query as the reader needs it: defaults applied, statuses normalised. */
export interface WorkOrderListQuery {
  readonly statuses: readonly WorkOrderStatus[];
  readonly view: WorkOrderView | undefined;
  readonly coordinatorId: string | undefined;
  /** the history of one customer (EVM-039, W-14): a filter like the others, under the same read policy */
  readonly customerId: string | undefined;
  /** "Więcej filtrów" (EVM-072): the type of the site and the template of the order — codes and a catalogue identifier, never personal data */
  readonly siteType: SiteType | undefined;
  readonly templateId: string | undefined;
  /** "Czekamy na…": who is waited for; `party` when only a kind is named */
  readonly waitingOn: WaitingOnFilter | undefined;
  readonly waitingOnPartyKind: string | undefined;
  readonly waitingLongerThanDays: number | undefined;
  readonly sort: WorkOrderSort;
  readonly limit: number;
  readonly cursor: string | undefined;
}

export const resolveWorkOrderListQuery = workOrderListQuerySchema.transform((query): WorkOrderListQuery => ({
  statuses: query.status ?? [],
  view: query.view,
  coordinatorId: query.coordinatorId,
  customerId: query.customerId,
  siteType: query.siteType,
  templateId: query.templateId,
  waitingOn: query.waitingOn ?? (query.waitingOnPartyKind === undefined ? undefined : 'party'),
  waitingOnPartyKind: query.waitingOnPartyKind,
  waitingLongerThanDays: query.waitingLongerThanDays,
  sort: query.sort ?? DEFAULT_SORT,
  limit: query.limit ?? DEFAULT_LIMIT,
  cursor: query.cursor,
}));

/** The normalised filters in a fixed order — what a cursor is bound to (`limit` and `cursor` itself are not part of it). */
export const filterPartsOf = (query: WorkOrderListQuery): string[] => [
  query.sort,
  query.view ?? '',
  query.statuses.join(','),
  query.coordinatorId ?? '',
  query.customerId ?? '',
  query.siteType ?? '',
  query.templateId ?? '',
  query.waitingOn ?? '',
  query.waitingOnPartyKind ?? '',
  query.waitingLongerThanDays === undefined ? '' : String(query.waitingLongerThanDays),
];

export type UrgencyGroup = 1 | 2 | 3 | 4;

/** The place of an order in "Najpilniejsze" (EVM-056, D9 — `payment-signals.ts`): the group, then the day of its key (`infinity` in group 4). */
export interface Urgency {
  readonly group: UrgencyGroup;
  /** `YYYY-MM-DD` or `infinity` */
  readonly day: string;
}

/**
 * Where the next page starts: the sort key of the last item (and its id, when the key is not unique). For the two sorts by a date the
 * key is the date or `infinity` (an order without the date), and the id breaks the tie.
 */
export type Position =
  | { readonly number: string }
  | { readonly createdAt: Date; readonly id: string }
  | { readonly day: string; readonly id: string }
  | { readonly group: UrgencyGroup; readonly day: string; readonly id: string };

const numberPosition = z.tuple([z.string().regex(/^[A-Za-z0-9-]{1,32}$/)]);
const createdAtPosition = z.tuple([z.iso.datetime(), z.uuid()]);
const day = z.union([z.iso.date(), z.literal('infinity')]);
const dayPosition = z.tuple([day, z.uuid()]);
/** The group of "Najpilniejsze" is one of 1..4 written as a digit — anything else (`0`, `5`, `01`, `1.0`) is not a position. */
const urgencyPosition = z.tuple([z.enum(['1', '2', '3', '4']).transform((group) => Number(group) as UrgencyGroup), day, z.uuid()]);

/** @returns the position as a typed value, or undefined for a position that does not fit the sort (validated again after decryption) */
export function parsePosition(sort: WorkOrderSort, parts: readonly string[]): Position | undefined {
  switch (SORT_RULES[sort].key) {
    case 'number': {
      const parsed = numberPosition.safeParse(parts);
      return parsed.success ? { number: parsed.data[0] } : undefined;
    }
    case 'createdAt': {
      const parsed = createdAtPosition.safeParse(parts);
      return parsed.success ? { createdAt: new Date(parsed.data[0]), id: parsed.data[1] } : undefined;
    }
    case 'longestWaitingSince':
    case 'nextDueDate': {
      const parsed = dayPosition.safeParse(parts);
      return parsed.success ? { day: parsed.data[0], id: parsed.data[1] } : undefined;
    }
    case 'urgency': {
      const parsed = urgencyPosition.safeParse(parts);
      return parsed.success ? { group: parsed.data[0], day: parsed.data[1], id: parsed.data[2] } : undefined;
    }
  }
}

/** The position of an item for the cursor of the next page. */
export function positionParts(
  sort: WorkOrderSort,
  item: {
    readonly number: string;
    readonly id: string;
    readonly createdAt: Date;
    readonly longestWaitingSince: string | null;
    readonly nextDueDate: string | null;
    /** the group and the day of "Najpilniejsze", as the query computed them (present when the page is sorted by it) */
    readonly urgency?: Urgency | undefined;
  },
): string[] {
  switch (SORT_RULES[sort].key) {
    case 'number':
      return [item.number];
    case 'createdAt':
      return [item.createdAt.toISOString(), item.id];
    case 'longestWaitingSince':
      return [item.longestWaitingSince ?? 'infinity', item.id];
    case 'nextDueDate':
      return [item.nextDueDate ?? 'infinity', item.id];
    case 'urgency': {
      // the reader computes the group and the day for every row of a page sorted by "Najpilniejsze": a row without them is a defect
      if (item.urgency === undefined) throw new Error('a row of a page sorted by urgency without its group');
      return [String(item.urgency.group), item.urgency.day, item.id];
    }
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / DAY_MS;

/**
 * Full calendar days from `since` to `today` (both `YYYY-MM-DD` in `Europe/Warsaw`): a difference of dates, so a change of the clock
 * (2026-10-25) does not change it. Never negative.
 */
export const daysBetween = (since: string, today: string): number => Math.max(0, dayNumber(today) - dayNumber(since));
