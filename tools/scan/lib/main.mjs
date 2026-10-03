// @ts-check
/**
 * Security scans of EVM-006 (SR-SUPPLY-07, SR-SUPPLY-10) — one entry point for `pnpm run scan`, the CI jobs and
 * the git hooks. Runs without installed dependencies (only node:*); Docker only through compose.mjs.
 *   all       → security + licenses + self-test (local `pnpm run scan`; licenses need backend-install first)
 *   security  → secrets, SAST, dependencies, configuration, workflows, Renovate config + self-test (CI job security)
 *   licenses  → licenses of the Linux node_modules from the bt-work volume (CI job backend, after backend-install)
 *   selftest  → every scanner must fail on its fixture with the expected identifier
 *   hook pre-commit | hook pre-push → gitleaks for lefthook.yml
 * Exit codes: 0 — all green, 1 — a gate is red (or a tool failed), 2 — usage error.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { composeRunner } from './compose.mjs';
import { runHook } from './hooks.mjs';
import { writeFixtures } from './selftest.mjs';
import { LICENSE_STEPS, lastLines, SECURITY_STEPS, SELFTEST_STEPS } from './steps.mjs';

/** Scan reports and self-test fixtures (ignored by git; document-lifecycle.md → "Pliki robocze"). */
export const SCANS_DIR = '.scratch/scans';
const USAGE = 'Użycie: node tools/scan/cli.mjs all | security | licenses | selftest | hook pre-commit | hook pre-push';

const PLANS = {
  all: [...SECURITY_STEPS, ...LICENSE_STEPS, ...SELFTEST_STEPS],
  security: [...SECURITY_STEPS, ...SELFTEST_STEPS],
  licenses: LICENSE_STEPS,
  selftest: SELFTEST_STEPS,
};

/**
 * @typedef {object} Io
 * @property {string} cwd repository root (where compose.yaml is)
 * @property {(line: string) => void} stdout
 * @property {(line: string) => void} stderr
 * @property {import('./compose.mjs').Compose} compose
 * @property {() => string} stdin
 * @property {() => boolean} hasOriginMain
 */

/**
 * Untrusted text (findings, tool output) on one line, without control characters (no injected `::` commands).
 * @param {string} text
 */
export const oneLine = (text) => text.replace(/\p{Cc}/gu, '?');

/**
 * @param {string[]} argv
 * @param {Io} io
 * @returns {number}
 */
export function main(argv, io) {
  if (!existsSync(join(io.cwd, 'compose.yaml'))) {
    io.stderr('scan: brak compose.yaml — uruchom polecenie z katalogu głównego repozytorium');
    return 2;
  }
  if (argv[0] === 'hook' && argv.length === 2 && (argv[1] === 'pre-commit' || argv[1] === 'pre-push')) {
    return runHook(argv[1], {
      compose: io.compose,
      stdin: argv[1] === 'pre-push' ? io.stdin() : '',
      hasOriginMain: io.hasOriginMain(),
      log: io.stderr,
    });
  }
  const plan = argv.length === 1 ? PLANS[/** @type {keyof typeof PLANS} */ (argv[0])] : undefined;
  if (plan === undefined) {
    io.stderr(USAGE);
    return 2;
  }
  prepare(
    io.cwd,
    plan.some((step) => step.id.startsWith('selftest-')),
  );
  const outcomes = plan.map((step) => ({ step, verdict: runStep(step, io) }));
  io.stdout(`Skany bezpieczeństwa (${argv[0]}) — raporty w ${SCANS_DIR}/`);
  io.stdout('| Skan | Wynik | Podsumowanie |');
  io.stdout('|---|---|---|');
  for (const { step, verdict } of outcomes) {
    io.stdout(`| ${step.label} | ${verdict.passed ? 'OK' : 'CZERWONY'} | ${oneLine(verdict.summary)} |`);
  }
  const failed = outcomes.filter(({ verdict }) => !verdict.passed);
  for (const { step, verdict } of failed) {
    io.stdout(`- ${step.id}:`);
    for (const problem of verdict.problems) io.stdout(`  - ${oneLine(problem)}`);
  }
  io.stdout(
    failed.length === 0
      ? 'Wynik: ZIELONY — wszystkie skany i samotesty przeszły'
      : `Wynik: CZERWONY — ${failed.length} z ${outcomes.length} etapów`,
  );
  return failed.length === 0 ? 0 : 1;
}

/**
 * Output directory writable for the scanner containers (uid 65534 in CI, where the runner user differs).
 * @param {string} root
 * @param {boolean} withFixtures
 */
function prepare(root, withFixtures) {
  const dir = join(root, SCANS_DIR);
  mkdirSync(dir, { recursive: true });
  if (withFixtures) writeFixtures(root);
  mkdirSync(join(dir, 'selftest'), { recursive: true });
  if (process.platform !== 'win32') {
    chmodSync(dir, 0o777);
    chmodSync(join(dir, 'selftest'), 0o777);
  }
}

/**
 * @param {import('./steps.mjs').Step} step
 * @param {Io} io
 * @returns {import('./reports.mjs').Verdict}
 */
export function runStep(step, io) {
  const reportPath = step.report !== null && step.report !== 'stdout' ? join(io.cwd, SCANS_DIR, step.report) : null;
  if (reportPath !== null) rmSync(reportPath, { force: true });
  const targets = step.targets?.(io.cwd);
  if (targets?.length === 0) return { passed: false, summary: 'pusty cel skanu (brak plików do sprawdzenia)', problems: [] };
  const run = io.compose(step.service, [...step.args, ...(targets ?? [])]);
  if (run.error !== undefined) {
    return { passed: false, summary: `nie uruchomiono Dockera (${run.error.message})`, problems: ['sprawdź, czy Docker Desktop działa'] };
  }
  if (run.status === null || !step.okExit.includes(run.status)) {
    return { passed: false, summary: `błąd narzędzia (kod ${String(run.status)})`, problems: lastLines(`${run.stdout}\n${run.stderr}`) };
  }
  /** @type {unknown} */
  let report = null;
  if (step.report !== null) {
    try {
      report = JSON.parse(reportPath === null ? run.stdout : readFileSync(reportPath, 'utf8'));
    } catch {
      return { passed: false, summary: 'brak raportu albo niepoprawny JSON', problems: lastLines(`${run.stdout}\n${run.stderr}`) };
    }
  }
  return step.verdict(report, run);
}

/**
 * @param {string} cwd
 * @returns {Io}
 */
export function defaultIo(cwd) {
  return {
    cwd,
    stdout: (line) => {
      console.log(line);
    },
    stderr: (line) => {
      console.error(line);
    },
    compose: composeRunner(cwd),
    stdin: () => readFileSync(0, 'utf8'),
    hasOriginMain: () => spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'], { cwd }).status === 0,
  };
}
