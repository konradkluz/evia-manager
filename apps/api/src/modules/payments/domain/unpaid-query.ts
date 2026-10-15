/**
 * The query of the summary of unpaid invoices (EVM-055 AC1–AC4; SR-INPUT-01, SR-API-04; ASVS V2.2.1): a strict schema — an unknown
 * `view`, a day that is not a real date of 2000-01-01…2100-12-31, `dueFrom` after `dueTo`, a customer that is not a UUID, a limit that
 * is not 1..100 or a cursor that is not base64url within 512 characters is `400 validation_failed` (never a 500; the answer names the
 * field and the code, never the value). Pure functions of the input; no database. Filters combine with AND. The order is fixed
 * ("Najdłużej po terminie": due date, then the identifier) — there is no `sort`.
 *
 * "Overdue" is DERIVED, never stored: `overdueDays` is the one place that turns a due date and the day of the page into a number of days
 * (>= 1 or `null`); the SQL only compares `due_date < :asOf`, so the two cannot disagree (the boundary is the same: the due day itself
 * is not overdue).
 */
import { zUnpaidView } from '@evia/contracts/zod';
import { z } from 'zod';

export type UnpaidView = z.infer<typeof zUnpaidView>;

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;
export const MIN_DUE_DAY = '2000-01-01';
export const MAX_DUE_DAY = '2100-12-31';

const dueDay = z.iso.date().refine((day) => day >= MIN_DUE_DAY && day <= MAX_DUE_DAY, { message: 'out of range' });

const unpaidQueryShape = {
  view: zUnpaidView.optional(),
  dueFrom: dueDay.optional(),
  dueTo: dueDay.optional(),
  customerId: z.uuid().optional(),
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

/** `dueFrom` after `dueTo` is one `validation_failed` on `/dueTo` (code `invalid`) — never an echo of the value. */
export const unpaidQuerySchema = z.strictObject(unpaidQueryShape).superRefine((query, context) => {
  if (query.dueFrom !== undefined && query.dueTo !== undefined && query.dueFrom > query.dueTo) {
    context.addIssue({ code: 'custom', path: ['dueTo'], message: 'before dueFrom' });
  }
});

/** The query as the reader needs it: defaults applied. */
export interface UnpaidQuery {
  readonly view: UnpaidView;
  /** `YYYY-MM-DD`, inclusive */
  readonly dueFrom: string | undefined;
  /** `YYYY-MM-DD`, inclusive */
  readonly dueTo: string | undefined;
  readonly customerId: string | undefined;
  readonly limit: number;
  readonly cursor: string | undefined;
}

export const resolveUnpaidQuery = unpaidQuerySchema.transform((query): UnpaidQuery => ({
  view: query.view ?? 'unpaid',
  dueFrom: query.dueFrom,
  dueTo: query.dueTo,
  customerId: query.customerId,
  limit: query.limit ?? DEFAULT_LIMIT,
  cursor: query.cursor,
}));

/** The normalised filters in a fixed order — what a cursor is bound to (`limit` and `cursor` itself are not part of it). */
export const filterPartsOf = (query: UnpaidQuery): string[] => [query.view, query.dueFrom ?? '', query.dueTo ?? '', query.customerId ?? ''];

/** Where the next page starts: the due date and the identifier of the last item (the order is total). */
export interface Position {
  readonly dueDate: string;
  readonly id: string;
}

const positionSchema = z.tuple([z.iso.date(), z.uuid()]);

/** @returns the position as a typed value, or `undefined` for parts that do not fit (validated again after decryption) */
export function parsePosition(parts: readonly string[]): Position | undefined {
  const parsed = positionSchema.safeParse(parts);
  return parsed.success ? { dueDate: parsed.data[0], id: parsed.data[1] } : undefined;
}

export const positionParts = (item: Position): string[] => [item.dueDate, item.id];

const DAY_MS = 24 * 60 * 60 * 1000;
const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / DAY_MS;

/**
 * Full calendar days from the due date to `asOf` (both `YYYY-MM-DD` in `Europe/Warsaw`): a difference of dates, so a change of the
 * clock (2026-10-25) does not change it. `null` when the due day has not passed (the due day itself is not overdue).
 */
export function overdueDaysOf(dueDate: string, asOf: string): number | null {
  const days = dayNumber(asOf) - dayNumber(dueDate);
  return days >= 1 ? days : null;
}
