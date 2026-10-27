/**
 * 0002 — application role (ADR-0003; EVM-016 W7). Only `evia_app` is created here, as NOLOGIN: the login role the API
 * connects with (a member of `evia_app`, with a password from the environment) is created by the deployment (EVM-076),
 * never by a migration. `evia_migrator` is the identity that runs the migrations — not created here either.
 *
 * Roles are global to the PostgreSQL cluster while test databases are created in parallel, and on staging `evia_app` is
 * created beforehand by the init script (the migrator has no CREATEROLE). So the role is created only when it does not
 * exist: PostgreSQL checks the CREATEROLE privilege before it looks for a duplicate, so `create role` with a
 * `duplicate_object` handler still fails with 42501 for a role without the privilege.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'evia_app') then
        create role evia_app nologin;
      end if;
    end
    $$
  `.execute(db);
}
