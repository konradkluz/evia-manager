import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NOW, Phone, ScriptedServer, aggregate, cursor, settle, uid as baseId } from './harness';

let phone: Phone;
beforeEach(async () => {
  phone = new Phone();
  await phone.open();
});
afterEach(() => {
  phone.close();
});

const iso = (ms: number): string => new Date(ms).toISOString();
const uid = (prefix: string, n: number, k = 0): string => `${prefix}0000000-0000-4000-8000-${String(n * 1000 + k).padStart(12, '0')}`;

/** The children of one work order: 8 scope items, 6 procedure stages, 25 timeline entries, 12 media assets, 2 parties (a heavy order). */
function children(n: number): unknown[] {
  const wo = baseId('work_order', n);
  const upsert = (type: string, id: string, fields: Record<string, unknown>) => ({
    op: 'upsert',
    entity: { type, id, version: 1, ...fields },
  });
  const out: unknown[] = [];
  for (let k = 1; k <= 8; k += 1) {
    out.push(
      upsert('scope_item', uid('5', n, k), {
        workOrderId: wo,
        position: k,
        code: `C${String(k)}`,
        name: `Pozycja zakresu ${String(k)}`,
        parameterSetCode: null,
        parameters: { power: 11, cable: 'YKY 5x6' },
        quantity: 1,
        notes: null,
      }),
    );
  }
  for (let k = 1; k <= 6; k += 1) {
    out.push(
      upsert('procedure_stage', uid('6', n, k), {
        workOrderId: wo,
        procedureId: uid('6', 999),
        procedureCode: 'P',
        procedureName: 'Procedura przylaczeniowa',
        code: `S${String(k)}`,
        name: `Etap ${String(k)}`,
        position: k,
        status: 'todo',
        dueDate: null,
        responsibleUserId: null,
        waitingOn: null,
        waitingPartyId: null,
        waitingSince: null,
        blockedReason: null,
        startedAt: null,
        completedOn: null,
      }),
    );
  }
  for (let k = 1; k <= 25; k += 1) {
    out.push(
      upsert('timeline_entry', uid('7', n, k), {
        workOrderId: wo,
        kind: 'note',
        noteCategory: 'other',
        body: `Wpis testowy ${String(k)} `.repeat(12),
        procedureStageId: null,
        authorUserId: null,
        createdAt: iso(NOW),
        origin: 'web',
        capturedAt: null,
        supersedesEntryId: null,
        supersededByEntryId: null,
        redactedAt: null,
      }),
    );
  }
  for (let k = 1; k <= 12; k += 1) {
    out.push(
      upsert('media_asset', uid('8', n, k), {
        workOrderId: wo,
        mediaType: 'photo',
        category: null,
        description: null,
        procedureStageId: null,
        capturedAt: null,
        fileState: 'ready',
        fileStateReasonCode: null,
        sizeBytes: 2_000_000,
        durationSeconds: null,
        widthPx: 4000,
        heightPx: 3000,
      }),
    );
  }
  return out;
}

/**
 * Non-blocking measurement of the first synchronization (story "Decyzje i ograniczenia", ADR-0021): 300 synthetic work orders built
 * from the shapes of the contract fixtures (an approximation of the server's projection, not its output) on the real adapters.
 * The limits asserted here are generous - the numbers go to the journal of the story.
 */
describe('first synchronization of 300 synthetic work orders (EVM-107, measurement)', () => {
  it('EVM-107 AC1: 300 orders arrive in pages of 200 changes, the biggest aggregate stays under 1 MB, and the list is released only at the end', async () => {
    const N = 300;
    const LIMIT = 200;
    const server = new ScriptedServer();
    const all: unknown[] = [];
    let biggest = 0;
    for (let n = 1; n <= N; n += 1) {
      const aggregateChanges = [...aggregate(n).map((c) => c), ...children(n)];
      biggest = Math.max(biggest, Buffer.byteLength(JSON.stringify(aggregateChanges), 'utf8'));
      all.push(aggregateChanges);
    }
    // the pages carry whole aggregates; at most LIMIT changes per page (the server's rule), the last page of the snapshot ends the phase
    const pages: unknown[][] = [];
    let current: unknown[] = [];
    for (const group of all as unknown[][]) {
      if (current.length + group.length > LIMIT) {
        pages.push(current);
        current = [];
      }
      current.push(...group);
    }
    pages.push(current);
    pages.forEach((changes, index) => {
      server.changes.push(page(changes, index + 1, index < pages.length - 1));
    });
    server.changes.push({
      kind: 'ok',
      body: { result: 'changes', phase: 'changes', changes: [], cursor: cursor(pages.length + 1), hasMore: false, serverTime: iso(NOW) },
    });
    const service = phone.service(server);
    const started = Date.now();
    await service.start();
    for (let i = 0; i < 400 && service.getSnapshot().initialLoad !== 'done'; i += 1) await settle();
    const seconds = (Date.now() - started) / 1000;
    expect(service.getSnapshot().initialLoad).toBe('done');
    const orders = await phone.replica.listWorkOrders(500);
    expect(orders).toHaveLength(N);
    const rows = await phone.db.read((tx) => tx.all('SELECT count(*) AS c FROM replica_entities'));
    const entities = Number(rows[0]?.['c']);
    expect(entities).toBe(N * (3 + 8 + 6 + 25 + 12));
    await phone.db.close();
    const bytes = readdirSync(phone.disk.directory)
      .filter((name) => name.startsWith('evia.db'))
      .reduce((sum, name) => sum + statSync(join(phone.disk.directory, name)).size, 0);
    process.stdout.write(
      `MEASURE EVM-107 first sync: N=${String(N)} limit=${String(LIMIT)} entities=${String(entities)} pages=${String(pages.length)} seconds=${seconds.toFixed(1)} dbBytes=${String(bytes)} biggestAggregateBytes=${String(biggest)}\n`,
    );
    // ADR-0021: more than 1 MB per aggregate would need the paging of the aggregate log
    expect(biggest).toBeLessThan(1_000_000);
    expect(pages.every((p) => p.length <= LIMIT)).toBe(true);
    expect(seconds).toBeLessThan(120);
  }, 180_000);
});

function page(changes: unknown[], n: number, hasMore: boolean) {
  return {
    kind: 'ok' as const,
    body: { result: 'changes', phase: 'snapshot', changes, cursor: cursor(n), hasMore, serverTime: iso(NOW) },
  };
}
