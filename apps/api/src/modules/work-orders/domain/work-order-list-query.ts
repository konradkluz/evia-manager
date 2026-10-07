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
import { zWorkOrderSort, zWorkOrderStatus, zWorkOrderView } from '@evia/contracts/zod';
import { z } from 'zod';

export const WORK_ORDER_STATUSES = zWorkOrderStatus.options;
export type WorkOrderStatus = z.infer<typeof zWorkOrderStatus>;
export type WorkOrderSort = z.infer<typeof zWorkOrderSort>;
export type WorkOrderView = z.infer<typeof zWorkOrderView>;

/** "Open" is every status but the closed ones (domain-model.md → WorkOrderStatus). */
export const CLOSED_STATUSES: readonly WorkOrderStatus[] = ['settled', 'cancelled'];

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;
export const DEFAULT_SORT: WorkOrderSort = '-number';
const MAX_STATUS_LIST = 20;

export type SortKey = 'number' | 'createdAt';
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
});

/** Comma separated statuses of the closed list: no empty element, at most 20 elements; the set is normalised (sorted, no duplicates). */
const statusList = z
  .string()
  .max(240)
  .regex(/^[a-z_]+(,[a-z_]+)*$/)
  .transform((value) => value.split(','))
  .pipe(z.array(zWorkOrderStatus).max(MAX_STATUS_LIST))
  .transform((statuses) => [...new Set(statuses)].sort());

export const workOrderListQuerySchema = z.strictObject({
  status: statusList.optional(),
  view: zWorkOrderView.optional(),
  coordinatorId: z.uuid().optional(),
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
});

/** The query as the reader needs it: defaults applied, statuses normalised. */
export interface WorkOrderListQuery {
  readonly statuses: readonly WorkOrderStatus[];
  readonly view: WorkOrderView | undefined;
  readonly coordinatorId: string | undefined;
  readonly sort: WorkOrderSort;
  readonly limit: number;
  readonly cursor: string | undefined;
}

export const resolveWorkOrderListQuery = workOrderListQuerySchema.transform((query): WorkOrderListQuery => ({
  statuses: query.status ?? [],
  view: query.view,
  coordinatorId: query.coordinatorId,
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
];

/** Where the next page starts: the sort key of the last item (and its id, when the key is not unique). */
export type Position = { readonly number: string } | { readonly createdAt: Date; readonly id: string };

const numberPosition = z.tuple([z.string().regex(/^[A-Za-z0-9-]{1,32}$/)]);
const createdAtPosition = z.tuple([z.iso.datetime(), z.uuid()]);

/** @returns the position as a typed value, or undefined for a position that does not fit the sort (validated again after decryption) */
export function parsePosition(sort: WorkOrderSort, parts: readonly string[]): Position | undefined {
  if (SORT_RULES[sort].key === 'number') {
    const parsed = numberPosition.safeParse(parts);
    return parsed.success ? { number: parsed.data[0] } : undefined;
  }
  const parsed = createdAtPosition.safeParse(parts);
  return parsed.success ? { createdAt: new Date(parsed.data[0]), id: parsed.data[1] } : undefined;
}

/** The position of an item for the cursor of the next page. */
export function positionParts(
  sort: WorkOrderSort,
  item: { readonly number: string; readonly id: string; readonly createdAt: Date },
): string[] {
  return SORT_RULES[sort].key === 'number' ? [item.number] : [item.createdAt.toISOString(), item.id];
}
