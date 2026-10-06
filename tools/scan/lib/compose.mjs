// @ts-check
/**
 * The only place in tools/ that starts Docker (security-engineer A6, RR-03): always
 * `docker compose -f compose.yaml run --rm <service from compose.yaml> …` — never `docker run`, `exec` or `cp`.
 * tools/repo-policy checks that SERVICES equals the services of compose.yaml and that no other tool spawns docker.
 */
import { spawnSync } from 'node:child_process';

export const SERVICES = Object.freeze([
  'backend-install',
  'backend-tests',
  'postgres',
  'scan-gitleaks',
  'scan-semgrep',
  'scan-osv',
  'scan-trivy',
  'scan-zizmor',
  'scan-actionlint',
  'renovate-validate',
]);

/**
 * @param {string} service
 * @param {string[]} args
 * @returns {string[]} arguments of the docker CLI
 */
export function composeArgs(service, args) {
  if (!SERVICES.includes(service)) throw new Error(`unknown compose service: ${service}`);
  return ['compose', '-f', 'compose.yaml', 'run', '--rm', service, ...args];
}

/** @typedef {{ status: number | null, stdout: string, stderr: string, error?: Error | undefined }} RunResult */
/** @typedef {(service: string, args: string[], options?: { capture?: boolean }) => RunResult} Compose */

/**
 * Runs a compose service from the repository root (cwd). Captured output is returned; otherwise it is shown live.
 * @param {string} cwd
 * @returns {Compose}
 */
export function composeRunner(cwd) {
  return (service, args, { capture = true } = {}) => {
    const result = spawnSync('docker', composeArgs(service, args), {
      cwd,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      windowsHide: true,
    });
    // With stdio 'inherit' the output is not captured (null at run time).
    const output = /** @type {{ stdout: string | null, stderr: string | null }} */ (result);
    return { status: result.status, stdout: output.stdout ?? '', stderr: output.stderr ?? '', error: result.error };
  };
}
