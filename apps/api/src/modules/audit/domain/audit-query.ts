/**
 * The query of the audit log (EVM-029 AC5; SR-API-02, SR-API-04; ASVS V2.2.1, V2.4.1; CWE-89, CWE-20): a strict schema —
 * an unknown parameter, a value outside a closed list, a period of more than 2 years, `from` after `to`, a limit outside
 * 1..100 or a cursor that is not exactly what this API issued is `400 validation_failed` (never a 500). Pure functions of
 * the input and of the clock; no database. The values of the filters never reach a log or the audit trail.
 */
import { z } from 'zod';
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

/** Opaque to the client: base64url of `[occurredAt as ISO 8601, id]`. */
export function encodeCursor({ occurredAt, id }: AuditCursor): string {
  return Buffer.from(JSON.stringify([occurredAt.toISOString(), id]), 'utf8').toString('base64url');
}

const cursorPayload = z.tuple([z.iso.datetime(), z.uuid()]);

/** @returns the position, or undefined for anything this API did not issue (also a re-encoded, non-canonical form) */
export function decodeCursor(cursor: string): AuditCursor | undefined {
  try {
    const parsed = cursorPayload.safeParse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    if (!parsed.success) return undefined;
    const position = { occurredAt: new Date(parsed.data[0]), id: parsed.data[1] };
    return Number.isNaN(position.occurredAt.getTime()) || encodeCursor(position) !== cursor ? undefined : position;
  } catch {
    return undefined;
  }
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
    .max(256)
    .regex(/^[A-Za-z0-9_-]+$/)
    .refine((value) => decodeCursor(value) !== undefined)
    .optional(),
});

/** The query as the reader needs it: the period resolved against the clock, the limit defaulted, the cursor decoded. */
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
 * The schema of the query with the cross-field rules, resolved at `now`: the period defaults to the last 30 days, `from` must
 * not be after `to`, the period must not exceed 2 years. Every rule names the offending parameter (a JSON Pointer in the problem).
 */
export const resolveAuditQuery = (now: Date) =>
  auditQuerySchema.transform((query, context): AuditQuery => {
    const to = query.to === undefined ? now : new Date(query.to);
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
      cursor: query.cursor === undefined ? undefined : decodeCursor(query.cursor),
    };
  });
