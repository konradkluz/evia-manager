import type { AuditReasonCode, SyncChange, SyncMutation, SyncMutationResult } from '@evia/contracts';
import { zSyncChangesResponse, zSyncMutationsRequest, zSyncMutationsResponse } from '@evia/contracts/zod';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KNOWN_REJECTION_CODES, MUTATION_TYPES, type MutationType, type PauseReason } from '../src/index.ts';
import { ENTITY_TYPES, RESYNC_REASONS } from '../src/pull-types.ts';
import { parseClientConfig, parsePage } from '../src/pull-parse.ts';
import { toWire } from '../src/validate.ts';
import { aggregate, del, page, upsert } from './pull-helpers.ts';
import { makeCore, noteInput } from './helpers.ts';

/** EVM-107 AC7: sync-core does not know the contract; this test (the contract is a devDependency) proves both directions. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// Each element must be true: a difference of the sets is a compile error (typecheck is part of the gate).
type Proofs = [
  Equal<SyncMutation['type'], MutationType>,
  Equal<SyncChange['op'], 'upsert' | 'delete'>,
  // the device and session codes of the core that the contract names in its reason vocabulary
  Equal<
    Extract<AuditReasonCode, 'session_revoked' | 'device_wipe_required' | 'channel_not_allowed'>,
    'session_revoked' | 'device_wipe_required' | 'channel_not_allowed'
  >,
  Equal<Extract<PauseReason, 'session_revoked' | 'device_wipe_required'>, 'session_revoked' | 'device_wipe_required'>,
];
const proofs = (p: Proofs): readonly true[] => p;
// the wire envelope of the core is assignable to the contract item, a contract result keeps open strings
const wireIsContractItem = (record: Parameters<typeof toWire>[0]): SyncMutation => toWire(record) as SyncMutation;
const resultShape: SyncMutationResult = { mutationId: 'x', outcome: 'applied' };

interface Extensible {
  readonly 'x-extensible-enum'?: readonly string[];
}
interface Schema extends Extensible {
  readonly properties?: Record<string, Extensible>;
  readonly 'x-evia-sync-projections'?: Record<string, string>;
}
interface Responses {
  responses: Record<string, { content?: Record<string, { example?: unknown; examples?: Record<string, { value: unknown }> }> }>;
}
interface OpenApi {
  readonly components: { readonly schemas: Record<string, Schema> };
  readonly paths: Record<string, { get?: Responses; post?: Responses }>;
}
const openapi = JSON.parse(readFileSync(new URL('../../contracts/dist/openapi.json', import.meta.url), 'utf8')) as OpenApi;
const vocabulary = (schema: string, property: string): readonly string[] => {
  const values = openapi.components.schemas[schema]?.properties?.[property]?.['x-extensible-enum'];
  if (values === undefined) throw new Error(`no vocabulary ${schema}.${property}`);
  return values;
};
const sorted = (values: readonly string[]): string[] => [...values].sort();
const first = (r: Responses | undefined, status: string) => Object.values(r?.responses[status]?.content ?? {})[0];

describe('sync-core vs. the contract: value sets in both directions (EVM-107 AC7)', () => {
  it('EVM-107 AC7: result statuses of the contract are exactly applied, duplicate, conflict, rejected', () => {
    expect(sorted(vocabulary('SyncMutationResult', 'outcome'))).toEqual(['applied', 'conflict', 'duplicate', 'rejected']);
    expect(wireIsContractItem).toBeDefined();
    expect(proofs).toBeDefined();
    expect(resultShape.outcome).toBe('applied');
  });

  it('EVM-107 AC7: rejection codes of the contract = known codes of the core + the one handled separately (transient)', () => {
    const contract = vocabulary('SyncMutationResult', 'code');
    // idempotency_in_progress is retried (transient); quota_exceeded is a known code since EVM-106 AC5
    const handledElsewhere = ['idempotency_in_progress'];
    expect(sorted([...KNOWN_REJECTION_CODES, ...handledElsewhere])).toEqual(sorted(contract));
    for (const code of KNOWN_REJECTION_CODES) expect(contract).toContain(code);
  });

  it('EVM-107 AC7: mutation types, entity types, phases and resync reasons are the same sets', () => {
    expect(MUTATION_TYPES).toHaveLength(3);
    expect(sorted(vocabulary('SyncChangesPage', 'phase'))).toEqual(['changes', 'snapshot']);
    expect(sorted(RESYNC_REASONS.filter((r) => r !== 'invalid_change'))).toEqual(sorted(vocabulary('SyncResyncRequired', 'reason')));
    const projections = openapi.components.schemas['SyncEntity']?.['x-evia-sync-projections'];
    if (projections !== undefined) expect(sorted(Object.keys(projections))).toEqual(sorted(ENTITY_TYPES));
  });
});

describe('sync-core fixtures pass the contract schemas (EVM-107 AC7)', () => {
  it('EVM-107 AC7: every request batch of the core passes zSyncMutationsRequest', async () => {
    const { core, server } = makeCore();
    const at = '2026-10-29T08:00:00Z';
    const woId = '0194c2a0-0000-7000-8000-000000000001';
    const note = await core.queue.enqueue(
      noteInput(woId, { noteCategory: 'meeting', capturedAt: at, id: '0194c2a0-0000-7000-8000-0000000000a1' }),
    );
    const comment = await core.queue.enqueue({
      type: 'CreateComment',
      commandVersion: 1,
      payload: { id: '0194c2a0-0000-7000-8000-0000000000ab', workOrderId: woId, body: 'synthetic', capturedAt: at },
    });
    const quick = await core.queue.enqueue({
      type: 'CreateQuickWorkOrder',
      commandVersion: 1,
      payload: {
        workOrderId: '0194c2a0-0000-7000-8000-0000000000c1',
        templateId: '0194c2a0-0000-7000-8000-0000000000bb',
        title: 'Synthetic',
      },
    });
    await core.engine.flush();
    const request = server.requests[0];
    expect(request?.mutations.map((m) => m.mutationId)).toEqual([note.mutationId, comment.mutationId, quick.mutationId]);
    expect(zSyncMutationsRequest.safeParse(request).success).toBe(true);
  });

  it('EVM-107 AC7: pull fixtures (snapshot and change pages with upserts and deletes) pass zSyncChangesResponse', () => {
    const pages = [
      page([...aggregate(1), upsert('timeline_entry', 2), del('timeline_entry', 3, 4)], { phase: 'snapshot', cursor: 1, hasMore: true }),
      page([], { cursor: 2 }),
    ];
    for (const p of pages) {
      expect(p.kind).toBe('ok');
      expect(zSyncChangesResponse.safeParse((p as { body: unknown }).body).success).toBe(true);
    }
  });
});

describe('contract examples are decoded by sync-core (EVM-107 AC7)', () => {
  it('EVM-107 AC7: both examples of GET /sync/changes are accepted by parsePage and keep their content', () => {
    const examples = first(openapi.paths['/api/v1/sync/changes']?.get, '200')?.examples ?? {};
    const changes = parsePage(examples['changes']?.value, 200);
    expect(changes.ok && 'page' in changes ? changes.page.changes.length : -1).toBe(2);
    const resync = parsePage(examples['resync_required']?.value, 200);
    expect(resync.ok && 'resync' in resync ? resync.resync.reason : '').toBe('periodic');
    for (const e of Object.values(examples)) expect(zSyncChangesResponse.safeParse(e.value).success).toBe(true);
  });

  it('EVM-107 AC7: the example of POST /sync/mutations passes the response schema; the engine understands it', async () => {
    const example = first(openapi.paths['/api/v1/sync/mutations']?.post, '200')?.example as {
      results: { mutationId: string; outcome: string; code?: string }[];
    };
    expect(zSyncMutationsResponse.safeParse(example).success).toBe(true);
    const { core, server, store } = makeCore();
    const a = await core.queue.enqueue(noteInput());
    const b = await core.queue.enqueue(noteInput('0194c2a0-0000-7000-8000-000000000002', { id: '0194c2a0-0000-7000-8000-0000000000b2' }));
    const results = example.results.map((r, i) => ({ ...r, mutationId: i === 0 ? a.mutationId : b.mutationId }));
    server.script.push({ kind: 'ok', body: { ...example, results } });
    await core.engine.flush();
    expect(store.settled.map((s) => s.mutationId)).toEqual([a.mutationId]);
    expect(store.records()[0]).toMatchObject({ mutationId: b.mutationId, state: 'needs_attention', lastCode: 'target_unavailable' });
  });

  it('EVM-107 AC7: the client config of the contract is read by parseClientConfig without falling back to defaults', () => {
    const body = { offlineContactWindowDays: 5, closedWorkOrdersInScopeDays: 30, periodicResyncDays: 7, scopeRuleVersion: 3 };
    expect(parseClientConfig(body).offlineContactWindowDays).toBe(5);
  });
});
