/**
 * Reading of synchronisation changes by the phone (EVM-090 AC3).
 *
 * `SyncEntity` is an open envelope (forward compatibility, ADR-0004), so the generated `zSyncChangesResponse` only validates `type`,
 * `id` and `version` and Zod strips every other key: an entity must NEVER be read through it.
 *
 * - `parseSyncChange` is the CLIENT reader and is TOLERANT: a known `type` keeps the projection fields it knows and drops the ones it
 *   does not (a field added by a newer server is a non-breaking change and must not open a silent, permanent gap on an old phone).
 *   An unknown `type` is `unknown`: skipped, counted, the cursor advances (a new type bumps `scopeRuleVersion`, so the phone resyncs).
 *   A malformed change, or a known type that does not match its projection, is `invalid` with `resync: true`: the phone must NOT skip
 *   it silently but schedule a resync; the telemetry carries only `reason` and the (vocabulary) `type`, never the payload.
 * - `assertSyncProjectionStrict` is the SERVER-side check (tests of the sync endpoints): zero extra fields, so the server cannot leak
 *   data (data minimisation for private phones, security M2). `SYNC_PROJECTIONS_STRICT` is its schema map.
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

/** Entity type → tolerant projection schema (unknown keys are stripped); the single source of truth for the phone. */
export const SYNC_PROJECTIONS = {
  work_order: zSyncWorkOrder,
  customer: zSyncCustomer,
  site: zSyncSite,
  party: zSyncParty,
  scope_item: zSyncScopeItem,
  procedure_stage: zSyncProcedureStage,
  timeline_entry: zSyncTimelineEntry,
  media_asset: zSyncMediaAsset,
  user: zSyncUser,
} as const;

/** The same projections, STRICT: any field outside the list is an error (server-side leak check). */
export const SYNC_PROJECTIONS_STRICT = {
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
  /** Malformed change or a known type that does not match its projection: never store, never skip silently — schedule a resync. */
  | {
      readonly kind: 'invalid';
      readonly resync: true;
      readonly reason: 'malformed' | 'projection_mismatch';
      /** Known (vocabulary) entity type, only for `projection_mismatch`; the payload is never reported. */
      readonly type?: SyncProjectionType;
    };

const MALFORMED = { kind: 'invalid', resync: true, reason: 'malformed' } as const;

const envelope = z.looseObject({ op: z.enum(['upsert', 'delete']), type: z.string().max(64).optional(), entity: z.unknown().optional() });
const entityEnvelope = z.looseObject({ type: z.string().max(64), id: z.string().max(64), version: z.int().gte(1) });
const deleteEnvelope = z.looseObject({ type: z.string().max(64), id: z.string().max(64) });

const isProjectionType = (type: string): type is SyncProjectionType => Object.hasOwn(SYNC_PROJECTIONS, type);

/** Parses ONE element of `SyncChangesPage.changes`; the page itself is never rejected because of one element. */
export function parseSyncChange(raw: unknown): ParsedSyncChange {
  const head = envelope.safeParse(raw);
  if (!head.success) return MALFORMED;
  if (head.data.op === 'delete') {
    const target = deleteEnvelope.safeParse(raw);
    if (!target.success) return MALFORMED;
    const { type, id } = target.data;
    return isProjectionType(type) ? { kind: 'delete', type, id } : { kind: 'unknown', type, id };
  }
  const base = entityEnvelope.safeParse(head.data.entity);
  if (!base.success) return MALFORMED;
  const { type, id } = base.data;
  if (!isProjectionType(type)) return { kind: 'unknown', type, id };
  const entity = SYNC_PROJECTIONS[type].safeParse(base.data);
  return entity.success ? { kind: 'upsert', entity: entity.data } : { kind: 'invalid', resync: true, reason: 'projection_mismatch', type };
}

export type StrictProjectionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'unknown_type' | 'invalid_shape' }
  /** Names of the fields outside the projection (never their values). */
  | { readonly ok: false; readonly reason: 'extra_fields'; readonly fields: readonly string[] };

const strictDelete = z.strictObject({ op: z.literal('delete'), type: z.string().max(64), id: z.string().max(64) });

function strictResult(schema: z.ZodType, value: unknown): StrictProjectionResult {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true };
  const fields = result.error.issues.flatMap((issue) => (issue.code === 'unrecognized_keys' ? issue.keys : []));
  return fields.length > 0
    ? { ok: false, reason: 'extra_fields', fields: [...new Set(fields)].sort() }
    : { ok: false, reason: 'invalid_shape' };
}

/** Server-side check of ONE change: only known types, only the fields of the projection (extra fields are reported by name). */
export function assertSyncProjectionStrict(raw: unknown): StrictProjectionResult {
  const head = envelope.safeParse(raw);
  if (!head.success) return { ok: false, reason: 'invalid_shape' };
  if (head.data.op === 'delete') {
    const target = deleteEnvelope.safeParse(raw);
    if (!target.success) return { ok: false, reason: 'invalid_shape' };
    return isProjectionType(target.data.type) ? strictResult(strictDelete, raw) : { ok: false, reason: 'unknown_type' };
  }
  const base = entityEnvelope.safeParse(head.data.entity);
  if (!base.success) return { ok: false, reason: 'invalid_shape' };
  const { type } = base.data;
  if (!isProjectionType(type)) return { ok: false, reason: 'unknown_type' };
  return strictResult(SYNC_PROJECTIONS_STRICT[type], head.data.entity);
}
