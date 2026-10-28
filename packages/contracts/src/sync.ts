/**
 * Reading of synchronisation changes by the phone (EVM-090 AC3).
 *
 * `SyncEntity` is an open envelope (forward compatibility, ADR-0004), so the generated `zSyncChangesResponse` only validates `type`,
 * `id` and `version` and Zod strips every other key: an entity must NEVER be read through it. `parseSyncChange` is the one reader:
 * a known `type` is validated STRICTLY against its projection (an extra field such as a customer e-mail rejects the change,
 * data minimisation for private phones), an unknown `type` is reported as `unknown` and skipped without failing the page.
 * The type → projection map mirrors `x-evia-sync-projections` of `SyncEntity` (a test keeps them equal).
 */
import * as z from 'zod';
import {
  zSyncCustomer,
  zSyncMediaAsset,
  zSyncParty,
  zSyncProcedureStage,
  zSyncScopeItem,
  zSyncSite,
  zSyncTimelineEntry,
  zSyncUser,
  zSyncWorkOrder,
} from '../generated/zod.gen.ts';

const strict = <Shape extends z.core.$ZodShape>(schema: z.ZodObject<Shape>) => z.strictObject(schema.shape);

/** Entity type → strict projection schema; the single source of truth for what a phone may receive. */
export const SYNC_PROJECTIONS = {
  work_order: strict(zSyncWorkOrder),
  customer: strict(zSyncCustomer),
  site: strict(zSyncSite),
  party: strict(zSyncParty),
  scope_item: strict(zSyncScopeItem),
  procedure_stage: strict(zSyncProcedureStage),
  timeline_entry: strict(zSyncTimelineEntry),
  media_asset: strict(zSyncMediaAsset),
  user: strict(zSyncUser),
} as const;

export type SyncProjectionType = keyof typeof SYNC_PROJECTIONS;
export type SyncProjection = { [K in SyncProjectionType]: z.infer<(typeof SYNC_PROJECTIONS)[K]> }[SyncProjectionType];

export type ParsedSyncChange =
  | { readonly kind: 'upsert'; readonly entity: SyncProjection }
  | { readonly kind: 'delete'; readonly type: SyncProjectionType; readonly id: string }
  /** A type this app version does not know: skip, count in telemetry, advance the cursor. */
  | { readonly kind: 'unknown'; readonly type: string; readonly id: string }
  /** Malformed change or a known type that does not match its projection: skip and count; never store. */
  | { readonly kind: 'invalid' };

const envelope = z.looseObject({ op: z.enum(['upsert', 'delete']), type: z.string().max(64).optional(), entity: z.unknown().optional() });
const entityEnvelope = z.looseObject({ type: z.string().max(64), id: z.string().max(64), version: z.int().gte(1) });
const deleteEnvelope = z.looseObject({ type: z.string().max(64), id: z.string().max(64) });

const isProjectionType = (type: string): type is SyncProjectionType => Object.hasOwn(SYNC_PROJECTIONS, type);

/** Parses ONE element of `SyncChangesPage.changes`; the page itself is never rejected because of one element. */
export function parseSyncChange(raw: unknown): ParsedSyncChange {
  const head = envelope.safeParse(raw);
  if (!head.success) return { kind: 'invalid' };
  if (head.data.op === 'delete') {
    const target = deleteEnvelope.safeParse(raw);
    if (!target.success) return { kind: 'invalid' };
    const { type, id } = target.data;
    return isProjectionType(type) ? { kind: 'delete', type, id } : { kind: 'unknown', type, id };
  }
  const base = entityEnvelope.safeParse(head.data.entity);
  if (!base.success) return { kind: 'invalid' };
  const { type, id } = base.data;
  if (!isProjectionType(type)) return { kind: 'unknown', type, id };
  const entity = SYNC_PROJECTIONS[type].safeParse(base.data);
  return entity.success ? { kind: 'upsert', entity: entity.data } : { kind: 'invalid' };
}
