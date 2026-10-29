import { planSweep, type ApplyPageInput, type EntityKey, type ReplicaEntity, type ReplicaStore } from '../src/index.ts';

/** The subset of matchers the suite uses; Vitest, Jest (jest-expo) and compatible runners satisfy it. */
export interface ConformanceMatchers {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeGreaterThan(expected: number): void;
  toBeNull(): void;
  readonly not: { toBeNull(): void };
}

/** Test API injected by the caller, so this file does not depend on any runner (Vitest here, Jest in apps/mobile). */
export interface ConformanceTestApi {
  readonly describe: (name: string, body: () => void) => void;
  readonly it: (name: string, body: () => void | Promise<void>) => void;
  readonly expect: (actual: unknown) => ConformanceMatchers;
}

/**
 * Executable contract of `ReplicaStore` (EVM-092). It runs on the reference fake in this package and MUST run on every production
 * adapter (SQLCipher, EVM-093): the semantics below are the ones the pull engine relies on. Only the port is used - no internals.
 * `create` returns a store on an EMPTY replica.
 */
export interface ReplicaConformanceOptions {
  readonly create: () => ReplicaStore | Promise<ReplicaStore>;
  readonly test: ConformanceTestApi;
}

const WO = '10000000-0000-4000-8000-000000000001';
const WO2 = '10000000-0000-4000-8000-000000000002';
const SCOPE = '50000000-0000-4000-8000-000000000001';
const USER = '90000000-0000-4000-8000-0000000000aa';
const CURSOR = 'cursor-000000000001';

const workOrder = (id: string, version: number, siteId: string | null = null): ReplicaEntity => ({
  type: 'work_order',
  id,
  version,
  fields: { siteId },
});
const scopeItem = (id: string, workOrderId: string, version = 1): ReplicaEntity => ({
  type: 'scope_item',
  id,
  version,
  fields: { workOrderId },
});
const key = (e: Pick<ReplicaEntity, 'type' | 'id'>): EntityKey => `${e.type}:${e.id}`;

const page = (generation: number, patch: Partial<ApplyPageInput> = {}): ApplyPageInput => ({
  generation,
  ownerUserId: USER,
  ops: [],
  cursor: CURSOR,
  phase: 'changes',
  complete: false,
  serverTime: 1_000,
  hydrationAdd: [],
  hydrationRemove: [],
  ...patch,
});

const CUSTOMER = '20000000-0000-4000-8000-000000000001';
const CUSTOMER2 = '20000000-0000-4000-8000-000000000002';
const OLD_CLOSED = '2026-01-01T00:00:00Z';
const CLOSED_BEFORE = Date.UTC(2026, 5, 1);

const closedOrder = (id: string, status: string, closedAt: string | null, customerId: string | null = null): ReplicaEntity => ({
  type: 'work_order',
  id,
  version: 1,
  fields: { status, closedAt, customerId, siteId: null },
});
const customer = (id: string): ReplicaEntity => ({ type: 'customer', id, version: 1, fields: {} });
const upserts = (entities: readonly ReplicaEntity[]): ApplyPageInput['ops'] => entities.map((entity) => ({ op: 'upsert', entity }));

export function replicaStoreConformance(options: ReplicaConformanceOptions): void {
  const { describe, it, expect } = options.test;
  const fresh = async (): Promise<{ store: ReplicaStore; active: number }> => {
    const store = await options.create();
    return { store, active: (await store.loadState()).active.generation };
  };

  describe('ReplicaStore conformance (EVM-092)', () => {
    it('EVM-092 AC1: a write to a generation that does not exist is stale and stores nothing', async () => {
      const { store, active } = await fresh();
      expect(await store.applyPage(page(active + 100, { ops: [{ op: 'upsert', entity: workOrder(WO, 1) }] }))).toBe('stale');
      expect(await store.applySnapshot({ generation: active + 100, ownerUserId: USER, ops: [], serverTime: 1, hydrationRemove: [] })).toBe(
        'stale',
      );
      const state = await store.loadState();
      expect(state.hasData).toBe(false);
      expect(state.ownerUserId).toBeNull();
    });

    it('EVM-092 AC4: generation numbers are never reused, so a response fetched before a wipe cannot be applied after it', async () => {
      const { store, active } = await fresh();
      await store.applyPage(page(active, { ops: [{ op: 'upsert', entity: workOrder(WO, 1) }] }));
      await store.wipeReplica();
      const after = await store.loadState();
      expect(after.active.generation).toBeGreaterThan(active);
      expect(after.hasData).toBe(false);
      expect(after.ownerUserId).toBeNull();
      expect(await store.applyPage(page(active, { ops: [{ op: 'upsert', entity: workOrder(WO, 1) }] }))).toBe('stale');
      expect((await store.readVersions(after.active.generation, [key(workOrder(WO, 1))])).size).toBe(0);
    });

    it('EVM-092 AC2: the version guard keeps the maximum, a delete marker keeps the maximum version and blocks older upserts', async () => {
      const { store, active } = await fresh();
      await store.applyPage(page(active, { ops: [{ op: 'upsert', entity: workOrder(WO, 5) }] }));
      await store.applyPage(page(active, { ops: [{ op: 'upsert', entity: workOrder(WO, 3) }] }));
      expect((await store.readVersions(active, [key(workOrder(WO, 1))])).get(key(workOrder(WO, 1)))).toEqual({
        version: 5,
        deleted: false,
      });
      await store.applyPage(page(active, { ops: [{ op: 'delete', type: 'work_order', id: WO, version: 4 }] }));
      expect((await store.readVersions(active, [key(workOrder(WO, 1))])).get(key(workOrder(WO, 1)))?.deleted).toBe(false);
      await store.applyPage(page(active, { ops: [{ op: 'delete', type: 'work_order', id: WO, version: 7 }] }));
      await store.applyPage(page(active, { ops: [{ op: 'upsert', entity: workOrder(WO, 6) }] }));
      expect((await store.readVersions(active, [key(workOrder(WO, 1))])).get(key(workOrder(WO, 1)))).toEqual({
        version: 7,
        deleted: true,
      });
      await store.applyPage(page(active, { ops: [{ op: 'upsert', entity: workOrder(WO, 8) }] }));
      expect((await store.readVersions(active, [key(workOrder(WO, 1))])).get(key(workOrder(WO, 1)))).toEqual({
        version: 8,
        deleted: false,
      });
    });

    it('EVM-092 AC2: deleting a work order removes its children in the same write (cascade)', async () => {
      const { store, active } = await fresh();
      await store.applyPage(
        page(active, {
          ops: [
            { op: 'upsert', entity: workOrder(WO, 1) },
            { op: 'upsert', entity: workOrder(WO2, 1) },
            { op: 'upsert', entity: scopeItem(SCOPE, WO) },
          ],
        }),
      );
      await store.applyPage(page(active, { ops: [{ op: 'delete', type: 'work_order', id: WO, version: 2 }] }));
      const versions = await store.readVersions(active, [key(scopeItem(SCOPE, WO)), key(workOrder(WO2, 1))]);
      expect(versions.has(key(scopeItem(SCOPE, WO)))).toBe(false);
      expect(versions.get(key(workOrder(WO2, 1)))?.deleted).toBe(false);
    });

    it('EVM-092 AC5: a snapshot with removeWorkOrderId removes the order, its children and the hydration entry in one write', async () => {
      const { store, active } = await fresh();
      await store.applyPage(
        page(active, {
          ops: [
            { op: 'upsert', entity: workOrder(WO, 1) },
            { op: 'upsert', entity: scopeItem(SCOPE, WO) },
          ],
          hydrationAdd: [{ workOrderId: WO, reason: 'not_found' }],
        }),
      );
      await store.applySnapshot({
        generation: active,
        ownerUserId: USER,
        ops: [],
        serverTime: 2_000,
        hydrationRemove: [WO],
        removeWorkOrderId: WO,
      });
      expect((await store.readVersions(active, [key(workOrder(WO, 1)), key(scopeItem(SCOPE, WO))])).size).toBe(0);
      expect((await store.loadState()).active.hydration).toEqual([]);
    });

    it('EVM-092 AC6: plannedResync is stored only for the active generation; beginShadow clears it', async () => {
      const { store, active } = await fresh();
      const shadow = await store.beginShadow('periodic');
      await store.applyPage(page(shadow, { plannedResync: 'invalid_change' }));
      expect((await store.loadState()).pendingResync).toBeNull();
      await store.applyPage(page(active, { plannedResync: 'invalid_change' }));
      expect((await store.loadState()).pendingResync).not.toBeNull();
      await store.beginShadow('invalid_change');
      expect((await store.loadState()).pendingResync).toBeNull();
    });

    it('EVM-092 AC4: a new shadow replaces the previous one (new number); promote makes it active and drops the old generation', async () => {
      const { store, active } = await fresh();
      await store.applyPage(page(active, { ops: [{ op: 'upsert', entity: workOrder(WO, 1) }] }));
      const first = await store.beginShadow('periodic');
      const second = await store.beginShadow('scope_changed');
      expect(second).toBeGreaterThan(first);
      expect(await store.applyPage(page(first))).toBe('stale');
      await store.applyPage(page(second, { ops: [{ op: 'upsert', entity: workOrder(WO2, 1) }], complete: true }));
      expect(await store.promoteShadow(first)).toBe('stale');
      expect(await store.promoteShadow(second)).toBe('applied');
      const state = await store.loadState();
      expect(state.active.generation).toBe(second);
      expect(state.shadow).toBeNull();
      expect((await store.readVersions(active, [key(workOrder(WO, 1))])).size).toBe(0);
      expect((await store.readVersions(second, [key(workOrder(WO2, 1))])).size).toBe(1);
      expect(await store.applyPage(page(active))).toBe('stale');
    });

    it('EVM-092 AC1: complete follows the last page, initialLoadDone is set once the list is empty and never reverts', async () => {
      const { store, active } = await fresh();
      await store.applyPage(page(active, { cursor: 'cursor-00000000000a' }));
      expect((await store.loadState()).active.initialLoadDone).toBe(false);
      await store.applyPage(page(active, { complete: true, hydrationAdd: [{ workOrderId: WO, reason: 'unknown_anchor' }] }));
      expect((await store.loadState()).active.initialLoadDone).toBe(false);
      await store.applySnapshot({ generation: active, ownerUserId: USER, ops: [], serverTime: 2, hydrationRemove: [WO] });
      expect((await store.loadState()).active.initialLoadDone).toBe(true);
      await store.applyPage(page(active, { cursor: 'cursor-00000000000b', complete: false }));
      const state = await store.loadState();
      expect(state.active.complete).toBe(false);
      expect(state.active.initialLoadDone).toBe(true);
    });

    it('EVM-092 AC1: a promoted shadow counts as downloaded', async () => {
      const { store } = await fresh();
      const shadow = await store.beginShadow('periodic');
      await store.applyPage(page(shadow, { complete: true }));
      await store.promoteShadow(shadow);
      expect((await store.loadState()).active.initialLoadDone).toBe(true);
    });

    it('EVM-092 AC5: findWorkOrdersBySite answers a whole page at once and sees only the given generation', async () => {
      const { store, active } = await fresh();
      const site = '30000000-0000-4000-8000-000000000001';
      await store.applyPage(
        page(active, {
          ops: [
            { op: 'upsert', entity: workOrder(WO, 1, site) },
            { op: 'upsert', entity: workOrder(WO2, 1, null) },
          ],
        }),
      );
      const found = await store.findWorkOrdersBySite(active, [site]);
      expect([...(found.get(site) ?? [])]).toEqual([WO]);
      const shadow = await store.beginShadow('periodic');
      expect((await store.findWorkOrdersBySite(shadow, [site])).size).toBe(0);
    });

    it('EVM-092 AC5: sweep removes an order closed before the limit with its children and the orphans it leaves, as planSweep does', async () => {
      const { store, active } = await fresh();
      const entities = [
        closedOrder(WO, 'settled', OLD_CLOSED, CUSTOMER),
        scopeItem(SCOPE, WO),
        customer(CUSTOMER),
        closedOrder(WO2, 'in_progress', OLD_CLOSED),
      ];
      await store.applyPage(page(active, { ops: upserts(entities) }));
      const rule = { generation: active, closedBefore: CLOSED_BEFORE, keepWorkOrderIds: [], keepReferencedIds: [] };
      const expected = planSweep(entities, rule);
      const result = await store.sweep(rule);
      expect(result).toEqual({ removedWorkOrders: 1, removedOrphans: 1 });
      expect(result).toEqual({ removedWorkOrders: expected.removedWorkOrders, removedOrphans: expected.removedOrphans });
      const left = await store.readVersions(active, entities.map(key));
      expect([...left.keys()]).toEqual([key(workOrder(WO2, 1))]);
    });

    it('EVM-092 AC5: sweep keeps a closed order listed in keepWorkOrderIds together with what it references', async () => {
      const { store, active } = await fresh();
      const entities = [closedOrder(WO, 'cancelled', OLD_CLOSED, CUSTOMER), customer(CUSTOMER)];
      await store.applyPage(page(active, { ops: upserts(entities) }));
      const result = await store.sweep({ generation: active, closedBefore: CLOSED_BEFORE, keepWorkOrderIds: [WO], keepReferencedIds: [] });
      expect(result).toEqual({ removedWorkOrders: 0, removedOrphans: 0 });
      expect((await store.readVersions(active, entities.map(key))).size).toBe(2);
    });

    it('EVM-092 AC5: sweep keeps an object from keepReferencedIds and removes an orphan without references', async () => {
      const { store, active } = await fresh();
      const entities = [customer(CUSTOMER), customer(CUSTOMER2), workOrder(WO, 1)];
      await store.applyPage(page(active, { ops: upserts(entities) }));
      const result = await store.sweep({
        generation: active,
        closedBefore: CLOSED_BEFORE,
        keepWorkOrderIds: [],
        keepReferencedIds: [CUSTOMER],
      });
      expect(result).toEqual({ removedWorkOrders: 0, removedOrphans: 1 });
      const left = await store.readVersions(active, entities.map(key));
      expect([...left.keys()].sort()).toEqual([key(customer(CUSTOMER)), key(workOrder(WO, 1))].sort());
    });

    it('EVM-092 AC5: sweep touches only the given generation', async () => {
      const { store, active } = await fresh();
      const shadow = await store.beginShadow('periodic');
      const old = closedOrder(WO, 'settled', OLD_CLOSED);
      await store.applyPage(page(active, { ops: upserts([old]) }));
      await store.applyPage(page(shadow, { ops: upserts([old]) }));
      const result = await store.sweep({ generation: active, closedBefore: CLOSED_BEFORE, keepWorkOrderIds: [], keepReferencedIds: [] });
      expect(result.removedWorkOrders).toBe(1);
      expect((await store.readVersions(active, [key(old)])).size).toBe(0);
      expect((await store.readVersions(shadow, [key(old)])).size).toBe(1);
    });

    it('EVM-092 AC4: discardShadow drops the shadow so a write to it is stale; the active generation stays intact', async () => {
      const { store, active } = await fresh();
      await store.applyPage(page(active, { ops: upserts([workOrder(WO, 1)]) }));
      const shadow = await store.beginShadow('periodic');
      await store.applyPage(page(shadow, { ops: upserts([workOrder(WO2, 1)]) }));
      await store.discardShadow();
      expect((await store.loadState()).shadow).toBeNull();
      expect(await store.applyPage(page(shadow))).toBe('stale');
      expect(await store.promoteShadow(shadow)).toBe('stale');
      expect((await store.readVersions(active, [key(workOrder(WO, 1))])).size).toBe(1);
    });

    it('EVM-092 AC4: wipeReplica removes both generations, so a write to either of them is stale', async () => {
      const { store, active } = await fresh();
      await store.applyPage(page(active, { ops: upserts([workOrder(WO, 1)]) }));
      const shadow = await store.beginShadow('periodic');
      await store.applyPage(page(shadow, { ops: upserts([workOrder(WO2, 1)]) }));
      await store.wipeReplica();
      const state = await store.loadState();
      expect(state.shadow).toBeNull();
      expect(state.active.generation).toBeGreaterThan(shadow);
      expect(await store.applyPage(page(active))).toBe('stale');
      expect(await store.applyPage(page(shadow))).toBe('stale');
      expect((await store.readVersions(state.active.generation, [key(workOrder(WO, 1)), key(workOrder(WO2, 1))])).size).toBe(0);
    });

    it('EVM-092 AC7: saveContact and saveConfig store the records as given', async () => {
      const { store } = await fresh();
      await store.saveContact({ at: 1 });
      await store.saveConfig({ days: 3 });
      const state = await store.loadState();
      expect(state.contact).toEqual({ at: 1 });
      expect(state.config).toEqual({ days: 3 });
    });
  });
}
