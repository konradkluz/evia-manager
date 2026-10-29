import { ANCHORED_TYPES, PROJECTIONS } from './pull-parse.ts';
import {
  entityKey,
  type EntityKey,
  type EntityType,
  type HydrationItem,
  type HydrationReason,
  type ParsedChange,
  type PendingObjects,
  type ReplicaEntity,
  type ReplicaOp,
  type SweepRule,
} from './pull-types.ts';

/**
 * Pure rules of the replica (EVM-092; ADR-0021 D1-D3). The adapter of the replica (SQLCipher, EVM-093) implements the cascade and
 * the sweep as set operations with the same semantics; the test double in `test/` uses these functions.
 */

export interface VersionInfo {
  readonly version: number;
  readonly deleted: boolean;
}
export type Versions = ReadonlyMap<EntityKey, VersionInfo>;

/** Static map parent -> children (children carry `workOrderId`): a delete of the parent removes them in the same operation. */
export const CASCADE_CHILDREN: Readonly<Record<EntityType, readonly EntityType[]>> = {
  work_order: ANCHORED_TYPES,
  customer: [],
  site: [],
  party: [],
  scope_item: [],
  procedure_stage: [],
  timeline_entry: [],
  media_asset: [],
  user: [],
};

/** Layers of reference resolution: a layer only points to earlier ones, so the result does not depend on the order in a page. */
const LAYERS: readonly (readonly EntityType[])[] = [
  ['user', 'party', 'customer'],
  ['site'],
  ['work_order'],
  ['procedure_stage'],
  ['timeline_entry', 'media_asset', 'scope_item'],
];

const refsOf = (entity: ReplicaEntity): { key: EntityKey; id: string }[] => {
  const out: { key: EntityKey; id: string }[] = [];
  const projection = PROJECTIONS[entity.type];
  for (const [name, spec] of Object.entries(projection)) {
    if (spec.k !== 'uuid' || spec.ref === undefined) continue;
    const value = entity.fields[name];
    if (typeof value === 'string') out.push({ key: entityKey(spec.ref, value), id: value });
  }
  return out;
};

const anchorOf = (entity: ReplicaEntity): string | undefined => {
  const value = entity.fields['workOrderId'];
  return typeof value === 'string' ? value : undefined;
};

/** Keys whose versions must be read before a page is planned: the changes themselves, their references and their anchors. */
export function collectKeys(changes: readonly ParsedChange[]): EntityKey[] {
  const keys = new Set<EntityKey>();
  for (const change of changes) {
    if (change.kind === 'delete') keys.add(entityKey(change.type, change.id));
    else if (change.kind === 'upsert') {
      keys.add(entityKey(change.entity.type, change.entity.id));
      for (const ref of refsOf(change.entity)) keys.add(ref.key);
      const anchor = anchorOf(change.entity);
      if (anchor !== undefined) keys.add(entityKey('work_order', anchor));
    }
  }
  return [...keys];
}

export interface PagePlan {
  readonly ops: readonly ReplicaOp[];
  readonly hydrationAdd: readonly HydrationItem[];
  readonly hydrationRemove: readonly string[];
  readonly skippedStale: number;
}

type Seq =
  | { readonly k: 'u'; readonly entity: ReplicaEntity }
  | { readonly k: 'd'; readonly type: EntityType; readonly id: string; readonly version: number };

/**
 * Plans a page of valid changes. The version guard never replaces a newer version with an older or equal one (also against a
 * tombstone), so duplicates and any order of pages give the same result. An upsert whose anchor or reference is unknown locally is
 * NOT applied and puts its work order on the hydration list (never an incomplete skeleton); a delete of a pending object is skipped.
 */
export async function planPage(input: {
  readonly changes: readonly ParsedChange[];
  readonly versions: Versions;
  readonly pending: PendingObjects;
  readonly lookupSites: (siteIds: readonly string[]) => Promise<ReadonlyMap<string, readonly string[]>>;
}): Promise<PagePlan> {
  const state = new Map<EntityKey, VersionInfo>(input.versions);
  const seq: Seq[] = [];
  const winners = new Map<EntityKey, ReplicaEntity>();
  const hydrationRemove = new Set<string>();
  let skippedStale = 0;
  for (const change of input.changes) {
    if (change.kind === 'upsert') {
      const key = entityKey(change.entity.type, change.entity.id);
      const known = state.get(key);
      if (known !== undefined && change.entity.version <= known.version) {
        skippedStale += 1;
        continue;
      }
      state.set(key, { version: change.entity.version, deleted: false });
      winners.set(key, change.entity);
      seq.push({ k: 'u', entity: change.entity });
    } else if (change.kind === 'delete') {
      if (input.pending.objectIds.has(change.id)) continue;
      const key = entityKey(change.type, change.id);
      const known = state.get(key);
      if (known !== undefined && !known.deleted && change.version !== undefined && change.version < known.version) {
        skippedStale += 1;
        continue;
      }
      const version = Math.max(change.version ?? 0, known?.version ?? 0);
      state.set(key, { version, deleted: true });
      winners.delete(key);
      seq.push({ k: 'd', type: change.type, id: change.id, version });
      if (change.type === 'work_order') hydrationRemove.add(change.id);
    }
  }

  const deferred = new Set<EntityKey>();
  const hydration = new Map<string, HydrationReason>();
  const addHydration = (id: string, reason: HydrationReason): void => {
    if (!hydration.has(id)) hydration.set(id, reason);
  };
  const exists = (key: EntityKey): boolean => {
    const info = state.get(key);
    return info !== undefined && !info.deleted && !deferred.has(key);
  };
  const sitesToLookup: string[] = [];
  for (const layer of LAYERS) {
    for (const [key, entity] of winners) {
      if (!layer.includes(entity.type)) continue;
      const anchor = anchorOf(entity);
      let reason: HydrationReason | undefined;
      if (anchor !== undefined) {
        const anchorKey = entityKey('work_order', anchor);
        if (state.get(anchorKey)?.deleted === true) {
          deferred.add(key);
          continue;
        }
        if (!exists(anchorKey)) reason = deferred.has(anchorKey) ? 'missing_reference' : 'unknown_anchor';
      }
      if (reason === undefined && refsOf(entity).some((ref) => !exists(ref.key))) reason = 'missing_reference';
      if (reason === undefined) continue;
      deferred.add(key);
      if (entity.type === 'work_order') addHydration(entity.id, reason);
      else if (anchor !== undefined) addHydration(anchor, reason);
      else if (entity.type === 'site') sitesToLookup.push(entity.id);
    }
  }
  if (sitesToLookup.length > 0) {
    const found = await input.lookupSites(sitesToLookup);
    for (const ids of found.values()) for (const id of ids) addHydration(id, 'missing_reference');
  }

  const ops: ReplicaOp[] = [];
  for (const item of seq) {
    if (item.k === 'd') ops.push({ op: 'delete', type: item.type, id: item.id, version: item.version });
    else {
      const key = entityKey(item.entity.type, item.entity.id);
      if (winners.get(key) === item.entity && !deferred.has(key)) ops.push({ op: 'upsert', entity: item.entity });
    }
  }
  for (const id of hydration.keys()) hydrationRemove.delete(id);
  return {
    ops,
    hydrationAdd: [...hydration].map(([workOrderId, reason]) => ({ workOrderId, reason })),
    hydrationRemove: [...hydrationRemove],
    skippedStale,
  };
}

/** Keys to read before a snapshot is planned. */
export function snapshotKeys(entities: readonly ReplicaEntity[]): EntityKey[] {
  return entities.map((e) => entityKey(e.type, e.id));
}

export type SnapshotPlan = { readonly ok: true; readonly ops: readonly ReplicaOp[] } | { readonly ok: false };

/**
 * A snapshot is authoritative for the requested aggregate but only additive: it contains the work order itself, every anchored
 * entity points to it (another anchor = invalid, CWE-639), and the version guard decides per object. References are not re-checked
 * (the snapshot is the way to complete them).
 */
export function planSnapshot(input: {
  readonly requestedId: string;
  readonly entities: readonly ReplicaEntity[];
  readonly versions: Versions;
}): SnapshotPlan {
  let hasOrder = false;
  const best = new Map<EntityKey, ReplicaEntity>();
  for (const entity of input.entities) {
    if (entity.type === 'work_order' && entity.id === input.requestedId) hasOrder = true;
    const anchor = anchorOf(entity);
    if (anchor !== undefined && anchor !== input.requestedId) return { ok: false };
    const key = entityKey(entity.type, entity.id);
    const current = best.get(key);
    if (current === undefined || entity.version > current.version) best.set(key, entity);
  }
  if (!hasOrder) return { ok: false };
  const ops: ReplicaOp[] = [];
  for (const [key, entity] of best) {
    const known = input.versions.get(key);
    if (known === undefined || entity.version > known.version) ops.push({ op: 'upsert', entity });
  }
  return { ok: true, ops };
}

const DAY_MS = 86_400_000;
export const closedBefore = (serverNow: number, days: number): number => serverNow - days * DAY_MS;

export interface SweepPlan {
  readonly removeKeys: readonly EntityKey[];
  readonly removedWorkOrders: number;
  readonly removedOrphans: number;
}

/**
 * Time rule (closed work orders older than N days, by server time) and orphan rule (customer, site, party and user that no
 * remaining work order, child or kept pending object points to). Work orders kept for pending mutations are not removed by the time
 * rule; losing access is a different path (the whole replica is removed).
 */
export function planSweep(
  entities: Iterable<ReplicaEntity>,
  rule: Pick<SweepRule, 'closedBefore' | 'keepWorkOrderIds' | 'keepReferencedIds'>,
): SweepPlan {
  const all = [...entities];
  const keepOrders = new Set(rule.keepWorkOrderIds);
  const removeOrderIds = new Set<string>();
  for (const e of all) {
    if (e.type !== 'work_order' || keepOrders.has(e.id)) continue;
    const status = e.fields['status'];
    const closedAt = e.fields['closedAt'];
    if ((status === 'settled' || status === 'cancelled') && typeof closedAt === 'string') {
      const at = Date.parse(closedAt);
      if (Number.isFinite(at) && at < rule.closedBefore) removeOrderIds.add(e.id);
    }
  }
  const remove = new Set<EntityKey>();
  const remaining: ReplicaEntity[] = [];
  for (const e of all) {
    const anchor = e.type === 'work_order' ? e.id : anchorOf(e);
    if (anchor !== undefined && removeOrderIds.has(anchor)) remove.add(entityKey(e.type, e.id));
    else remaining.push(e);
  }
  const reachable = new Set<string>(rule.keepReferencedIds);
  for (const e of remaining)
    if (e.type !== 'customer' && e.type !== 'site' && e.type !== 'party' && e.type !== 'user')
      for (const r of refsOf(e)) reachable.add(r.id);
  for (const e of remaining) if (e.type === 'site' && reachable.has(e.id)) for (const r of refsOf(e)) reachable.add(r.id);
  let removedOrphans = 0;
  for (const e of remaining) {
    if ((e.type === 'customer' || e.type === 'site' || e.type === 'party' || e.type === 'user') && !reachable.has(e.id)) {
      remove.add(entityKey(e.type, e.id));
      removedOrphans += 1;
    }
  }
  return { removeKeys: [...remove], removedWorkOrders: removeOrderIds.size, removedOrphans };
}
