// @ts-check
/**
 * The guard of the local environment (EVM-077 AC4; SR-INFRA-05, CWE-807, CWE-367): a pure function of the environment the
 * child processes will receive. All conditions must hold — a missing one is a refusal, there is no `--force`. The same
 * rules are repeated in apps/api/dev/guard.ts (the process that writes), which adds the marker in the database itself.
 * Messages name the problem and the fix; they never contain a value of a variable.
 */

export const DEV_DATABASE = 'evia_dev';
export const DEV_DB_SERVICE = 'postgres-dev';
/** Host port of the development database (compose.dev.yaml, 127.0.0.1 only); never 5432. */
export const DEV_DB_HOST_PORT = '5442';
export const DEV_API_PORT = '3000';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** @type {Record<string, string>} */
const DATABASE_URL_RULE = {
  'database-url': 'wymagany adres postgres://… (brak albo niepoprawny).',
  'database-host': 'host spoza listy dozwolonych (localhost, 127.0.0.1, ::1, postgres-dev; jeden host).',
  'database-query': 'parametry zapytania (np. host, hostaddr, options) są niedozwolone.',
  'database-name': 'nazwa bazy musi być evia_dev.',
  'database-port': `port musi być ${DEV_DB_HOST_PORT} (baza dev opublikowana na 127.0.0.1).`,
};

/**
 * @typedef {{ code: string, message: string }} Problem
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {Problem[]}
 */
export function guardProblems(env) {
  /** @type {Problem[]} */
  const problems = [];
  const add = (/** @type {string} */ code, /** @type {string} */ message) => problems.push({ code, message });

  if (env['NODE_ENV'] !== 'development') add('node-env', 'NODE_ENV musi mieć wartość development. Ustaw NODE_ENV=development w .env.');
  if (env['WEBAUTHN_RP_ID'] !== 'localhost') add('rp-id', 'WEBAUTHN_RP_ID musi mieć wartość localhost. Popraw .env.');
  if (env['API_PORT'] !== undefined && env['API_PORT'] !== DEV_API_PORT)
    add('api-port', `API_PORT musi mieć wartość ${DEV_API_PORT} (port opublikowany w compose.dev.yaml). Popraw .env.`);
  if (Object.keys(env).some((name) => /^PG/i.test(name)))
    add('pg-env', 'Ustawione są zmienne PG* (PGHOST, PGOPTIONS …) — mogłyby przekierować połączenie. Usuń je z powłoki i z .env.');
  problems.push(...databaseUrlProblems(env['DATABASE_URL']));
  return problems;
}

/**
 * @param {string | undefined} value
 * @returns {Problem[]}
 */
export function databaseUrlProblems(value) {
  const bad = (/** @type {string} */ code) => [
    { code, message: `DATABASE_URL: ${DATABASE_URL_RULE[code] ?? 'niedozwolona wartość.'} Popraw .env (wzór: .env.example).` },
  ];
  if (value === undefined || value === '' || !URL.canParse(value)) return bad('database-url');
  const url = new URL(value);
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return bad('database-url');
  const host = url.hostname.toLowerCase();
  if (host.includes(',') || !(LOOPBACK.has(host) || host === DEV_DB_SERVICE)) return bad('database-host');
  if (url.search !== '' || url.hash !== '' || value.includes('?') || value.includes('#')) return bad('database-query');
  if (url.pathname !== `/${DEV_DATABASE}`) return bad('database-name');
  const expectedPort = host === DEV_DB_SERVICE ? ['', '5432'] : [DEV_DB_HOST_PORT];
  if (!expectedPort.includes(url.port)) return bad('database-port');
  return [];
}
