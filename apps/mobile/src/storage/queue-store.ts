import type { QueueRecord, QueueStore, RecordPatch, SettledInfo } from '@evia/sync-core';
import type { DbAccess } from './database';

/** Settled results waiting for their consumer (EVM-107) are bounded: the oldest beyond this limit are dropped in the settle itself. */
export const SETTLED_RETENTION = 500;

const parse = (text: unknown): unknown => {
  if (typeof text !== 'string') return text;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // An unreadable row is handed over as it is: the core's validation rejects it (SR-MOB-10); no row is skipped.
    return text;
  }
};

/**
 * `QueueStore` on the encrypted database (EVM-093 AC3; port of EVM-091). Order = `seq` (INTEGER PRIMARY KEY, only grows, never
 * renumbered); every method is one statement or one transaction and resolves after COMMIT. Reachable only through the owner guard
 * (`LocalStore.unlock`), not exported from the barrel.
 */
export class SqlQueueStore implements QueueStore {
  readonly #db: DbAccess;

  constructor(db: DbAccess) {
    this.#db = db;
  }

  async append(record: QueueRecord): Promise<void> {
    await this.#db.transaction((tx) =>
      tx.run('INSERT INTO queue_entries (mutation_id, owner_user_id, record) VALUES (?, ?, ?)', [
        record.mutationId,
        record.ownerUserId,
        JSON.stringify(record),
      ]),
    );
  }

  async readAll(): Promise<readonly unknown[]> {
    const rows = await this.#db.read((tx) => tx.all('SELECT record FROM queue_entries ORDER BY seq'));
    return rows.map((row) => parse(row['record']));
  }

  async update(mutationId: string, patch: RecordPatch): Promise<void> {
    await this.#db.transaction(async (tx) => {
      const row = await tx.get('SELECT record FROM queue_entries WHERE mutation_id = ?', [mutationId]);
      if (row === undefined) return;
      const current = parse(row['record']);
      const base = typeof current === 'object' && current !== null && !Array.isArray(current) ? (current as Record<string, unknown>) : {};
      const next: Record<string, unknown> = { ...base, state: patch.state, attempts: patch.attempts };
      if (patch.lastCode === undefined) delete next['lastCode'];
      else next['lastCode'] = patch.lastCode;
      if (patch.nextAttemptAt === undefined) delete next['nextAttemptAt'];
      else next['nextAttemptAt'] = patch.nextAttemptAt;
      await tx.run('UPDATE queue_entries SET record = ? WHERE mutation_id = ?', [JSON.stringify(next), mutationId]);
    });
  }

  async settle(mutationId: string, info: SettledInfo): Promise<void> {
    await this.#db.transaction(async (tx) => {
      await tx.run('DELETE FROM queue_entries WHERE mutation_id = ?', [mutationId]);
      await tx.run('INSERT INTO settled_results (mutation_id, info) VALUES (?, ?)', [mutationId, JSON.stringify(info)]);
      await tx.run('DELETE FROM settled_results WHERE seq <= (SELECT max(seq) FROM settled_results) - ?', [SETTLED_RETENTION]);
    });
  }

  /** Hands the settled results to their consumer and removes them in the same transaction (bounded retention). */
  async takeSettled(): Promise<{ mutationId: string; info: SettledInfo }[]> {
    return this.#db.transaction(async (tx) => {
      const rows = await tx.all('SELECT mutation_id, info FROM settled_results ORDER BY seq');
      await tx.run('DELETE FROM settled_results');
      return rows.map((row) => ({ mutationId: String(row['mutation_id']), info: parse(row['info']) as SettledInfo }));
    });
  }
}
