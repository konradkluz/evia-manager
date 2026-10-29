/**
 * The serializers of the pull (EVM-096 AC2; SR-SYNC-04, CWE-213): each builds the object of the contract field by field FROM A LIST - a field of a row that is not
 * named here cannot reach the phone, whatever the row contains. The tests check every page with `assertSyncProjectionStrict` of `@evia/contracts`.
 */
import type { SyncCustomerProjection } from '../../customers/system-ports.ts';
import type { SyncSiteProjection } from '../../sites/system-ports.ts';
import type { SyncWorkOrderProjection } from '../../work-orders/system-ports.ts';

export type SyncEntityType = 'work_order' | 'customer' | 'site';

export interface SyncUpsertChange {
  readonly op: 'upsert';
  readonly entity: { readonly type: SyncEntityType; readonly id: string; readonly version: number } & Readonly<Record<string, unknown>>;
}
export interface SyncDeleteChange {
  readonly op: 'delete';
  readonly type: SyncEntityType;
  readonly id: string;
}
export type SyncChange = SyncUpsertChange | SyncDeleteChange;

export const workOrderChange = (row: SyncWorkOrderProjection): SyncChange => ({
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
  },
});

export const customerChange = (row: SyncCustomerProjection): SyncChange => ({
  op: 'upsert',
  entity: { type: 'customer', id: row.id, version: row.version, kind: row.kind, displayName: row.displayName, phone: row.phone },
});

export const siteChange = (row: SyncSiteProjection): SyncChange => ({
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

export const deleteChange = (type: SyncEntityType, id: string): SyncChange => ({ op: 'delete', type, id });

/** The bytes a change takes in the answer (the comma between elements included); the page closes before the budget is exceeded. */
export const changeBytes = (change: SyncChange): number => Buffer.byteLength(JSON.stringify(change), 'utf8') + 1;
