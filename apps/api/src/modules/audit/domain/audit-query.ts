/**
 * The query of the audit log (EVM-029 AC5, EVM-080 AC1, AC2; SR-API-02, SR-API-04; ASVS V2.2.1, V2.4.1; CWE-89, CWE-20): a strict
 * schema — an unknown parameter, a value outside a closed list, a period of more than 2 years, `from` after `to`, a limit outside
 * 1..100 or a cursor that is not base64url within 512 characters is `400 validation_failed` (never a 500). A cursor of the right
 * shape that this server did not issue for this operation, user and filters is `400 invalid_cursor` (decided by the service, which
 * holds the codec). Pure functions of the input and of the clock; no database. The values of the filters never reach a log or the
 * audit trail.
 */
import { z } from 'zod';
import { scopeOf } from '../../../platform/crypto/opaque-cursor.ts';
import { AUDIT_ACTIONS, AUDIT_OUTCOMES } from './audit-record.ts';

export const DEFAULT_PERIOD_DAYS = 30;
/** 2 years: the retention of the trail (P4) and the widest period one request may cover. */
export const MAX_PERIOD_DAYS = 730;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;
const DAY_MS = 86_400_000;

/** The position after the last item of a page: the time and the identifier of the event (a total order — `id` breaks ties). */
export interface AuditCursor {
  readonly occurredAt: Date;
  readonly id: string;
}

/** What a cursor of the audit log carries (inside the encrypted token): the anchor of the period and where the next page starts. */
export interface AuditPosition {
  /** The end of the period of the first page ("now" at that moment unless the request named `to`): the same on every page. */
  readonly asOf: Date;
  readonly cursor: AuditCursor;
}

/** Identifier of the operation in the contract; the cursor is bound to it. */
export const LIST_AUDIT_OPERATION = 'listAuditEvents';

const position = z.tuple([z.iso.datetime(), z.iso.datetime(), z.uuid()]);

/** The position for the cursor of the next page: `[asOf, occurredAt, id]` as ISO 8601 strings and a UUID. */
export const auditPositionParts = (asOf: Date, last: AuditCursor): string[] => [asOf.toISOString(), last.occurredAt.toISOString(), last.id];

/** @returns the position as typed values, or undefined for a position that does not fit (validated again after decryption) */
export function parseAuditPosition(parts: readonly string[]): AuditPosition | undefined {
  const parsed = position.safeParse(parts);
  if (!parsed.success) return undefined;
  const [asOf, occurredAt, id] = parsed.data;
  return { asOf: new Date(asOf), cursor: { occurredAt: new Date(occurredAt), id } };
}

const dateTime = z.iso.datetime({ offset: true }).max(40);

export const auditQuerySchema = z.strictObject({
  action: z.enum(AUDIT_ACTIONS).optional(),
  actorUserId: z.uuid().optional(),
  outcome: z.enum(AUDIT_OUTCOMES).optional(),
  from: dateTime.optional(),
  to: dateTime.optional(),
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

/** The request as sent, validated for its shape only; the period and the cursor are resolved after the cursor is opened. */
export type AuditFilters = z.infer<typeof auditQuerySchema>;

/**
 * The filters a cursor is bound to, in a fixed order, exactly as the request NAMED them: an omitted `to` stays empty (it is not
 * "now"), so the scope is the same on every page, and it differs from any `to` that was sent. Not `limit` and not the cursor, like
 * the other lists. The period of the first page is fixed by `asOf` inside the cursor, not by the scope.
 */
export const auditScope = (query: AuditFilters): string =>
  scopeOf([query.action ?? '', query.actorUserId ?? '', query.outcome ?? '', query.from ?? '', query.to ?? '']);

/** The query as the reader needs it: the period resolved, the limit defaulted, the cursor opened. */
export interface AuditQuery {
  readonly action: (typeof AUDIT_ACTIONS)[number] | undefined;
  readonly actorUserId: string | undefined;
  readonly outcome: (typeof AUDIT_OUTCOMES)[number] | undefined;
  readonly from: Date;
  readonly to: Date;
  readonly limit: number;
  readonly cursor: AuditCursor | undefined;
}

/**
 * The schema of the query with the cross-field rules, resolved at `anchor` — "now" on the first page, the `asOf` of the cursor on the
 * next ones, so a default period does not slide while the client pages: the period defaults to the 30 days up to the anchor, `from`
 * must not be after `to`, the period must not exceed 2 years. Every rule names the offending parameter (a JSON Pointer in the problem).
 * @param cursor the position opened from the cursor of the request (the cursor string itself is only checked for its shape here)
 */
export const resolveAuditQuery = (anchor: Date, cursor?: AuditCursor) =>
  auditQuerySchema.transform((query, context): AuditQuery => {
    const to = query.to === undefined ? anchor : new Date(query.to);
    const from = query.from === undefined ? new Date(to.getTime() - DEFAULT_PERIOD_DAYS * DAY_MS) : new Date(query.from);
    if (from.getTime() > to.getTime()) context.addIssue({ code: 'custom', path: ['from'], message: 'from_after_to' });
    else if (to.getTime() - from.getTime() > MAX_PERIOD_DAYS * DAY_MS)
      context.addIssue({ code: 'custom', path: ['from'], message: 'period_too_long' });
    return {
      action: query.action,
      actorUserId: query.actorUserId,
      outcome: query.outcome,
      from,
      to,
      limit: query.limit ?? DEFAULT_LIMIT,
      cursor,
    };
  });
