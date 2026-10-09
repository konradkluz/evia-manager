/** The facts the database reports about the connection used for writing (EVM-077 AC4) — input of the pure rules in guard.ts. */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../src/platform/database/database.ts';
import type { DatabaseFacts } from './guard.ts';

/** Reads the facts on the server: the database of this connection and the setting stored for it (not for a session or a role). */
export async function readDatabaseFacts(db: Kysely<Database>): Promise<DatabaseFacts> {
  const { rows } = await sql<{ current_database: string; setconfig: string[] | null }>`
    select current_database() as current_database,
      (select s.setconfig from pg_db_role_setting s join pg_database d on d.oid = s.setdatabase
        where d.datname = current_database() and s.setrole = 0) as setconfig`.execute(db);
  const row = rows[0];
  return { currentDatabase: row?.current_database ?? '', databaseSettings: row?.setconfig ?? null };
}
