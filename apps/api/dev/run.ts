/**
 * The tool of the local environment that the orchestrator (tools/dev-env) starts after `docker compose up` (EVM-077):
 *   state — the guard in the database and the state of the Administrator (`none` | `invited` | `active`), one JSON line
 *   seed  — the guard, then the demo data (needs an active Administrator as the author), one JSON line with counts
 * Exit codes: 0 ok, 1 error (message without values), 2 usage, 3 the guard refuses (nothing was written). The guard checks the
 * very string that the connection then uses (one read of DATABASE_URL, CWE-367). Output: counts only, never a record.
 */
import type { Writable } from 'node:stream';
import type { Kysely } from 'kysely';
import { ConfigError, loadConfig, type AppConfig } from '../src/platform/config/config.ts';
import { createDatabase, type Database } from '../src/platform/database/database.ts';
import { createLogger } from '../src/platform/logging/logger.ts';
import { activeAdministrator, administratorState } from './administrator.ts';
import { readDatabaseFacts } from './database-facts.ts';
import { databaseProblems, environmentProblems, type Problem } from './guard.ts';
import type { SeedCounts } from './seed/run.ts';

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_USAGE = 2;
export const EXIT_REFUSED = 3;

export interface CliDeps {
  openDatabase(url: string): Kysely<Database>;
  seed(config: AppConfig, administratorId: string, stderr: Writable): Promise<SeedCounts>;
}

export interface CliIo {
  readonly stdout: Pick<Writable, 'write'>;
  readonly stderr: Writable;
}

const USAGE = 'Użycie: node dev/cli.js state | seed\n';

function refuse(io: CliIo, problems: readonly Problem[]): number {
  io.stderr.write('Strażnik środowiska lokalnego odmawia (nic nie zapisano):\n');
  for (const problem of problems) io.stderr.write(`  - ${problem.message}\n`);
  return EXIT_REFUSED;
}

export async function runDevCli(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: CliIo,
  deps: CliDeps,
): Promise<number> {
  const [command, ...rest] = argv;
  if ((command !== 'state' && command !== 'seed') || rest.length > 0) {
    io.stderr.write(USAGE);
    return EXIT_USAGE;
  }
  const environment = environmentProblems(env);
  if (environment.length > 0) return refuse(io, environment);

  const url = env['DATABASE_URL'] ?? '';
  let config: AppConfig;
  try {
    config = loadConfig({ ...env, DATABASE_URL: url });
  } catch (error) {
    io.stderr.write(`Błąd konfiguracji (zmienne: ${error instanceof ConfigError ? error.keys.join(', ') : 'nieznane'}). Popraw .env.\n`);
    return EXIT_ERROR;
  }
  // The guard and the writes use one and the same string.
  if (config.databaseUrl !== url) return refuse(io, [{ code: 'url', message: 'Adres bazy zmienił się po sprawdzeniu — odmowa.' }]);

  const db = deps.openDatabase(url);
  try {
    const database = databaseProblems(await readDatabaseFacts(db));
    if (database.length > 0) return refuse(io, database);
    const admin = await administratorState(db);
    if (command === 'state') {
      io.stdout.write(`${JSON.stringify({ guard: 'ok', admin })}\n`);
      return EXIT_OK;
    }
    const author = await activeAdministrator(db);
    if (author === undefined) {
      io.stderr.write('Brak aktywnego Administratora — dane demo powstaną po aktywacji konta.\n');
      io.stdout.write(`${JSON.stringify({ created: 0, existing: 0 })}\n`);
      return EXIT_OK;
    }
    const counts = await deps.seed(config, author.userId, io.stderr);
    io.stdout.write(`${JSON.stringify(counts)}\n`);
    return EXIT_OK;
  } catch (error) {
    // Never the driver message (it may carry the address or values): the kind only.
    io.stderr.write(
      `Błąd: ${error instanceof Error && error.message.startsWith('demo data:') ? error.message : 'operacja na bazie dev nie powiodła się (połączenie lub migracje).'}\n`,
    );
    return EXIT_ERROR;
  } finally {
    await db.destroy();
  }
}

/** The pool of the guard: one short connection, quiet logger. */
export const defaultDeps = async (): Promise<CliDeps> => {
  const { seedWithApplication } = await import('./nest-seed.ts');
  const logger = createLogger({ level: 'fatal' });
  return { openDatabase: (url) => createDatabase({ url, logger, pool: { max: 1 } }), seed: seedWithApplication };
};
