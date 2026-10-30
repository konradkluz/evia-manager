import type { Database, Tx } from './database';

/**
 * Versioned local schema (EVM-093 AC2; offline-sync.md, rule 2). Two independent version numbers:
 * - the QUEUE side (`PRAGMA user_version`): queue entries, settled results, owner, generation counter. Its migrations only preserve
 *   (`seq`, `mutation_id`, owner and order stay); a migration is never allowed to drop or renumber them;
 * - the REPLICA side (`meta.replica_schema`): server data with generations. Its migration may drop the replica and ask for a full
 *   download (`reset`), because the replica can always be fetched again; it never touches a queue table.
 * Every migration runs in ONE transaction together with the new version number, so a failure leaves the previous version intact.
 * PRAGMAs that cannot run inside a transaction (`journal_mode`, …) are never part of a migration.
 */
export interface QueueMigration {
  readonly version: number;
  up(tx: Tx): Promise<void>;
}

export interface ReplicaMigration {
  readonly version: number;
  /** `reset`: the replica was dropped and recreated empty; a new active generation is started and the next pull is a full one. */
  up(tx: Tx): Promise<'kept' | 'reset'>;
}

export interface SchemaPlan {
  readonly queue: readonly QueueMigration[];
  readonly replica: readonly ReplicaMigration[];
}

export interface SchemaVersions {
  readonly queue: number;
  readonly replica: number;
}

export type MigrationResult =
  | { readonly kind: 'ok'; readonly replicaReset: boolean }
  /** The file is newer than this app (downgrade): nothing was written; the app reports "update required" (SR-MOB-09). */
  | { readonly kind: 'update_required' };

export const latest = (plan: SchemaPlan): SchemaVersions => ({
  queue: Math.max(0, ...plan.queue.map((m) => m.version)),
  replica: Math.max(0, ...plan.replica.map((m) => m.version)),
});

/** Reads both versions without writing anything (the downgrade check runs before any writing PRAGMA). */
export async function readVersions(tx: Tx): Promise<SchemaVersions> {
  const queue = Number((await tx.get('PRAGMA user_version'))?.['user_version'] ?? 0);
  const hasMeta = (await tx.get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'meta'")) !== undefined;
  const replicaRow = hasMeta ? await tx.get("SELECT value FROM meta WHERE key = 'replica_schema'") : undefined;
  const replica = Number(replicaRow?.['value'] ?? 0);
  return { queue: Number.isFinite(queue) ? queue : 0, replica: Number.isFinite(replica) ? replica : 0 };
}

export const isNewerThan = (found: SchemaVersions, known: SchemaVersions): boolean =>
  found.queue > known.queue || found.replica > known.replica;

/** Raises the schema step by step. The caller has already refused a newer file (`isNewerThan`). */
export async function migrate(db: Database, plan: SchemaPlan): Promise<MigrationResult> {
  const found = await db.read(readVersions);
  if (isNewerThan(found, latest(plan))) return { kind: 'update_required' };
  for (const migration of [...plan.queue].sort((a, b) => a.version - b.version)) {
    if (migration.version <= found.queue) continue;
    await db.transaction(async (tx) => {
      await migration.up(tx);
      await tx.exec(`PRAGMA user_version = ${String(Math.trunc(migration.version))}`);
    });
  }
  let replicaReset = false;
  for (const migration of [...plan.replica].sort((a, b) => a.version - b.version)) {
    if (migration.version <= found.replica) continue;
    const outcome = await db.transaction(async (tx) => {
      const result = await migration.up(tx);
      if (result === 'reset') await startFreshActiveGeneration(tx);
      await tx.run("INSERT INTO meta (key, value) VALUES ('replica_schema', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [
        String(migration.version),
      ]);
      return result;
    });
    if (outcome === 'reset' && found.replica > 0) replicaReset = true;
  }
  return { kind: 'ok', replicaReset };
}

/** Takes the next generation number from the queue-side counter (never reused, survives every reset of the replica). */
export async function nextGeneration(tx: Tx): Promise<number> {
  const row = await tx.get("SELECT value FROM meta WHERE key = 'next_generation'");
  const next = Number(row?.['value'] ?? 1);
  await tx.run("INSERT INTO meta (key, value) VALUES ('next_generation', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [
    String(next + 1),
  ]);
  return next;
}

export async function startFreshActiveGeneration(tx: Tx): Promise<number> {
  const generation = await nextGeneration(tx);
  await tx.run("INSERT INTO replica_generations (generation, role) VALUES (?, 'active')", [generation]);
  return generation;
}

/** Replica tables of schema v1. A later reset migration drops them with `dropReplicaTables` and creates its own version. */
export async function createReplicaTablesV1(tx: Tx): Promise<void> {
  await tx.exec(`
    CREATE TABLE replica_generations (
      generation INTEGER PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('active', 'shadow')),
      cursor TEXT,
      complete INTEGER NOT NULL DEFAULT 0,
      initial_load_done INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX replica_generations_role ON replica_generations (role);
    CREATE TABLE replica_entities (
      generation INTEGER NOT NULL,
      type TEXT NOT NULL,
      id TEXT NOT NULL,
      version INTEGER NOT NULL,
      work_order_id TEXT,
      site_id TEXT,
      fields TEXT NOT NULL,
      PRIMARY KEY (generation, type, id)
    );
    CREATE INDEX replica_entities_site ON replica_entities (generation, site_id) WHERE type = 'work_order';
    CREATE INDEX replica_entities_anchor ON replica_entities (generation, work_order_id);
    CREATE TABLE replica_tombstones (
      generation INTEGER NOT NULL,
      type TEXT NOT NULL,
      id TEXT NOT NULL,
      version INTEGER NOT NULL,
      PRIMARY KEY (generation, type, id)
    );
    CREATE TABLE replica_hydration (
      seq INTEGER PRIMARY KEY,
      generation INTEGER NOT NULL,
      work_order_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      UNIQUE (generation, work_order_id)
    );
    CREATE TABLE replica_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
}

export const REPLICA_TABLES = [
  'replica_generations',
  'replica_entities',
  'replica_tombstones',
  'replica_hydration',
  'replica_meta',
] as const;

export async function dropReplicaTables(tx: Tx): Promise<void> {
  for (const table of REPLICA_TABLES) await tx.exec(`DROP TABLE IF EXISTS ${table}`);
}

/** Queue tables of schema v1: never dropped by a migration of the replica or by a resync. */
export async function createQueueTablesV1(tx: Tx): Promise<void> {
  await tx.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE queue_entries (
      seq INTEGER PRIMARY KEY,
      mutation_id TEXT NOT NULL UNIQUE,
      owner_user_id TEXT,
      record TEXT NOT NULL
    );
    CREATE TABLE settled_results (
      seq INTEGER PRIMARY KEY,
      mutation_id TEXT NOT NULL,
      info TEXT NOT NULL
    );
  `);
}

export const QUEUE_TABLES = ['meta', 'queue_entries', 'settled_results'] as const;

/** The schema of this app version. */
export const SCHEMA: SchemaPlan = {
  queue: [{ version: 1, up: createQueueTablesV1 }],
  replica: [
    {
      version: 1,
      up: async (tx) => {
        await createReplicaTablesV1(tx);
        return 'reset';
      },
    },
  ],
};
