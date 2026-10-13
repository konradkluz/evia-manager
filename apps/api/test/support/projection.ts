/**
 * The read model in the tests (EVM-034; ADR-0017 test 8): fixtures that write straight into the tables of the sources bypass the
 * services, so the handlers of the events never run — they call {@link rebuildProjection} (the same recomputation `rebuild` uses).
 * A global check after every integration test ({@link assertProjectionInSync}, wired in `setup.ts`) compares the projection with the
 * recomputation from the sources: a test that left it different is a test (or a fixture) that changed state without the projection.
 * A TEST helper outside `src`.
 */
import { sql, type Kysely } from 'kysely';
import { ProjectionMaintenance } from '../../src/modules/overview/application/projection-maintenance.ts';
import { ProjectionRecomputer } from '../../src/modules/overview/application/projection-recomputer.ts';
import { PartyProjectionSourceService } from '../../src/modules/parties/infrastructure/projection-source.ts';
import { ProcedureProjectionSourceService } from '../../src/modules/procedures/infrastructure/projection-source.ts';
import { SiteProjectionSourceService } from '../../src/modules/sites/infrastructure/projection-source.ts';
import { WorkOrderProjectionSourceService } from '../../src/modules/work-orders/infrastructure/projection-source.ts';
import type { Database } from '../../src/platform/database/database.ts';
import { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { SystemClock } from '../../src/platform/clock/clock.ts';

const registered = new Set<Kysely<Database>>();
let skipped = false;

/** Makes the global check look at this database (an owner connection) — called by the helpers that create test databases. */
export function registerProjectionCheck(db: Kysely<Database>): void {
  registered.add(db);
}

export function unregisterProjectionCheck(db: Kysely<Database>): void {
  registered.delete(db);
}

/** For a test that deliberately leaves the projection different (for example, one that proves `verify` finds it). */
export function skipProjectionCheckOnce(): void {
  skipped = true;
}

export function projectionTools(db: Kysely<Database>): { maintenance: ProjectionMaintenance; recomputer: ProjectionRecomputer } {
  const orders = new WorkOrderProjectionSourceService();
  const metrics = new MetricsRegistry();
  const clock = new SystemClock();
  const recomputer = new ProjectionRecomputer(
    orders,
    new SiteProjectionSourceService(),
    new PartyProjectionSourceService(),
    new ProcedureProjectionSourceService(),
    clock,
    metrics,
  );
  return { recomputer, maintenance: new ProjectionMaintenance(db, recomputer, orders, clock, metrics) };
}

async function hasProjection(db: Kysely<Database>): Promise<boolean> {
  const { rows } = await sql<{ present: boolean }>`select to_regclass('overview.work_order_summaries') is not null as present`.execute(db);
  return rows[0]?.present === true;
}

/** Recomputes the projection of the orders (all when none are named); a no-op on a database that has no read model yet. */
export async function rebuildProjection(db: Kysely<Database>, only?: readonly string[]): Promise<void> {
  if (only?.length === 0 || !(await hasProjection(db))) return;
  await projectionTools(db).maintenance.rebuild(only === undefined ? {} : { only });
}

/** The global check: the stored projection equals the recomputed one. Runs after each integration test. */
export async function assertProjectionInSync(): Promise<void> {
  if (skipped) {
    skipped = false;
    return;
  }
  for (const db of registered) {
    if (!(await hasProjection(db))) continue;
    const report = await projectionTools(db).maintenance.verify({ traceId: '0'.repeat(32), alert: false });
    const problems = {
      missing: report.missing,
      ...Object.fromEntries(Object.entries(report.drift).filter(([, ids]) => ids.length > 0)),
    };
    if (report.missing.length > 0 || Object.keys(problems).length > 1) {
      throw new Error(`EVM-034 test 8: the projection differs from the recomputation: ${JSON.stringify(problems)}`);
    }
  }
}
