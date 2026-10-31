// Shared helpers of the storage tests (EVM-093): a migrated database on the node:sqlite engine.
import { Database } from '../../src/storage/database';
import { SCHEMA, migrate, type SchemaPlan } from '../../src/storage/schema';
import { NodeSqliteEngine, type TestDisk } from './node-sqlite-engine';

export async function migratedDatabase(disk: TestDisk, plan: SchemaPlan = SCHEMA): Promise<{ db: Database; engine: NodeSqliteEngine }> {
  const engine = new NodeSqliteEngine(disk);
  const db = new Database(await engine.open());
  const result = await migrate(db, plan);
  if (result.kind !== 'ok') throw new Error('test database not migrated');
  return { db, engine };
}
