/** Writes audit records (INSERT only — the role of the application has nothing else on the schema, AC7). */
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { AuditRecord } from '../domain/audit-record.ts';

export type AuditTables = {
  'audit.events': {
    id: string | undefined;
    occurred_at: Date;
    actor_type: AuditRecord['actorType'];
    actor_user_id: string | null;
    session_id: string | null;
    ip_prefix: string | null;
    origin: AuditRecord['origin'];
    action: string;
    outcome: AuditRecord['outcome'];
    reason_code: string | null;
    object_type: string;
    object_id: string | null;
    trace_id: string;
  };
};

export async function insertAuditRecord(tx: Kysely<Database>, record: AuditRecord): Promise<void> {
  const db = tx.$extendTables<AuditTables>();
  await db
    .insertInto('audit.events')
    .values({
      occurred_at: record.occurredAt,
      actor_type: record.actorType,
      actor_user_id: record.actorUserId,
      session_id: record.sessionId,
      ip_prefix: record.ipPrefix,
      origin: record.origin,
      action: record.action,
      outcome: record.outcome,
      reason_code: record.reasonCode,
      object_type: record.objectType,
      object_id: record.objectId,
      trace_id: record.traceId,
    })
    .execute();
}
