/** Writes audit records (INSERT only — the role of the application has nothing else on the schema, AC7). */
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { AuditRecord } from '../domain/audit-record.ts';
import { auditTables } from './tables.ts';

export async function insertAuditRecord(tx: Kysely<Database>, record: AuditRecord): Promise<void> {
  await auditTables(tx)
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
