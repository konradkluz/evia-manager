/**
 * The first entry of a file into quarantine, whoever puts it there (the scan: EVM-049 AC2; the structural check of a video: EVM-046 AC2): the audit event,
 * one e-mail per active Administrator and a security alert (SR-FILE-05, SR-LOG-03, SR-LOG-07). It runs INSIDE the transaction of the transition, so the
 * state and its three consequences stand or fall together. The payload carries no file name and no personal data.
 */
import type { Kysely } from 'kysely';
import { enqueueSecurityAlert } from '../../../platform/alerts/security-alerts.ts';
import type { Database } from '../../../platform/database/database.ts';
import { enqueueEmailOnce } from '../../../platform/email/email-outbox.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import { newTraceId } from '../../../platform/http/request-context.ts';
import type { MediaAuditEvent } from '../events.ts';
import { workOrderOfDocument, workOrderOfDocumentVersion } from '../infrastructure/document-store.ts';
import { workOrderOfAsset, type StoredFileRow } from '../infrastructure/media-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';

/**
 * The object an audit event of a file is about: the medium, or - for the file of a document (EVM-047) - the document. The same events, the same alert and
 * the same e-mails for both; the payload is the identifier and the codes only.
 */
export interface EventOwner {
  readonly objectType: 'media_asset' | 'document';
  readonly objectId: string;
}

export const mediaOwner = (mediaAssetId: string): EventOwner => ({ objectType: 'media_asset', objectId: mediaAssetId });

/** The owner of a file for the events; `undefined` for a file nobody owns (it cannot happen: the CHECK of the table wants exactly one owner). */
export async function eventOwnerOfFile(
  tx: Kysely<Database>,
  file: Pick<StoredFileRow, 'media_asset_id' | 'document_version_id'>,
): Promise<EventOwner | undefined> {
  if (file.media_asset_id !== null) return mediaOwner(file.media_asset_id);
  if (file.document_version_id === null) return undefined;
  const found = await workOrderOfDocumentVersion(mediaTables(tx), file.document_version_id);
  return found === undefined ? undefined : { objectType: 'document', objectId: found.documentId };
}

async function workOrderOfOwner(tx: Kysely<Database>, owner: EventOwner): Promise<string | null | undefined> {
  const tables = mediaTables(tx);
  return owner.objectType === 'media_asset' ? workOrderOfAsset(tables, owner.objectId) : workOrderOfDocument(tables, owner.objectId);
}

export interface QuarantineAlertDependencies {
  readonly events: EventBus;
  /** The identifiers of the active Administrators (the facade of `identity`). */
  readonly administrators: (tx: Kysely<Database>) => Promise<string[]>;
}

/** Publishes an audit event of the system about a medium (no actor, no personal data). */
export async function publishMediaEvent(
  events: EventBus,
  tx: Kysely<Database>,
  type: MediaAuditEvent['type'],
  owner: EventOwner,
  codes: Pick<MediaAuditEvent, 'fromCode' | 'toCode'> = {},
): Promise<void> {
  const event: MediaAuditEvent = {
    type,
    actor: { type: 'system' },
    outcome: 'success',
    objectType: owner.objectType,
    objectId: owner.objectId,
    ...codes,
  };
  await events.publish(tx, event, { origin: 'cli', traceId: newTraceId() });
}

export async function raiseQuarantineAlert(
  deps: QuarantineAlertDependencies,
  tx: Kysely<Database>,
  owner: EventOwner,
  at: Date,
): Promise<void> {
  await publishMediaEvent(deps.events, tx, 'media_file.quarantined', owner);
  const workOrderId = await workOrderOfOwner(tx, owner);
  if (workOrderId !== undefined && workOrderId !== null) {
    for (const recipientUserId of await deps.administrators(tx)) {
      await enqueueEmailOnce(tx, {
        kind: 'administrator_alert',
        variant: 'administrator_media_quarantined',
        recipientUserId,
        subjectId: workOrderId,
        now: at,
      });
    }
  }
  await enqueueSecurityAlert(tx, { code: 'media_quarantined', occurredAt: at, traceId: newTraceId() });
}
