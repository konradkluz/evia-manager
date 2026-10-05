/** Migrations in order (Kysely Migrator, ADR-0003). Forward only: no `down` — a fix is a new migration. */
import type { Migration } from 'kysely/migration';
import * as foundation from './0001_foundation.ts';

export const MIGRATIONS: Readonly<Record<string, Migration>> = Object.freeze({
  '0001_foundation': foundation,
});
