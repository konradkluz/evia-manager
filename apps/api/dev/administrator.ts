/**
 * The state of the first Administrator for the local environment (EVM-077 AC5): read-only. The account itself is created
 * only by the procedure of EVM-016 (`bootstrap-admin`); nothing here writes.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../src/platform/database/database.ts';

export type AdministratorState = 'none' | 'invited' | 'active';

export interface ActiveAdministrator {
  readonly userId: string;
}

/** `active` wins over `invited`; a deactivated or deleted account counts as none. */
export async function administratorState(db: Kysely<Database>): Promise<AdministratorState> {
  const { rows } = await sql<{ status: 'invited' | 'active' }>`
    select status from identity.users
    where role = 'administrator' and status in ('active', 'invited') and deleted_at is null
    order by (status = 'active') desc limit 1`.execute(db);
  return rows[0]?.status ?? 'none';
}

/** The author of the demo data: the oldest active Administrator. */
export async function activeAdministrator(db: Kysely<Database>): Promise<ActiveAdministrator | undefined> {
  const { rows } = await sql<{ id: string }>`
    select id from identity.users
    where role = 'administrator' and status = 'active' and deleted_at is null
    order by created_at, id limit 1`.execute(db);
  const id = rows[0]?.id;
  return id === undefined ? undefined : { userId: id };
}
