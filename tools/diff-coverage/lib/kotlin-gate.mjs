// @ts-check
/**
 * Local and CI gate of the Kotlin upload engine (EVM-109 AC5): `pnpm run gate:kotlin` = `node tools/diff-coverage/cli.mjs kotlin-gate`.
 * Runs, in the Gradle project of the engine, ktlint, the JUnit tests on the JVM (no emulator, no `expo prebuild`), the Kover report with
 * the threshold of `coverage-thresholds.json` (`engine`) and the check of the production dependencies; then converts the Kover XML into
 * `coverage/mobile-kotlin/lcov.info` for `coverage:diff` (the same place as the CI artifact `lcov-mobile-kotlin`).
 * Never a silent skip: a missing JDK 17 or a missing wrapper is exit 2, a red Gradle step is its exit code. Always stops the Gradle
 * daemons at the end. Every argument of every process is a constant (nothing from the environment or the command line reaches a command).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { koverToLcov } from './kover.mjs';

export const ENGINE_DIRECTORY = 'apps/mobile/modules/evia-upload/engine';
export const SOURCE_ROOT = `${ENGINE_DIRECTORY}/src/main/kotlin`;
export const LCOV_OUTPUT = 'coverage/mobile-kotlin/lcov.info';
const KOVER_REPORT = `${ENGINE_DIRECTORY}/build/reports/kover/report.xml`;
/** One Gradle invocation; the order is the order of the checks (fail fast). */
export const GRADLE_TASKS = Object.freeze([
  '--no-daemon',
  'ktlintCheck',
  'test',
  'koverXmlReport',
  'koverVerify',
  'checkProductionDependencies',
]);
const REQUIRED_JAVA = 17;

/**
 * @typedef {object} Process
 * @property {number | null} status
 * @property {string} stdout
 * @property {string} stderr
 * @property {Error} [error]
 */

/**
 * @typedef {object} GateDeps
 * @property {string} root repository root
 * @property {NodeJS.ProcessEnv} env
 * @property {string} platform
 * @property {(command: string, args: string[], options: { cwd: string, env: NodeJS.ProcessEnv }) => Process} run
 * @property {{ write(chunk: string): unknown }} stdout
 * @property {{ write(chunk: string): unknown }} stderr
 */

/** @type {GateDeps['run']} */
export const realRun = (command, args, options) => {
  const result = spawnSync(command, args, { ...options, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, ...(result.error ? { error: result.error } : {}) };
};

/** @param {GateDeps} deps @returns {number} exit code */
export function kotlinGate(deps) {
  const { root, env, platform, stdout, stderr } = deps;
  const engine = join(root, ENGINE_DIRECTORY);
  const lcov = join(root, LCOV_OUTPUT);
  const windows = platform === 'win32';
  const wrapper = join(engine, windows ? 'gradlew.bat' : 'gradlew');
  if (!existsSync(wrapper)) {
    stderr.write(`gate:kotlin: brak wrappera Gradle (${ENGINE_DIRECTORY}/${windows ? 'gradlew.bat' : 'gradlew'}) — kod 2\n`);
    return 2;
  }
  const java = javaExecutable(env, windows);
  const version = deps.run(java, ['-version'], { cwd: root, env });
  const major = /version "(?:1\.)?(\d+)/.exec(`${version.stderr}\n${version.stdout}`)?.[1];
  if (version.error || version.status !== 0 || Number(major) !== REQUIRED_JAVA) {
    stderr.write(
      `gate:kotlin: wymagany JDK ${REQUIRED_JAVA} (ustaw JAVA_HOME na JDK ${REQUIRED_JAVA}, np. Corretto ${REQUIRED_JAVA}); znaleziono: ${major === undefined ? 'brak lub nieczytelna wersja' : `JDK ${major}`} — bramka Kotlin nigdy nie jest pomijana, kod 2\n`,
    );
    return 2;
  }
  // A stale report must never pass for a fresh one.
  rmSync(lcov, { force: true });
  const gradle = (/** @type {string[]} */ args) =>
    windows
      ? deps.run('cmd.exe', ['/d', '/c', 'call', wrapper, ...args], { cwd: engine, env })
      : deps.run(wrapper, args, { cwd: engine, env });
  let code;
  try {
    const result = gradle([...GRADLE_TASKS]);
    stdout.write(result.stdout);
    stderr.write(result.stderr);
    code = result.error ? 2 : (result.status ?? 2);
    if (result.error) stderr.write(`gate:kotlin: nie uruchomiono Gradle (${result.error.message})\n`);
    if (code === 0) code = convert(deps, root, lcov);
  } finally {
    // The daemons of Gradle and Kotlin must not outlive the gate (RAM, locked files on Windows).
    const stop = gradle(['--stop']);
    if (stop.status !== 0) stderr.write('gate:kotlin: ostrzeżenie — nie zatrzymano demonów Gradle (gradlew --stop)\n');
  }
  stdout.write(code === 0 ? `gate:kotlin: zielone — raport ${LCOV_OUTPUT}\n` : `gate:kotlin: CZERWONE (kod ${code})\n`);
  return code;
}

/**
 * @param {GateDeps} deps
 * @param {string} root
 * @param {string} lcovPath
 */
function convert(deps, root, lcovPath) {
  const reportPath = join(root, KOVER_REPORT);
  if (!existsSync(reportPath)) {
    deps.stderr.write(`gate:kotlin: Gradle zakończył się sukcesem, ale nie ma raportu Kover (${KOVER_REPORT}) — kod 2\n`);
    return 2;
  }
  try {
    const text = koverToLcov(readFileSync(reportPath, 'utf8'), SOURCE_ROOT);
    mkdirSync(dirname(lcovPath), { recursive: true });
    writeFileSync(lcovPath, text);
    return 0;
  } catch (error) {
    deps.stderr.write(
      `gate:kotlin: nie przekonwertowano raportu Kover (${error instanceof Error ? error.message : String(error)}) — kod 2\n`,
    );
    return 2;
  }
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {boolean} windows
 */
function javaExecutable(env, windows) {
  const home = env['JAVA_HOME'];
  if (home === undefined || home === '') return 'java';
  return join(home, 'bin', windows ? 'java.exe' : 'java');
}
