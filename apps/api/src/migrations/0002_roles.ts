/**
 * 0002 — application role (ADR-0003; EVM-016 W7). Only `evia_app` is created here, as NOLOGIN: the login role the API
 * connects with (a member of `evia_app`, with a password from the environment) is created by the deployment (EVM-076),
 * never by a migration. `evia_migrator` is the identity that runs the migrations — not created here either.
 *
 * Roles are global to the PostgreSQL cluster while test databases are created in parallel, so creation tolerates an
 * existing role (`duplicate_object`).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    do $$
    begin
      create role evia_app nologin;
    exception
      when duplicate_object then null;
    end
    $$
  `.execute(db);
}
