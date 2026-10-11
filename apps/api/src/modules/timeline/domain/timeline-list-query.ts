/**
 * The query of the journal of an order (EVM-037 AC6; SR-INPUT-01, SR-API-02, SR-API-04; ASVS V2.2.1): a strict schema — a kind
 * outside the list (the events are not a filter), a stage that is not a UUID, a limit that is not 1..100 and a cursor that is not
 * base64url within 512 characters are `400 validation_failed`. Pure functions of the input; no database. Filters combine with AND.
 * The values of the filters never reach a log, a metric or the audit trail. A cursor is bound to the ORDER too: it is not valid on
 * another order's journal.
 */
import { zTimelineEntryInputKind } from '@evia/contracts/zod';
import { z } from 'zod';
import type { PagePosition } from '../infrastructure/timeline-store.ts';

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

export const timelineListQuerySchema = z.strictObject({
  kind: zTimelineEntryInputKind.optional(),
  procedureStageId: z.uuid().optional(),
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

export interface TimelineListQuery {
  readonly kind: z.infer<typeof zTimelineEntryInputKind> | undefined;
  readonly procedureStageId: string | undefined;
  readonly limit: number;
  readonly cursor: string | undefined;
}

export const resolveTimelineListQuery = timelineListQuerySchema.transform((query): TimelineListQuery => ({
  kind: query.kind,
  procedureStageId: query.procedureStageId,
  limit: query.limit ?? DEFAULT_LIMIT,
  cursor: query.cursor,
}));

/** The normalised filters in a fixed order, with the order of the journal — what a cursor is bound to (not `limit`, not the cursor). */
export const filterPartsOf = (workOrderId: string, query: TimelineListQuery): string[] => [
  workOrderId,
  query.kind ?? '',
  query.procedureStageId ?? '',
];

const position = z.tuple([z.iso.datetime(), z.uuid()]);

/** @returns the position as a typed value, or undefined for a position that does not fit (validated again after decryption) */
export function parsePosition(parts: readonly string[]): PagePosition | undefined {
  const parsed = position.safeParse(parts);
  return parsed.success ? { createdAt: new Date(parsed.data[0]), id: parsed.data[1] } : undefined;
}

/** The position of an entry for the cursor of the next page. */
export const positionParts = (entry: { readonly id: string; readonly created_at: Date }): string[] => [
  entry.created_at.toISOString(),
  entry.id,
];
