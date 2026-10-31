/**
 * The query of the journal of an order (EVM-037 AC6; SR-INPUT-01, SR-API-02, SR-API-04; ASVS V2.2.1): a strict schema — a kind
 * outside the list (the events are chosen by `eventGroup`, never by `kind`), a group of events outside the list, a group together
 * with `kind` (the group implies the kind `event`; EVM-038 AC4), a stage that is not a UUID, a limit that is not 1..100 and a cursor that is not
 * base64url within 512 characters are `400 validation_failed`. Pure functions of the input; no database. Filters combine with AND.
 * The values of the filters never reach a log, a metric or the audit trail. A cursor is bound to the ORDER too: it is not valid on
 * another order's journal.
 */
import { zTimelineEntryInputKind, zTimelineEventGroup } from '@evia/contracts/zod';
import { z } from 'zod';
import type { PagePosition } from '../infrastructure/timeline-store.ts';
import { JOURNAL_EVENT_CODES, type JournalEventCode } from './event-payload.ts';

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

/** The codes of the payments (EVM-054 AC3, EVM-057 AC4) - the group "Płatności", disjoint from "Zmiany statusów". */
const PAYMENT_EVENT_CODES = [
  'payment_milestone_status_changed',
  'payment_milestone_deleted',
] as const satisfies readonly JournalEventCode[];

/** The codes of the media (EVM-044) - the group "Media i dokumenty" has its own story (E6); until then the entry is in no named group. */
const MEDIA_EVENT_CODES = ['media_assets_added', 'document_added'] as const satisfies readonly JournalEventCode[];

/**
 * The codes of every group of events (a closed list of disjoint groups; the group of E6 comes with its story): "Zmiany statusów" is
 * every code of the order, its stages, data and scope - every code that is not in another group.
 */
export const EVENT_GROUP_CODES = {
  status_changes: JOURNAL_EVENT_CODES.filter(
    (code) => !(PAYMENT_EVENT_CODES as readonly string[]).includes(code) && !(MEDIA_EVENT_CODES as readonly string[]).includes(code),
  ),
  payments: PAYMENT_EVENT_CODES,
} as const satisfies Record<z.infer<typeof zTimelineEventGroup>, readonly JournalEventCode[]>;

export const timelineListQuerySchema = z
  .strictObject({
    kind: zTimelineEntryInputKind.optional(),
    eventGroup: zTimelineEventGroup.optional(),
    procedureStageId: z.uuid().optional(),
    includeDeleted: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
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
  })
  .refine((query) => query.eventGroup === undefined || query.kind === undefined, {
    path: ['eventGroup'],
    message: 'conflicts_with_kind',
  });

export interface TimelineListQuery {
  readonly kind: z.infer<typeof zTimelineEntryInputKind> | undefined;
  readonly eventGroup: z.infer<typeof zTimelineEventGroup> | undefined;
  readonly procedureStageId: string | undefined;
  /** Also the entries that are soft deleted (EVM-040); the Administrator only - the use case refuses the others. */
  readonly includeDeleted: boolean;
  readonly limit: number;
  readonly cursor: string | undefined;
}

export const resolveTimelineListQuery = timelineListQuerySchema.transform((query): TimelineListQuery => ({
  kind: query.kind,
  eventGroup: query.eventGroup,
  procedureStageId: query.procedureStageId,
  includeDeleted: query.includeDeleted ?? false,
  limit: query.limit ?? DEFAULT_LIMIT,
  cursor: query.cursor,
}));

/** The normalised filters in a fixed order, with the order of the journal — what a cursor is bound to (not `limit`, not the cursor). */
export const filterPartsOf = (workOrderId: string, query: TimelineListQuery): string[] => [
  workOrderId,
  query.kind ?? '',
  query.eventGroup ?? '',
  query.procedureStageId ?? '',
  // a cursor of the list with the deleted entries is not valid for the list without them, and the other way round (EVM-040)
  query.includeDeleted ? 'deleted' : '',
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
