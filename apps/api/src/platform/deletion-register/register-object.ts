/**
 * The object of one record (EVM-040 AC3; SR-PRIV-04, SR-LOG-03): the key and the JSON body, made by the server. Pure.
 * - the key is `<yyyy>/<operationId>.json` - the year of the instant in UTC, the identifier a UUIDv7 made here (time-ordered, so a replay
 *   reads the records in the order they were written); nothing in the key comes from a request;
 * - the body holds `schemaVersion`, `operationId`, `operationCode`, `subjectType`, `subjectId`, `workOrderId` (when the subject has an order),
 *   `actorUserId` and `occurredAt` (UTC) - and nothing else: no text, no name, no e-mail. The actor is a pseudonymous identifier; the replay
 *   needs it because the redaction carries `redacted_by`.
 */
import { randomBytes } from 'node:crypto';
import type { DeletionRecord } from './deletion-register.ts';

export const REGISTER_SCHEMA_VERSION = 1;

/** A UUIDv7 (RFC 9562) of the given instant with random bits from the CSPRNG. */
export function newOperationId(at: Date): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(at.getTime(), 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface RegisterObject {
  readonly operationId: string;
  readonly key: string;
  readonly body: string;
}

export function registerObjectOf(record: DeletionRecord, at: Date): RegisterObject {
  const operationId = newOperationId(at);
  const content = {
    schemaVersion: REGISTER_SCHEMA_VERSION,
    operationId,
    operationCode: record.operationCode,
    subjectType: record.subjectType,
    subjectId: record.subjectId,
    ...(record.workOrderId === null ? {} : { workOrderId: record.workOrderId }),
    actorUserId: record.actorUserId,
    occurredAt: at.toISOString(),
  };
  return { operationId, key: `${at.getUTCFullYear()}/${operationId}.json`, body: JSON.stringify(content) };
}
