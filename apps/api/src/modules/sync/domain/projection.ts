/**
 * The serializers of the pull (EVM-096 AC2; SR-SYNC-04, CWE-213): each builds the object of the contract field by field FROM A LIST - a field of a row that is not
 * named here cannot reach the phone, whatever the row contains. The tests check every page with `assertSyncProjectionStrict` of `@evia/contracts`.
 */
import type { SyncCustomerProjection } from '../../customers/system-ports.ts';
import type { SyncUserProjection } from '../../identity/system-ports.ts';
import type { SyncMediaAssetProjection } from '../../media/system-ports.ts';
import type { SyncPartyProjection } from '../../parties/system-ports.ts';
import type { SyncProcedureStageProjection } from '../../procedures/system-ports.ts';
import type { SyncSiteProjection } from '../../sites/system-ports.ts';
import type { SyncTimelineEntryProjection } from '../../timeline/system-ports.ts';
import type { SyncScopeItemProjection, SyncWorkOrderProjection } from '../../work-orders/system-ports.ts';

export const SYNC_ENTITY_TYPES = [
  'work_order',
  'customer',
  'site',
  'party',
  'scope_item',
  'procedure_stage',
  'timeline_entry',
  'media_asset',
  'user',
] as const;
export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number];

export interface SyncUpsertChange {
  readonly op: 'upsert';
  readonly entity: { readonly type: SyncEntityType; readonly id: string; readonly version: number } & Readonly<Record<string, unknown>>;
}
export interface SyncDeleteChange {
  readonly op: 'delete';
  readonly type: SyncEntityType;
  readonly id: string;
  /** The version at the soft delete (the lower bound for a later upsert in the guard of the client); absent after a purge. */
  readonly version?: number;
}
export type SyncChange = SyncUpsertChange | SyncDeleteChange;

export const workOrderChange = (row: SyncWorkOrderProjection): SyncUpsertChange => ({
  op: 'upsert',
  entity: {
    type: 'work_order',
    id: row.id,
    version: row.version,
    number: row.number,
    title: row.title,
    status: row.status,
    customerId: row.customerId,
    siteId: row.siteId,
    coordinatorUserId: row.coordinatorUserId,
    description: row.description,
    plannedDate: row.plannedDate,
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt === null ? null : row.closedAt.toISOString(),
    // EVM-135 (ADR-0024): the object of an open site survey, `null` for an ordinary order; additive - an older app drops it
    siteSurvey:
      row.siteSurveyExpiresAt === null
        ? null
        : {
            expiresAt: row.siteSurveyExpiresAt.toISOString(),
            extensionCount: row.siteSurveyExtensions,
            requesterPhone: row.requesterPhone,
          },
  },
});

export const customerChange = (row: SyncCustomerProjection): SyncUpsertChange => ({
  op: 'upsert',
  entity: { type: 'customer', id: row.id, version: row.version, kind: row.kind, displayName: row.displayName, phone: row.phone },
});

export const siteChange = (row: SyncSiteProjection): SyncUpsertChange => ({
  op: 'upsert',
  entity: {
    type: 'site',
    id: row.id,
    version: row.version,
    siteType: row.siteType,
    street: row.street,
    buildingNumber: row.buildingNumber,
    apartmentNumber: row.apartmentNumber,
    postalCode: row.postalCode,
    city: row.city,
    parkingSpotNumber: row.parkingSpotNumber,
    garageLevel: row.garageLevel,
    connectionPowerKw: row.connectionPowerKw,
    managerPartyId: row.managerPartyId,
    distributionSystemOperatorPartyId: row.distributionSystemOperatorPartyId,
    notes: row.notes,
  },
});

export const partyChange = (row: SyncPartyProjection): SyncUpsertChange => ({
  op: 'upsert',
  entity: {
    type: 'party',
    id: row.id,
    version: row.version,
    kind: row.kind,
    displayName: row.displayName,
    contactPersonName: row.contactPersonName,
    phone: row.phone,
  },
});

export const scopeItemChange = (row: SyncScopeItemProjection): SyncUpsertChange => ({
  op: 'upsert',
  entity: {
    type: 'scope_item',
    id: row.id,
    version: row.version,
    workOrderId: row.workOrderId,
    position: row.position,
    code: row.code,
    name: row.name,
    parameterSetCode: row.parameterSetCode,
    parameters: row.parameters,
    quantity: row.quantity,
    notes: row.notes,
  },
});

export const procedureStageChange = (row: SyncProcedureStageProjection): SyncUpsertChange => ({
  op: 'upsert',
  entity: {
    type: 'procedure_stage',
    id: row.id,
    version: row.version,
    workOrderId: row.workOrderId,
    procedureId: row.procedureId,
    procedureCode: row.procedureCode,
    procedureName: row.procedureName,
    code: row.code,
    name: row.name,
    position: row.position,
    status: row.status,
    dueDate: row.dueDate,
    responsibleUserId: row.responsibleUserId,
    waitingOn: row.waitingOn,
    waitingPartyId: row.waitingPartyId,
    waitingSince: row.waitingSince,
    blockedReason: row.blockedReason,
    startedAt: row.startedAt === null ? null : row.startedAt.toISOString(),
    completedOn: row.completedOn,
  },
});

export const timelineEntryChange = (row: SyncTimelineEntryProjection): SyncUpsertChange => ({
  op: 'upsert',
  entity: {
    type: 'timeline_entry',
    id: row.id,
    version: row.version,
    workOrderId: row.workOrderId,
    kind: row.kind,
    noteCategory: row.noteCategory,
    body: row.body,
    procedureStageId: row.procedureStageId,
    authorUserId: row.authorUserId,
    createdAt: row.createdAt.toISOString(),
    origin: row.origin,
    capturedAt: row.capturedAt === null ? null : row.capturedAt.toISOString(),
    supersedesEntryId: row.supersedesEntryId,
    supersededByEntryId: row.supersededByEntryId,
    redactedAt: row.redactedAt === null ? null : row.redactedAt.toISOString(),
  },
});

/**
 * The medium for the phone (EVM-131 AC4; SR-MOB-10): the identifiers, the type, the category, the stage, the state of the file and its reason. The fields of the contract that are
 * not part of the minimal payload (`description`, `capturedAt`, the sizes) are sent as `null` - the phone keeps its own values; never a name, a key, an address or a detail of a quarantine.
 */
export const mediaAssetChange = (row: SyncMediaAssetProjection): SyncUpsertChange => ({
  op: 'upsert',
  entity: {
    type: 'media_asset',
    id: row.id,
    version: row.version,
    workOrderId: row.workOrderId,
    mediaType: row.mediaType,
    category: row.category,
    description: null,
    procedureStageId: row.procedureStageId,
    capturedAt: null,
    fileState: row.fileState,
    fileStateReasonCode: row.fileStateReasonCode,
    sizeBytes: null,
    durationSeconds: null,
    widthPx: null,
    heightPx: null,
  },
});

export const userChange = (row: SyncUserProjection): SyncUpsertChange => ({
  op: 'upsert',
  entity: { type: 'user', id: row.id, version: row.version, displayName: row.displayName },
});

export const deleteChange = (type: SyncEntityType, id: string, version?: number): SyncChange =>
  version === undefined ? { op: 'delete', type, id } : { op: 'delete', type, id, version };

/** The bytes a change takes in the answer (the comma between elements included); the page closes before the budget is exceeded. */
export const changeBytes = (change: SyncChange): number => Buffer.byteLength(JSON.stringify(change), 'utf8') + 1;
