// @ts-check
/**
 * diff-coverage — coverage of changed code (EVM-006 AC3; ADR-0014 leaves the tool to EVM-006).
 *   node tools/diff-coverage/cli.mjs          → table per file, exit 0 (≥ 90% or nothing measurable) / 1 (below)
 *   node tools/diff-coverage/cli.mjs clean    → removes stale lcov reports before the gate (W3b)
 * Exit code 2: usage or environment error. Only node:* modules — runs without installed dependencies (CI job `coverage`).
 * Reads only regular files (never follows symbolic links); git runs without a shell.
 */
import { spawnSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseNumstat, parseUnifiedDiff, unaccounted } from './diff.mjs';
import { evaluate, isSourceFile, meets } from './evaluate.mjs';
import { mergeCoverage, parseLcov } from './lcov.mjs';
import { CONTAINER_REPORTS, normalizeSource, workspaceOfReport } from './paths.mjs';

/** Changed-code threshold in percent (docs/process/testing-strategy.md → Progi). */
export const THRESHOLD = 90;
/** Single source of coverage exclusions (W3a). */
export const EXCLUSIONS_FILE = 'packages/config/coverage-exclusions.json';
const WORKSPACE_ROOTS = ['apps', 'packages', 'services', 'tools'];
/**
 * Options of both diff commands (the -U0 patch and --numstat). Explicit prefixes override diff.noprefix and
 * diff.mnemonicPrefix of the developer's git config, which would otherwise hide every file from the parser.
 */
const DIFF_OPTIONS = ['--no-color', '--no-ext-diff', '--no-textconv', '--find-renames', '--src-prefix=a/', '--dst-prefix=b/'];
const USAGE = 'Użycie: node tools/diff-coverage/cli.mjs [clean]';

class ToolError extends Error {}

/**
 * @typedef {object} Io
 * @property {string} cwd
 * @property {{ write(chunk: string): unknown }} stdout
 * @property {{ write(chunk: string): unknown }} stderr
 */

/**
 * @param {string[]} argv
 * @param {Io} io
 * @returns {number} exit code
 */
export function main(argv, io) {
  try {
    if (argv.length === 0) return check(io);
    if (argv.length === 1 && argv[0] === 'clean') return clean(io);
    io.stderr.write(`${USAGE}\n`);
    return 2;
  } catch (error) {
    if (!(error instanceof ToolError)) throw error;
    io.stderr.write(`diff-coverage: ${oneLine(error.message)}\n`);
    return 2;
  }
}

/** @param {Io} io */
function check(io) {
  const root = repositoryRoot(io.cwd);
  const exclude = readExclusions(root);
  const base = resolveBase(root);
  const range = [...DIFF_OPTIONS, base];
  const changed = parseUnifiedDiff(git(root, ['-c', 'core.quotePath=false', 'diff', '-U0', ...range]));
  // Fail closed: every changed source file must be fully read from the patch, or the gate cannot judge it.
  const missed = unaccounted(changed, parseNumstat(git(root, ['diff', '--numstat', '-z', ...range]))).filter((path) =>
    isSourceFile(path, exclude),
  );
  if (missed.length > 0) {
    throw new ToolError(
      `nie odczytano zmienionych linii plików źródłowych z git diff: ${missed.join(', ')} — bez nich bramka nie ocenia pokrycia (plik binarny wg .gitattributes albo nieobsługiwany zapis ścieżki)`,
    );
  }
  for (const path of git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) {
    const lines = readLines(root, path);
    if (lines)
      changed.set(
        path,
        lines.map((_, index) => index + 1),
      );
  }
  const entries = findReports(root).flatMap((report) => {
    const text = readRegularFile(join(root, report));
    const workspace = workspaceOfReport(report);
    return parseLcov(text ?? '').flatMap((record) => {
      const file = normalizeSource(record.source, { root, workspace });
      return file === null ? [] : [{ file, lines: record.lines, branches: record.branches }];
    });
  });
  const result = evaluate({
    changed,
    coverage: mergeCoverage(entries),
    exclude,
    readLines: (path) => readLines(root, path),
    threshold: THRESHOLD,
  });
  io.stdout.write(`${render(result, base)}\n`);
  return result.passed ? 0 : 1;
}

/** @param {Io} io */
function clean(io) {
  const root = repositoryRoot(io.cwd);
  const reports = findReports(root);
  for (const report of reports) rmSync(join(root, report));
  io.stdout.write(`diff-coverage: usunięto ${reports.length} starych raportów lcov\n`);
  return 0;
}

/**
 * @param {import('./evaluate.mjs').Evaluation} result
 * @param {string} base
 */
function render(result, base) {
  const header = `Pokrycie zmienionego kodu względem ${base.slice(0, 12)} (próg ${THRESHOLD}% linii i gałęzi)`;
  if (!result.measurable) {
    return `${header}\nBrak mierzalnych zmian w kodzie źródłowym (apps/, packages/, services/, tools/) — bramka zielona.`;
  }
  const rows = result.files.map((file) => {
    const missing = file.reported ? file.uncovered.join(', ') : `brak raportu pokrycia — ${file.uncovered.join(', ')}`;
    const branches = file.uncoveredBranches.length > 0 ? ` · gałęzie: ${file.uncoveredBranches.join(', ')}` : '';
    return `| ${oneLine(file.path)} | ${ratio(file.lines)} | ${ratio(file.branches)} | ${missing}${branches} |`;
  });
  const failed = [meets(result.lines, THRESHOLD) ? '' : 'linie', meets(result.branches, THRESHOLD) ? '' : 'gałęzie'].filter(Boolean);
  const verdict = result.passed
    ? 'Wynik: ZIELONY — pokrycie zmienionego kodu spełnia próg'
    : `Wynik: CZERWONY — pokrycie zmienionego kodu poniżej ${THRESHOLD}% (${failed.join(', ')}); dopisz testy dla wskazanych linii`;
  return [
    header,
    '| Plik | Linie | Gałęzie | Niepokryte linie |',
    '|---|---|---|---|',
    ...rows,
    `Razem: linie ${ratio(result.lines)} · gałęzie ${ratio(result.branches)}`,
    verdict,
  ].join('\n');
}

/** @param {import('./evaluate.mjs').Count} count */
function ratio({ total, covered }) {
  if (total === 0) return '—';
  return `${covered}/${total} (${((covered * 100) / total).toFixed(1).replace('.', ',')}%)`;
}

/**
 * Untrusted text (file names, git messages) is printed on one line without control characters, so it can never
 * start a new log line with an injected `::` workflow command.
 * @param {string} text
 */
export const oneLine = (text) => text.replace(/\p{Cc}/gu, '?');

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (result.error) throw new ToolError(`nie można uruchomić git (${result.error.message})`);
  if (result.status !== 0)
    throw new ToolError(`git ${args.filter((arg) => !arg.startsWith('-c')).join(' ')}: ${result.stderr.trim().split('\n')[0] ?? ''}`);
  return result.stdout;
}

/**
 * @param {string} cwd
 * @param {string} ref
 */
function tryRevParse(cwd, ref) {
  const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd, encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** @param {string} cwd */
function repositoryRoot(cwd) {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new ToolError('katalog roboczy nie jest repozytorium git — uruchom polecenie w klonie repozytorium');
  return result.stdout.trim();
}

/**
 * Base of the comparison: merge-base with origin/main (local fallback: main); on main itself — the previous commit.
 * @param {string} root
 */
function resolveBase(root) {
  const head = tryRevParse(root, 'HEAD');
  const mainRef = ['refs/remotes/origin/main', 'refs/heads/main'].find((ref) => tryRevParse(root, ref) !== null);
  if (head === null || mainRef === undefined) {
    throw new ToolError('brak gałęzi main ani origin/main (albo commitów) — pobierz ją: git fetch origin main');
  }
  if (head === tryRevParse(root, mainRef)) {
    return (
      tryRevParse(root, 'HEAD^') ??
      spawnSync('git', ['hash-object', '-t', 'tree', '--stdin'], { cwd: root, input: '', encoding: 'utf8' }).stdout.trim()
    );
  }
  return git(root, ['merge-base', 'HEAD', mainRef]).trim();
}

/** @param {string} root */
function readExclusions(root) {
  const text = readRegularFile(join(root, EXCLUSIONS_FILE));
  try {
    /** @type {unknown} */
    const data = JSON.parse(text ?? '');
    const list = /** @type {{ exclude?: unknown }} */ (data).exclude;
    if (!Array.isArray(list)) throw new Error('missing exclude list');
    return /** @type {unknown[]} */ (list).map((entry) => {
      const { pattern, reason } = /** @type {{ pattern?: unknown, reason?: unknown }} */ (entry);
      if (typeof pattern !== 'string' || typeof reason !== 'string' || reason.trim() === '')
        throw new Error('entry without pattern or reason');
      return pattern;
    });
  } catch (error) {
    throw new ToolError(`niepoprawny ${EXCLUSIONS_FILE}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Report locations: `<apps|packages|services|tools>/<workspace>/coverage/lcov.info` and every `lcov.info` below
 * `coverage/backend-tests/` (reports copied out of the container). Symbolic links are never followed.
 * @param {string} root
 * @returns {string[]} repository paths
 */
function findReports(root) {
  const reports = WORKSPACE_ROOTS.flatMap((dir) =>
    directories(join(root, dir))
      .map((name) => `${dir}/${name}/coverage/lcov.info`)
      .filter((path) => isRegularFile(join(root, path))),
  );
  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of entriesOf(join(root, dir))) {
      const path = `${dir}${entry.name}`;
      if (entry.isDirectory() && entry.name !== 'node_modules') walk(`${path}/`);
      else if (entry.isFile() && entry.name === 'lcov.info') reports.push(path);
    }
  };
  walk(CONTAINER_REPORTS);
  return reports.sort();
}

/** @param {string} dir */
function entriesOf(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** @param {string} dir */
const directories = (dir) =>
  entriesOf(dir)
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

/** @param {string} path */
function isRegularFile(path) {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

/** @param {string} path */
function readRegularFile(path) {
  return isRegularFile(path) ? readFileSync(path, 'utf8') : null;
}

/**
 * @param {string} root
 * @param {string} path
 */
function readLines(root, path) {
  const text = readRegularFile(join(root, path));
  return text === null ? null : text.replace(/\n$/, '').split('\n');
}
