import { describe, expect, it } from 'vitest';
import {
  ENTITY_TYPES,
  HYDRATION_REASONS,
  RESYNC_REASONS,
  planPage,
  planSweep,
  planSnapshot,
  collectKeys,
  type EngineEvent,
  type ParsedChange,
} from '../src/index.ts';
import { parseChange } from '../src/pull-parse.ts';
import { EMPTY_PENDING, type ReplicaEntity } from '../src/pull-types.ts';
import { seededRandom } from './helpers.ts';
import { del, makePull, page, resync, snapshotOf, uid, upsert, wireEntity } from './pull-helpers.ts';

const roller = (seed: number) => {
  const dice = seededRandom(seed * 104_729);
  return (n: number): number => (dice.getRandomValues(new Uint8Array(1))[0] ?? 0) % n;
};

describe('order and duplicates do not matter (EVM-092 AC2)', () => {
  for (let seed = 1; seed <= 60; seed += 1) {
    it(`EVM-092 AC2: seed ${seed} - any order, split into pages, with duplicates, of upserts and versioned deletes ends in the state the highest versions define`, async () => {
      const roll = roller(seed);
      const objects = 1 + roll(4);
      const ops: { n: number; kind: 'u' | 'd'; v: number }[] = [];
      for (let n = 1; n <= objects; n += 1) {
        for (let i = 0; i < 1 + roll(5); i += 1) ops.push({ n, kind: roll(3) === 0 ? 'd' : 'u', v: 1 + roll(8) });
      }
      const withDuplicates = [...ops, ...ops.filter(() => roll(3) === 0)];
      for (let i = withDuplicates.length - 1; i > 0; i -= 1) {
        const j = roll(i + 1);
        [withDuplicates[i], withDuplicates[j]] = [withDuplicates[j] as (typeof ops)[number], withDuplicates[i] as (typeof ops)[number]];
      }
      const wire = withDuplicates.map((o) =>
        o.kind === 'u' ? upsert('work_order', o.n, o.v, { customerId: null, siteId: null, title: `v${o.v}` }) : del('work_order', o.n, o.v),
      );
      const pages: unknown[][] = [];
      for (let i = 0; i < wire.length;) {
        const size = 1 + roll(4);
        pages.push(wire.slice(i, i + size));
        i += size;
      }
      const h = makePull();
      pages.forEach((changes, i) => h.transport.changesScript.push(page(changes, { cursor: i + 1, hasMore: i < pages.length - 1 })));
      expect((await h.pull.pull()).status).toBe('complete');
      for (let n = 1; n <= objects; n += 1) {
        const ups = ops.filter((o) => o.n === n && o.kind === 'u').map((o) => o.v);
        const dels = ops.filter((o) => o.n === n && o.kind === 'd').map((o) => o.v);
        const maxUp = ups.length === 0 ? 0 : Math.max(...ups);
        const maxDel = dels.length === 0 ? 0 : Math.max(...dels);
        const expected = maxUp > maxDel ? maxUp : undefined;
        expect(h.replica.versionOf('work_order', uid('work_order', n)), `object ${n}`).toBe(expected);
      }
      expect(h.replica.calls['readVersions']).toBeLessThanOrEqual(pages.length);
    });
  }
});

describe('pure rules of the replica (EVM-092 AC2, AC5)', () => {
  const entity = (type: Parameters<typeof wireEntity>[0], n: number, v = 1, extra: Record<string, unknown> = {}): ReplicaEntity => {
    const parsed = parseChange({ op: 'upsert', entity: wireEntity(type, n, v, extra) });
    if (parsed.kind !== 'upsert') throw new Error('fixture');
    return parsed.entity;
  };

  it('EVM-092 AC5: the sweep removes orphans in layers: a party kept only by a removed site goes too, one kept by a remaining site stays', () => {
    const all = [
      entity('work_order', 1, 1, { customerId: uid('customer', 1), siteId: uid('site', 1) }),
      entity('customer', 1),
      entity('site', 1, 1, { managerPartyId: uid('party', 1) }),
      entity('party', 1),
      entity('site', 2, 1, { managerPartyId: uid('party', 2) }),
      entity('party', 2),
      entity('user', 3),
    ];
    const plan = planSweep(all, { closedBefore: 0, keepWorkOrderIds: [], keepReferencedIds: [] });
    expect([...plan.removeKeys].sort()).toEqual([`party:${uid('party', 2)}`, `site:${uid('site', 2)}`, `user:${uid('user', 3)}`].sort());
    expect(plan.removedOrphans).toBe(3);
    const kept = planSweep(all, { closedBefore: 0, keepWorkOrderIds: [], keepReferencedIds: [uid('site', 2)] });
    expect(kept.removeKeys).toEqual([`user:${uid('user', 3)}`]);
  });

  it('EVM-092 AC5: the time rule removes the order with its children; unreadable or missing closing time keeps it', () => {
    const old = '2026-01-01T00:00:00Z';
    const all = [
      entity('work_order', 1, 1, { status: 'settled', closedAt: old, customerId: null, siteId: null }),
      entity('timeline_entry', 1),
      entity('work_order', 2, 1, { status: 'settled', closedAt: null, customerId: null, siteId: null }),
      entity('work_order', 3, 1, { status: 'in_progress', closedAt: old, customerId: null, siteId: null }),
      entity('work_order', 4, 1, { status: 'cancelled', closedAt: old, customerId: null, siteId: null }),
    ];
    const plan = planSweep(all, { closedBefore: Date.UTC(2026, 5, 1), keepWorkOrderIds: [uid('work_order', 4)], keepReferencedIds: [] });
    expect(plan.removedWorkOrders).toBe(1);
    expect([...plan.removeKeys].sort()).toEqual(
      [`timeline_entry:${uid('timeline_entry', 1)}`, `work_order:${uid('work_order', 1)}`].sort(),
    );
  });

  it('EVM-092 AC5: a snapshot needs its order, foreign anchors are invalid, duplicates keep the highest version', () => {
    const requestedId = uid('work_order', 1);
    const versions = new Map([[`customer:${uid('customer', 1)}` as const, { version: 5, deleted: false }]]);
    const plan = planSnapshot({
      requestedId,
      entities: [entity('work_order', 1, 2), entity('work_order', 1, 3), entity('customer', 1, 4), entity('customer', 2, 1)],
      versions,
    });
    expect(plan).toMatchObject({ ok: true });
    if (plan.ok)
      expect(plan.ops.map((o) => (o.op === 'upsert' ? `${o.entity.id}@${o.entity.version}` : ''))).toEqual([
        `${requestedId}@3`,
        `${uid('customer', 2)}@1`,
      ]);
    expect(planSnapshot({ requestedId, entities: [entity('customer', 1)], versions })).toEqual({ ok: false });
    expect(planSnapshot({ requestedId, entities: [entity('work_order', 1), entity('scope_item', 2)], versions })).toEqual({ ok: false });
  });

  it('EVM-092 AC5: collectKeys lists the changes, their references and anchors once', async () => {
    const changes: ParsedChange[] = [
      { kind: 'upsert', entity: entity('work_order', 1) },
      { kind: 'upsert', entity: entity('timeline_entry', 1) },
      { kind: 'delete', type: 'user', id: uid('user', 1) },
      { kind: 'unknown' },
    ];
    const keys = collectKeys(changes);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain(`customer:${uid('customer', 1)}`);
    expect(keys).toContain(`work_order:${uid('work_order', 1)}`);
    const plan = await planPage({
      changes: [],
      versions: new Map(),
      pending: EMPTY_PENDING,
      lookupSites: () => Promise.resolve(new Map()),
    });
    expect(plan.ops).toEqual([]);
  });
});

const ALLOWED = new Set<string>([
  'signal',
  'paused',
  'batch_sent',
  'mutation_settled',
  'needs_attention',
  'blocked',
  'retry_scheduled',
  'corrupt_record',
  'ignored_result',
  'pull_page_applied',
  'resync_scheduled',
  'resync_completed',
  'hydration',
  'change_invalid',
  'change_unknown_skipped',
  'replica_wiped',
  'sweep_done',
  'pull_retry_scheduled',
  'pull_failed',
  'data_hidden',
  'snapshot',
  'changes',
  'malformed',
  'projection_mismatch',
  'unknown',
  'access_changed',
  'session_revoked',
  'owner_changed',
  'network',
  'rate_limited',
  'timeout',
  'server_error',
  'invalid_response',
  'invalid_change_in_resync',
  'store_failure',
  'contact_not_saved',
  'unexpected_status',
  'no_contact_record',
  'window_elapsed',
  'clock_anomaly',
  'owner_mismatch',
  'device_wipe_required',
  'upgrade_required',
  'auth_required',
  'forbidden',
  'unexpected_response',
  ...ENTITY_TYPES,
  ...RESYNC_REASONS,
  ...HYDRATION_REASONS,
]);

describe('telemetry carries only vocabulary and numbers (EVM-092 AC6)', () => {
  it('EVM-092 AC6: across invalid, unknown, hydration, resync and store-failure runs with synthetic markers in the data, no event contains a string outside the vocabulary', async () => {
    const markers = ['imie-test', 'e-mail-test', 'nip-test', 'cursor-marker', 'typ-test', 'uzytkownik-test'];
    const events: EngineEvent[] = [];
    const run = async (setup: (h: ReturnType<typeof makePull>) => void): Promise<void> => {
      const h = makePull();
      setup(h);
      await h.pull.pull();
      h.clock.advance(60 * 60_000);
      await h.pull.pull();
      events.push(...h.events);
    };
    await run((h) => {
      h.transport.changesScript.push(
        page(
          [
            upsert('customer', 1, 1, { displayName: 'imie-test', email: 'e-mail-test', nip: 'nip-test' }),
            { op: 'upsert', entity: { type: 'typ-test', id: 'uzytkownik-test', version: 1 } },
            { op: 'delete', type: 'typ-test', id: uid('user', 1) },
            upsert('timeline_entry', 2, 1, { body: 'imie-test' }),
            upsert('user', 1, 1, { displayName: 5 }),
          ],
          { cursor: 'cursor-marker-aaaaaaaa' },
        ),
      );
      h.transport.snapshotScript.set(uid('work_order', 2), [snapshotOf([wireEntity('customer', 2, 1, { email: 'e-mail-test' })])]);
    });
    await run((h) => {
      h.transport.changesScript.push(
        resync('typ-test'),
        page([upsert('timeline_entry', 3)], { phase: 'snapshot', cursor: 'cursor-marker-bbbbbbbb' }),
        { kind: 'network' },
      );
      h.transport.snapshotScript.set(uid('work_order', 3), [{ kind: 'http', status: 500 }]);
    });
    await run((h) => {
      h.replica.loadState = () => Promise.reject(new Error('e-mail-test imie-test'));
    });
    await run((h) => {
      h.transport.changesScript.push(page([upsert('work_order', 1, 1, { status: 'typ-test' })], { cursor: 1 }), {
        kind: 'http',
        status: 401,
        code: 'session_revoked',
      });
    });
    expect(events.length).toBeGreaterThan(8);
    const text = JSON.stringify(events);
    for (const marker of markers) expect(text).not.toContain(marker);
    for (const event of events) {
      for (const [field, value] of Object.entries(event)) {
        if (typeof value === 'string') expect(ALLOWED.has(value), `${event.kind}.${field}=${value}`).toBe(true);
        else expect(['number', 'boolean'].includes(typeof value), `${event.kind}.${field}`).toBe(true);
      }
    }
  });
});
