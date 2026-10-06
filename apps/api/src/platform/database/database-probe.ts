/** Narrow port for checking the database connection (health; EVM-008 AC1) and its Kysely adapter. */
import { sql, type Kysely } from 'kysely';
import type { Database } from './database.ts';

export interface DatabaseProbe {
  /** Resolves when the database answers; rejects otherwise. */
  ping(): Promise<void>;
}

export class KyselyDatabaseProbe implements DatabaseProbe {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async ping(): Promise<void> {
    await sql`select 1`.execute(this.#db);
  }
}
