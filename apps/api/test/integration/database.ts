/** A fresh test database per test file, created on the server from the global setup. */
import { sql } from 'kysely';
import { inject } from 'vitest';
import { createDatabase } from '../../src/platform/database/database.ts';
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
