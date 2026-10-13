import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import { ProjectionRecorder, PROJECTION_EVENT_TYPES } from '../../src/modules/overview/application/projection-recorder.ts';
import type { ProjectionRecomputer } from '../../src/modules/overview/application/projection-recomputer.ts';
import type { ProcedureProjectionSource } from '../../src/modules/procedures/system-ports.ts';
import type { Database } from '../../src/platform/database/database.ts';
import { requirePreCommitRegistry, runInTransaction } from '../../src/platform/database/transactional.ts';
import { EventBus } from '../../src/platform/events/event-bus.ts';

const ORDER = '01a13115-0000-7000-8000-000000000001';
const STAGE = '01a13115-0000-7000-8000-0000000000b1';
const CONTEXT = { origin: 'cli', traceId: '0'.repeat(32) } as const;

function setup() {
  const bus = new EventBus();
  const recomputed: string[][] = [];
  const recomputer = {
    recompute: (_tx: unknown, ids: Iterable<string>) => {
      recomputed.push([...ids]);
      return Promise.resolve([...ids]);
    },
  } as unknown as ProjectionRecomputer;
  const procedures: ProcedureProjectionSource = {
    unfinishedStagesOf: () => Promise.resolve([]),
    workOrderIdsOfStages: (_tx, ids) => Promise.resolve(new Map(ids.map((id) => [id, ORDER]))),
  };
  const recorder = new ProjectionRecorder(bus, procedures, recomputer);
  recorder.onModuleInit();
  /** A database that opens a "transaction" over a marker; the registry flushes before the callback returns. */
  const tx = { marker: 'tx' } as unknown as Kysely<Database>;
  const db = {
    transaction: () => ({ execute: <T>(work: (transaction: Kysely<Database>) => Promise<T>) => work(tx) }),
  } as unknown as Kysely<Database>;
  return { bus, recomputed, db, tx };
}

describe('the handlers of the events of the read model (EVM-034 AC6; ADR-0017 W2, W11)', () => {
  it('EVM-034 AC6 every type of event of the feeding modules has a handler: publishing none of them fails with "no handler"', async () => {
    const { bus, db } = setup();
    for (const type of PROJECTION_EVENT_TYPES) {
      await expect(
        runInTransaction(db, (tx) =>
          bus.publish(tx, { type, objectType: 'work_order', objectId: ORDER, workOrderId: ORDER } as never, CONTEXT),
        ),
        type,
      ).resolves.toBeUndefined();
    }
    await expect(runInTransaction(db, (tx) => bus.publish(tx, { type: 'unknown.event' }, CONTEXT))).rejects.toThrow(/No handler/);
  });

  it('EVM-034 AC6 W11 an event outside runInTransaction (a transaction without the registry) fails — the recomputation is never skipped silently', async () => {
    const { bus, tx, recomputed } = setup();
    await expect(
      bus.publish(tx, { type: 'work_order.updated', objectType: 'work_order', objectId: ORDER } as never, CONTEXT),
    ).rejects.toThrow(/runInTransaction/);
    expect(recomputed).toEqual([]);
    expect(() => requirePreCommitRegistry(tx)).toThrow();
  });

  it('EVM-034 AC6 several events of one order cost ONE recomputation, in the registry, before the commit', async () => {
    const { bus, db, recomputed } = setup();
    await runInTransaction(db, async (tx) => {
      await bus.publish(tx, { type: 'work_order.status_changed', objectType: 'work_order', objectId: ORDER } as never, CONTEXT);
      await bus.publish(tx, { type: 'procedure_stage.status_changed', objectId: STAGE, workOrderId: ORDER } as never, CONTEXT);
      await bus.publish(tx, { type: 'procedure_stage.transitioned', objectType: 'procedure_stage', objectId: STAGE } as never, CONTEXT);
      expect(recomputed).toEqual([]);
    });
    expect(recomputed).toEqual([[ORDER]]);
  });

  it('EVM-034 AC6 the audit events of a stage name the stage only: the order is resolved through the port of procedures', async () => {
    const { bus, db, recomputed } = setup();
    await runInTransaction(db, (tx) =>
      bus.publish(tx, { type: 'procedure_stage.updated', objectType: 'procedure_stage', objectId: STAGE } as never, CONTEXT),
    );
    expect(recomputed).toEqual([[ORDER]]);
  });

  it('EVM-034 AC6 an event that carries no identifier at all names no order and recomputes nothing', async () => {
    const { bus, db, recomputed } = setup();
    await runInTransaction(db, (tx) => bus.publish(tx, { type: 'work_order.updated' }, CONTEXT));
    expect(recomputed).toEqual([]);
  });

  it('EVM-034 AC6 an audit event of a scope item names no order and recomputes nothing (the scope is not a column of the projection)', async () => {
    const { bus, db, recomputed } = setup();
    await runInTransaction(db, (tx) =>
      bus.publish(tx, { type: 'scope_item.created', objectType: 'scope_item', objectId: STAGE } as never, CONTEXT),
    );
    expect(recomputed).toEqual([]);
  });
});
