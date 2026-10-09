/**
 * The guard of the local environment, the half that runs in the process that writes (EVM-077 AC4; SR-INFRA-05, ASVS V13.1,
 * CWE-807, CWE-367). The environment rules repeat tools/dev-env/src/guard.mjs (tools/repo-policy runs both on one table of
 * cases, so they cannot drift); the database rules are checked on the server side of the connection that is used afterwards:
 * the name of the database and the setting stored in the database itself by `ALTER DATABASE … SET` in the initialisation
 * script of the development database (infra/docker/postgres-dev/init.sql). A value set by a session (`options=-c …`,
 * `PGOPTIONS`) is not stored there, so it cannot forge the marker. There is no `--force`.
 */
export const DEV_DATABASE = 'evia_dev';
export const DEV_DB_SERVICE = 'postgres-dev';
export const DEV_DB_HOST_PORT = '5442';
export const DEV_API_PORT = '3000';
/** The setting written into the database by the initialisation script. */
export const MARKER = 'evia.env=local-dev';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface Problem {
  readonly code: string;
  readonly message: string;
}

const URL_RULE: Record<string, string> = {
  'database-url': 'wymagany adres postgres://… (brak albo niepoprawny).',
  'database-host': 'host spoza listy dozwolonych (localhost, 127.0.0.1, ::1, postgres-dev; jeden host).',
  'database-query': 'parametry zapytania (np. host, hostaddr, options) są niedozwolone.',
  'database-name': 'nazwa bazy musi być evia_dev.',
  'database-port': `port musi być ${DEV_DB_HOST_PORT} (baza dev opublikowana na 127.0.0.1).`,
};

function urlProblem(code: string): Problem[] {
  return [{ code, message: `DATABASE_URL: ${URL_RULE[code] ?? 'niedozwolona wartość.'} Popraw .env (wzór: .env.example).` }];
}

export function databaseUrlProblems(value: string | undefined): Problem[] {
  if (value === undefined || value === '' || !URL.canParse(value)) return urlProblem('database-url');
  const url = new URL(value);
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return urlProblem('database-url');
  const host = url.hostname.toLowerCase();
  if (host.includes(',') || !(LOOPBACK.has(host) || host === DEV_DB_SERVICE)) return urlProblem('database-host');
  if (url.search !== '' || url.hash !== '' || value.includes('?') || value.includes('#')) return urlProblem('database-query');
  if (url.pathname !== `/${DEV_DATABASE}`) return urlProblem('database-name');
  const expectedPort = host === DEV_DB_SERVICE ? ['', '5432'] : [DEV_DB_HOST_PORT];
  if (!expectedPort.includes(url.port)) return urlProblem('database-port');
  return [];
}

export function environmentProblems(env: Readonly<Record<string, string | undefined>>): Problem[] {
  const problems: Problem[] = [];
  const add = (code: string, message: string): void => {
    problems.push({ code, message });
  };
  if (env['NODE_ENV'] !== 'development') add('node-env', 'NODE_ENV musi mieć wartość development. Ustaw NODE_ENV=development w .env.');
  if (env['WEBAUTHN_RP_ID'] !== 'localhost') add('rp-id', 'WEBAUTHN_RP_ID musi mieć wartość localhost. Popraw .env.');
  if (env['API_PORT'] !== undefined && env['API_PORT'] !== DEV_API_PORT)
    add('api-port', `API_PORT musi mieć wartość ${DEV_API_PORT} (port opublikowany w compose.dev.yaml). Popraw .env.`);
  if (Object.keys(env).some((name) => /^PG/i.test(name)))
    add('pg-env', 'Ustawione są zmienne PG* (PGHOST, PGOPTIONS …) — mogłyby przekierować połączenie. Usuń je z powłoki i z .env.');
  problems.push(...databaseUrlProblems(env['DATABASE_URL']));
  return problems;
}

/** What the server says about the connection that is used for writing. */
export interface DatabaseFacts {
  readonly currentDatabase: string;
  /** `setconfig` of the database-wide setting (all roles); null when the database has none. */
  readonly databaseSettings: readonly string[] | null;
}

export function databaseProblems({ currentDatabase, databaseSettings }: DatabaseFacts): Problem[] {
  const problems: Problem[] = [];
  if (currentDatabase !== DEV_DATABASE)
    problems.push({ code: 'db-name', message: 'Połączenie prowadzi do bazy innej niż evia_dev — odmowa. Popraw DATABASE_URL w .env.' });
  if (databaseSettings === null || !databaseSettings.includes(MARKER))
    problems.push({
      code: 'db-marker',
      message:
        'W bazie brak znacznika środowiska lokalnego (ustawia go wyłącznie init.sql bazy dev z compose.dev.yaml) — odmowa. Użyj pnpm run dev.',
    });
  return problems;
}
