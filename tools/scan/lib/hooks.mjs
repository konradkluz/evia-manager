// @ts-check
/**
 * gitleaks in git hooks (EVM-006 AC5, bramka 1, security-engineer A3), started by lefthook.yml:
 *   pre-commit → staged changes;  pre-push → every pushed range (never an empty range).
 * Fail closed: any non-zero result (a finding, Docker unavailable, a missing commit) rejects the commit or push.
 * Hooks can be skipped locally; the binding secret gate is CI.
 */
import { GITLEAKS_COMMON } from './steps.mjs';

const ZERO = /^0+$/;

/**
 * Ranges to scan from the pre-push stdin (`<local ref> <local sha> <remote ref> <remote sha>` per line).
 * A deleted ref is skipped; a new branch is scanned against origin/main (or its whole history without origin/main).
 * @param {string} input
 * @param {{ hasOriginMain: boolean }} context
 * @returns {string[]} git log ranges
 */
export function pushRanges(input, { hasOriginMain }) {
  return input
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields.length === 4)
    .flatMap(([, localSha = '', , remoteSha = '']) => {
      if (ZERO.test(localSha)) return [];
      if (ZERO.test(remoteSha)) return [hasOriginMain ? `origin/main..${localSha}` : localSha];
      return [`${remoteSha}..${localSha}`];
    });
}

/**
 * @typedef {object} HookIo
 * @property {import('./compose.mjs').Compose} compose
 * @property {string} stdin
 * @property {boolean} hasOriginMain
 * @property {(line: string) => void} log
 */

/**
 * @param {'pre-commit' | 'pre-push'} hook
 * @param {HookIo} io
 * @returns {number} exit code for git (0 = continue)
 */
export function runHook(hook, { compose, stdin, hasOriginMain, log }) {
  /** @type {string[][]} */
  const invocations =
    hook === 'pre-commit'
      ? [['git', '--pre-commit', '--staged', ...GITLEAKS_COMMON, '--exit-code', '1', '/repo']]
      : pushRanges(stdin, { hasOriginMain }).map((range) => ['git', ...GITLEAKS_COMMON, '--log-opts', range, '--exit-code', '1', '/repo']);
  for (const args of invocations) {
    const result = compose('scan-gitleaks', args, { capture: false });
    if (result.status !== 0) {
      log(
        `gitleaks (${hook}): odrzucono — wykryty sekret albo niedostępny Docker (kod ${String(result.status)}). ` +
          'Prawdziwy sekret: usuń go i unieważnij (docs/ops/rotacja-sekretow.md); fałszywy alarm: fingerprint w .gitleaksignore.',
      );
      return 1;
    }
  }
  log(`gitleaks (${hook}): brak sekretów (${invocations.length} ${hook === 'pre-push' ? 'zakresów' : 'skan indeksu'})`);
  return 0;
}
