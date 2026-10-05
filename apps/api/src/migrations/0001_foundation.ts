/**
 * 0001 — foundation of the database (ADR-0003; EVM-008 AC1). Forward only (expand): extensions for Polish search
 * (unaccent, pg_trgm), the immutable f_unaccent() for generated search columns (M1) and no CREATE on schema public for
 * other roles. The ICU pl-PL collation is a property of the database itself (initdb / CREATE DATABASE), checked by
 * the integration tests. Roles evia_migrator / evia_app arrive with EVM-076 / E1.
 *
 * f_unaccent: SQL-standard body (bound at creation), schema-qualified dictionary and a fixed search_path, so it
 * cannot be hijacked through search_path (CWE-426).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`create extension if not exists unaccent with schema public`.execute(db);
  await sql`create extension if not exists pg_trgm with schema public`.execute(db);
  await sql`
    create or replace function public.f_unaccent(text) returns text
      language sql immutable parallel safe strict
      set search_path = pg_catalog, public
      return public.unaccent('public.unaccent'::regdictionary, $1)
  `.execute(db);
  await sql`revoke create on schema public from public`.execute(db);
}
