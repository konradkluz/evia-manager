// @ts-check
/**
 * The commands of the local environment (EVM-077): init, dev, admin, seed, stop, reset. Everything that touches the world
 * (files, Docker, child processes, the terminal) is injected, so each branch is tested without Docker.
 *
 * Order of `dev` (AC2): terminal → .env → guard → compose up (database, API, migrations) → build of the development tools →
 * guard in the database + state of the Administrator → Administrator (the procedure of EVM-016 through `docker compose exec`,
 * the link goes to the terminal only) → demo data (needs an active Administrator as the author) → panel in the foreground.
 * Any failure before the panel runs `down` (without -v) and exits with a code ≠ 0; messages have a name and a fix, never a
 * stack trace or a value of a variable.
 */
import { classifyUpFailure } from './docker.mjs';
import { parseDotenv } from './dotenv.mjs';
import { initEnvFile } from './env-file.mjs';
import { guardProblems } from './guard.mjs';

export const EXIT_OK = 0;
export const EXIT_PROBLEM = 1;
export const EXIT_USAGE = 2;

export const PANEL_URL = 'http://localhost:5173';
export const API_URL = 'http://127.0.0.1:3000';
export const RESET_PHRASE = 'usuń dane dev';

/**
 * @typedef {import('./docker.mjs').Docker} Docker
 * @typedef {{
 *   root: string,
 *   env: Readonly<Record<string, string | undefined>>,
 *   stdinIsTTY: boolean,
 *   stdoutIsTTY: boolean,
 *   out(text: string): void,
 *   err(text: string): void,
 *   ask(prompt: string): Promise<string>,
 *   readDotenv(): string | null,
 *   docker: Docker,
 *   buildTools(env: NodeJS.ProcessEnv): number,
 *   runTool(command: 'state' | 'seed', env: NodeJS.ProcessEnv): { status: number | null, stdout: string },
 *   runPanel(env: NodeJS.ProcessEnv): Promise<number>,
 * }} Deps
 */

/**
 * The last line of the output of a tool as a JSON object; an empty record when it is not one.
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
function lastJsonLine(text) {
  try {
    const value = /** @type {unknown} */ (JSON.parse(text.trim().split('\n').at(-1) ?? ''));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : {};
  } catch {
    return {};
  }
}

/** @param {Deps} deps @param {string} title @param {string} fix */
function fail(deps, title, fix) {
  deps.err(`Błąd: ${title}\nCo zrobić: ${fix}\n`);
  return EXIT_PROBLEM;
}

/**
 * The environment of the child processes: the shell, then .env on top. A PG* variable of the shell is not stripped but refused by the
 * guard (it could redirect the connection).
 * @param {Readonly<Record<string, string | undefined>>} shell
 * @param {Readonly<Record<string, string>>} dotenv
 * @returns {NodeJS.ProcessEnv}
 */
export function childEnv(shell, dotenv) {
  return { ...shell, ...dotenv };
}

/** @param {Deps} deps */
export function initCommand(deps, init = initEnvFile) {
  const { status } = init(deps.root);
  if (status === 'created') {
    deps.out(
      'Utworzono .env z losowym CURSOR_KEY (wartość nie jest wypisywana; plik jest ignorowany przez git).\nNastępny krok: pnpm run dev\n',
    );
    return EXIT_OK;
  }
  if (status === 'exists') {
    deps.out('Plik .env już istnieje — nic nie zmieniono (nie nadpisuję). Aby zacząć od nowa, usuń go ręcznie i uruchom dev:init.\n');
    return EXIT_OK;
  }
  if (status === 'no-example') return fail(deps, 'brak pliku .env.example', 'uruchom polecenie z katalogu głównego repozytorium.');
  return fail(deps, 'nie udało się zapisać pliku .env', 'sprawdź uprawnienia katalogu repozytorium.');
}

/**
 * @param {Deps} deps
 * @returns {{ env: NodeJS.ProcessEnv } | { exit: number }}
 */
function loadEnvironment(deps) {
  const text = deps.readDotenv();
  if (text === null) return { exit: fail(deps, 'brak pliku .env', 'uruchom najpierw: pnpm run dev:init') };
  const env = childEnv(deps.env, parseDotenv(text));
  const problems = guardProblems(env);
  if (problems.length > 0) {
    deps.err('Błąd: strażnik środowiska lokalnego odmawia (to polecenie działa wyłącznie na maszynie developerskiej).\n');
    for (const problem of problems) deps.err(`  - ${problem.message}\n`);
    deps.err('Co zrobić: popraw wskazane ustawienia; strażnik nie ma opcji --force.\n');
    return { exit: EXIT_PROBLEM };
  }
  return { env };
}

const needTerminal = (/** @type {string} */ command) =>
  `To polecenie wymaga terminala interaktywnego (bez niego nie wydaje linku aktywacyjnego). Uruchom ręcznie w terminalu: ${command}\n`;

/**
 * Reads the state through the tool that runs the guard in the database itself.
 * @param {Deps} deps
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ admin: 'none' | 'invited' | 'active' } | { exit: number }}
 */
function readState(deps, env) {
  if (deps.buildTools(env) !== 0)
    return {
      exit: fail(deps, 'nie udało się zbudować narzędzi dev (tsc)', 'sprawdź pnpm install i pnpm --filter @evia/api run typecheck.'),
    };
  const result = deps.runTool('state', env);
  if (result.status === 3)
    return { exit: fail(deps, 'strażnik bazy odmawia (szczegóły wyżej)', 'popraw wskazane ustawienia; strażnik nie ma opcji --force.') };
  if (result.status !== 0) {
    return {
      exit: fail(
        deps,
        'nie udało się odczytać stanu bazy dev (połączenie lub migracje)',
        'sprawdź, czy kontenery działają (pnpm run dev) i czy port 5442 jest wolny.',
      ),
    };
  }
  const admin = lastJsonLine(result.stdout)['admin'];
  if (admin === 'none' || admin === 'invited' || admin === 'active') return { admin };
  return { exit: fail(deps, 'nieoczekiwana odpowiedź narzędzia stanu', 'uruchom ponownie polecenie; jeśli się powtarza, zgłoś błąd.') };
}

/**
 * The Administrator through the procedure of EVM-016. Returns an exit code on a problem, otherwise the state after it.
 * @param {Deps} deps
 * @param {NodeJS.ProcessEnv} env
 * @param {'none' | 'invited' | 'active'} admin
 */
async function ensureAdministrator(deps, env, admin) {
  if (admin === 'active') {
    deps.out('Administrator jest już aktywny — pomijam procedurę zaproszenia.\n');
    return { admin };
  }
  if (admin === 'invited') {
    const answer = (await deps.ask('Konto Administratora czeka na aktywację. Wydać nowy link (poprzedni zostanie unieważniony)? [t/N] '))
      .trim()
      .toLowerCase();
    if (answer !== 't' && answer !== 'tak') {
      deps.out('Zachowuję poprzedni link (jeśli wygasł, uruchom polecenie ponownie i odpowiedz „t”).\n');
      return { admin };
    }
  }
  const result = await deps.docker('adminExec');
  if (result.error !== undefined || result.status !== 0) {
    return {
      exit: fail(
        deps,
        'procedura Administratora (EVM-016) zakończyła się odmową lub błędem',
        'sprawdź komunikat powyżej i uruchom ponownie pnpm run dev:admin.',
      ),
    };
  }
  const state = readState(deps, env);
  return 'exit' in state ? state : { admin: state.admin };
}

/**
 * @param {Deps} deps
 * @param {NodeJS.ProcessEnv} env
 * @param {'none' | 'invited' | 'active'} admin
 * @returns {number} exit code
 */
function seedDemo(deps, env, admin) {
  if (admin !== 'active') {
    deps.out('Dane demo pojawią się po aktywacji konta Administratora — uruchom ponownie `pnpm run dev` (lub `pnpm run dev:seed`).\n');
    return EXIT_OK;
  }
  const result = deps.runTool('seed', env);
  if (result.status === 3)
    return fail(deps, 'strażnik bazy odmawia (szczegóły wyżej)', 'popraw wskazane ustawienia; strażnik nie ma opcji --force.');
  if (result.status !== 0)
    return fail(deps, 'nie udało się utworzyć danych demo', 'sprawdź komunikat powyżej; powtórne uruchomienie jest bezpieczne.');
  const { created, existing } = lastJsonLine(result.stdout);
  deps.out(
    typeof created === 'number' && typeof existing === 'number'
      ? `Dane demo: utworzono ${String(created)}, już istniało ${String(existing)}.\n`
      : 'Dane demo przygotowane.\n',
  );
  return EXIT_OK;
}

/** @param {Deps} deps */
async function cleanup(deps) {
  deps.err('Zatrzymuję kontenery dev (dane zostają).\n');
  await deps.docker('down');
}

/** @param {Deps} deps */
export async function devCommand(deps) {
  if (!deps.stdinIsTTY || !deps.stdoutIsTTY) {
    deps.err(needTerminal('pnpm run dev'));
    return EXIT_USAGE;
  }
  const loaded = loadEnvironment(deps);
  if ('exit' in loaded) return loaded.exit;
  const { env } = loaded;

  deps.out('Start bazy i API (compose.dev.yaml) — pierwsze uruchomienie buduje obraz i może potrwać kilka minut…\n');
  const up = await deps.docker('up');
  if (up.error !== undefined || up.status !== 0) {
    const kind = classifyUpFailure(up);
    await cleanup(deps);
    if (kind === 'no-docker') return fail(deps, 'Docker nie jest zainstalowany', 'zainstaluj Docker Desktop.');
    if (kind === 'daemon') return fail(deps, 'Docker nie działa', 'uruchom Docker Desktop i spróbuj ponownie.');
    if (kind === 'port')
      return fail(
        deps,
        'port 3000 lub 5442 jest zajęty',
        'zamknij program, który go używa (albo wcześniejszą instancję), i spróbuj ponownie.',
      );
    return fail(deps, 'nie udało się uruchomić kontenerów dev', 'sprawdź komunikaty Dockera powyżej.');
  }

  const state = readState(deps, env);
  if ('exit' in state) {
    await cleanup(deps);
    return state.exit;
  }
  const administrator = await ensureAdministrator(deps, env, state.admin);
  if ('exit' in administrator) {
    await cleanup(deps);
    return administrator.exit;
  }
  const seeded = seedDemo(deps, env, administrator.admin);
  if (seeded !== EXIT_OK) {
    await cleanup(deps);
    return seeded;
  }

  deps.out(
    [
      '',
      'Środowisko lokalne działa:',
      `  Panel:  ${PANEL_URL}   (jedyny wspierany adres wejścia: localhost, nie 127.0.0.1)`,
      `  API:    ${API_URL}   (tylko przez panel pod /api)`,
      '  Baza:   127.0.0.1:5442   (evia_dev)',
      'Zatrzymanie: Ctrl+C (panel), potem pnpm run dev:stop (kontenery).',
      '',
      '',
    ].join('\n'),
  );
  return deps.runPanel(env);
}

/** @param {Deps} deps */
export async function adminCommand(deps) {
  if (!deps.stdinIsTTY || !deps.stdoutIsTTY) {
    deps.err(needTerminal('pnpm run dev:admin'));
    return EXIT_USAGE;
  }
  const loaded = loadEnvironment(deps);
  if ('exit' in loaded) return loaded.exit;
  const state = readState(deps, loaded.env);
  if ('exit' in state) return state.exit;
  const administrator = await ensureAdministrator(deps, loaded.env, state.admin);
  return 'exit' in administrator ? administrator.exit : EXIT_OK;
}

/** @param {Deps} deps */
export function seedCommand(deps) {
  const loaded = loadEnvironment(deps);
  if ('exit' in loaded) return loaded.exit;
  const state = readState(deps, loaded.env);
  if ('exit' in state) return state.exit;
  return seedDemo(deps, loaded.env, state.admin);
}

/** @param {Deps} deps */
export async function stopCommand(deps) {
  const result = await deps.docker('down');
  if (result.error !== undefined || result.status !== 0)
    return fail(deps, 'nie udało się zatrzymać kontenerów dev', 'sprawdź, czy Docker Desktop działa.');
  deps.out('Kontenery dev zatrzymane; dane bazy zostały (usuwa je dopiero pnpm run dev:reset).\n');
  return EXIT_OK;
}

/**
 * `down -v`: only after the guard, only from a terminal and only after typing the phrase (an agent cannot answer through a pipe).
 * @param {Deps} deps
 */
export async function resetCommand(deps) {
  if (!deps.stdinIsTTY || !deps.stdoutIsTTY) {
    deps.err('Odmowa: usunięcie danych wymaga terminala interaktywnego i ręcznego potwierdzenia. Nic nie zmieniono.\n');
    return EXIT_USAGE;
  }
  const loaded = loadEnvironment(deps);
  if ('exit' in loaded) return loaded.exit;
  deps.out(
    'UWAGA: usunę kontenery i wolumen bazy dev (compose.dev.yaml) — dane demo i konto Administratora zostaną utracone. Operacja jest NIEODWRACALNA.\n' +
      'Kontenery i wolumeny bramek (compose.yaml) nie są ruszane.\n',
  );
  const answer = await deps.ask(`Aby potwierdzić, wpisz dokładnie: ${RESET_PHRASE}\n> `);
  if (answer.trim() !== RESET_PHRASE) {
    deps.err('Odmowa: potwierdzenie nie zgadza się. Nic nie zmieniono.\n');
    return EXIT_PROBLEM;
  }
  const result = await deps.docker('downVolumes');
  if (result.error !== undefined || result.status !== 0)
    return fail(deps, 'nie udało się usunąć kontenerów i wolumenu dev', 'sprawdź, czy Docker Desktop działa.');
  deps.out('Usunięto kontenery i wolumen dev. Zacznij od nowa: pnpm run dev.\n');
  return EXIT_OK;
}
