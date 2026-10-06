/** A fresh test database per test file, created on the server from the global setup. */
import { sql, type Kysely } from 'kysely';
import { inject } from 'vitest';
import { MIGRATIONS } from '../../src/migrations/index.ts';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import { migrateToLatest } from '../../src/platform/database/migrator.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';

const logger = createLogger({ level: 'fatal' });

/** @returns the URL of an empty database `evia_it` (dropped and created again; inherits ICU pl-PL from template1) */
export async function freshDatabaseUrl(): Promise<string> {
  const adminUrl = inject('adminDatabaseUrl');
  const admin = createDatabase({ url: adminUrl, logger, pool: { max: 1 } });
  try {
    await sql`drop database if exists ${sql.id('evia_it')} with (force)`.execute(admin);
    await sql`create database ${sql.id('evia_it')} template template1`.execute(admin);
  } finally {
    await admin.destroy();
  }
  const url = new URL(adminUrl);
  url.pathname = '/evia_it';
  return url.toString();
}

/** The login role the API connects with in tests: a member of `evia_app` that owns nothing (as in the deployment, EVM-076). */
export const APP_LOGIN_ROLE = 'evia_it_app';
const APP_LOGIN_PASSWORD = 'evia-it-synthetic';

export interface MigratedDatabase {
  /** Owner connection (runs the migrations; used for fixtures and for reading the tables the API may not touch). */
  readonly admin: Kysely<Database>;
  readonly adminUrl: string;
  /** URL of the application role — what the API under test connects with, so a missing GRANT fails here and not on staging. */
  readonly appUrl: string;
  close(): Promise<void>;
}

/** Creates the database, applies every migration as the owner and the login role of the application. */
export async function migratedDatabase(): Promise<MigratedDatabase> {
  const adminUrl = await freshDatabaseUrl();
  const admin = createDatabase({ url: adminUrl, logger, pool: { max: 4 } });
  await migrateToLatest(admin, MIGRATIONS);
  await sql`
    do $$
    begin
      create role evia_it_app login password 'evia-it-synthetic' in role evia_app;
    exception
      when duplicate_object then null;
    end
    $$
  `.execute(admin);
  const app = new URL(adminUrl);
  app.username = APP_LOGIN_ROLE;
  app.password = APP_LOGIN_PASSWORD;
  return { admin, adminUrl, appUrl: app.toString(), close: () => admin.destroy() };
}
