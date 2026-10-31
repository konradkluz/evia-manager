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
import { workOrderOfAsset } from '../infrastructure/media-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';

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
  mediaAssetId: string,
  codes: Pick<MediaAuditEvent, 'fromCode' | 'toCode'> = {},
): Promise<void> {
  const event: MediaAuditEvent = {
    type,
    actor: { type: 'system' },
    outcome: 'success',
    objectType: 'media_asset',
    objectId: mediaAssetId,
    ...codes,
  };
  await events.publish(tx, event, { origin: 'cli', traceId: newTraceId() });
}

export async function raiseQuarantineAlert(
  deps: QuarantineAlertDependencies,
  tx: Kysely<Database>,
  mediaAssetId: string,
  at: Date,
): Promise<void> {
  await publishMediaEvent(deps.events, tx, 'media_file.quarantined', mediaAssetId);
  const workOrderId = await workOrderOfAsset(mediaTables(tx), mediaAssetId);
  if (workOrderId !== undefined) {
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
