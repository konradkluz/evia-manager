/**
 * Runs a SQL script that is NOT built from input: the text produced by a vendored library for a migration (pg-boss builds the
 * statements of its schema — ADR-0010), in the transaction of the migration, as the migrator role. This is the one place that uses
 * `sql.raw` (the lint rule SR-INPUT-03 forbids it elsewhere): the text is never composed from a request, a user value or an
 * environment variable, and it is not reachable from a route.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from './database.ts';

const OPENING = /^\s*BEGIN;\s*/;
const CLOSING = /\s*COMMIT;\s*$/;

/** The script of a library without its own transaction (the migrator runs a migration in one). Fails loudly when the library changes its shape. */
export function withoutTransaction(script: string): string {
  if (!OPENING.test(script) || !CLOSING.test(script)) throw new Error('the schema script of pg-boss has an unexpected shape');
  return script.replace(OPENING, '').replace(CLOSING, '');
}

/** @param text statements separated by `;` (the simple query protocol runs them in order, in the current transaction) */
export async function runTrustedScript(db: Kysely<Database>, text: string): Promise<void> {
  // eslint-disable-next-line no-restricted-syntax -- trusted script text of a library (see the file comment); no input is involved
  await sql.raw(text).execute(db);
}
