// @ts-check
/**
 * Command line of the document lifecycle validator (EVM-012):
 *   check [--list] [--today YYYY-MM-DD]       → exit 0 (no errors) / 1 (errors) / 2 (usage, environment)
 *   cleanup-report <M#> [--today YYYY-MM-DD]  → exit 0 (report printed) / 2
 * All side effects go through `io`, so the tests run it in-process with a fixed clock and environment.
 */
import { inspect, parseArgs } from 'node:util';
import { analyze } from './analyze.mjs';
import { buildCleanupReport } from './cleanup.mjs';
import { loadConfig } from './config.mjs';
import { isValidIsoDate, todayInZone } from './dates.mjs';
import { errorMessage, ToolError } from './errors.mjs';
import { formatCheck, formatCleanupReport, USAGE } from './format.mjs';
import { loadRepository } from './repository.mjs';
import { quote } from './text.mjs';

/** Exit codes (policy → „Wynik i kody wyjścia”). */
export const EXIT = Object.freeze({ ok: 0, findings: 1, usage: 2 });

const POWERSHELL_HINT =
  "w Windows PowerShell 5.1 podaj '--' w cudzysłowie (npm run docs:check '--' --list) albo uruchom node tools/docs-lifecycle/cli.mjs …";

/**
 * @typedef {object} Io
 * @property {string} cwd
 * @property {NodeJS.ProcessEnv} env passed to every git call (finding G)
 * @property {() => Date} now clock; „today” = its date in Europe/Warsaw
 * @property {{ write(chunk: string): unknown }} stdout
 * @property {{ write(chunk: string): unknown }} stderr
 */

/**
 * @typedef {object} CliOptions
 * @property {boolean} help
 * @property {'check' | 'cleanup-report' | null} command
 * @property {string | null} target M# for cleanup-report
 * @property {string | null} today override of „today”
 * @property {boolean} list
 */

/**
 * @param {string[]} argv arguments after the script name
 * @returns {CliOptions}
 */
export function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: true,
      options: { today: { type: 'string' }, list: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
    });
  } catch (error) {
    throw new ToolError(`niepoprawne argumenty (${errorMessage(error)})`);
  }
  const { values, positionals } = parsed;
  if (values.help === true) return { help: true, command: null, target: null, today: null, list: false };
  const [command, ...rest] = positionals;
  if (command === 'check') {
    if (rest.length !== 0) {
      throw new ToolError(`polecenie check nie przyjmuje argumentów pozycyjnych (otrzymano: ${rest.join(' ')}) — ${POWERSHELL_HINT}`);
    }
  } else if (command === 'cleanup-report') {
    if (rest.length !== 1) {
      throw new ToolError(
        `polecenie cleanup-report wymaga dokładnie jednego kamienia milowego, np. npm run docs:cleanup -- M0 (otrzymano: ${rest.length}) — ${POWERSHELL_HINT}`,
      );
    }
    if (values.list === true) throw new ToolError('opcja --list dotyczy tylko polecenia check');
  } else {
    throw new ToolError(command === undefined ? 'brak polecenia (check albo cleanup-report)' : `nieznane polecenie ${quote(command)} — dostępne: check, cleanup-report`);
  }
  const today = values.today ?? null;
  if (today !== null && !isValidIsoDate(today)) {
    throw new ToolError(`niepoprawna data w --today: ${quote(today)} — wymagany format YYYY-MM-DD`);
  }
  return { help: false, command, target: rest[0] ?? null, today, list: values.list === true };
}

/**
 * @param {string[]} argv
 * @param {Io} io
 * @returns {number} exit code
 */
export function main(argv, io) {
  try {
    return run(argv, io);
  } catch (error) {
    if (error instanceof ToolError) {
      io.stderr.write(`Nie można wykonać polecenia: ${error.message}\nPomoc: node tools/docs-lifecycle/cli.mjs --help\n`);
    } else {
      io.stderr.write(`Nieoczekiwany błąd narzędzia: ${inspect(error)}\n`);
    }
    return EXIT.usage;
  }
}

/**
 * @param {string[]} argv
 * @param {Io} io
 * @returns {number}
 */
function run(argv, io) {
  const options = parseCli(argv);
  if (options.help) {
    io.stdout.write(USAGE);
    return EXIT.ok;
  }
  const config = loadConfig();
  const repository = loadRepository({ cwd: io.cwd, env: io.env, config });
  const analysis = analyze(repository, { config, today: options.today ?? todayInZone(io.now()) });
  if (options.command === 'check') {
    io.stdout.write(formatCheck(analysis, { list: options.list, policy: config.policy }));
    return analysis.errorCount > 0 ? EXIT.findings : EXIT.ok;
  }
  const target = String(options.target);
  if (!analysis.milestones.includes(target)) {
    throw new ToolError(`nieznany kamień milowy ${quote(target)} — dozwolone: ${analysis.milestones.join(', ')}`);
  }
  io.stdout.write(formatCleanupReport(buildCleanupReport(analysis, target)));
  return EXIT.ok;
}
