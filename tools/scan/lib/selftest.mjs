// @ts-check
/**
 * Scanner self-test (EVM-006 p. 7, security-engineer A4): every scanner must turn red on a fixture built for it,
 * and the report must contain the expected identifier — a non-zero exit code alone is not enough, because a crash
 * or a missing network also gives one. Detects a silently disabled gate (e.g. changed flags in a new tool version).
 * Fixtures are synthetic and generated at run time in .scratch/scans/selftest (ignored by git, never scanned by the
 * regular scans — W7). The synthetic secret is assembled from fragments so that no secret literal exists in the repo.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Host directory of the fixtures; the scanners see it as /out/selftest. */
export const SELFTEST_DIR = '.scratch/scans/selftest';

const ALPHANUMERIC = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** A random string in the shape of a GitHub token — synthetic, never valid. */
export function syntheticGithubToken() {
  const body = [...randomBytes(36)].map((byte) => ALPHANUMERIC[byte % ALPHANUMERIC.length]).join('');
  return ['gh', 'p_', body].join('');
}

/**
 * Minimal pnpm lockfile (v9) with one dependency.
 * @param {string} name
 * @param {string} version
 */
const LOCKFILE = (name, version) =>
  [
    "lockfileVersion: '9.0'",
    '',
    'settings:',
    '  autoInstallPeers: true',
    '  excludeLinksFromLockfile: false',
    '',
    'importers:',
    '',
    '  .:',
    '    dependencies:',
    `      ${name}:`,
    `        specifier: ${version}`,
    `        version: ${version}`,
    '',
    'packages:',
    '',
    `  ${name}@${version}:`,
    '    resolution: {integrity: sha512-c2VsZnRlc3Q=}',
    '',
    'snapshots:',
    '',
    `  ${name}@${version}: {}`,
    '',
  ].join('\n');

/**
 * Fixture files, relative to the self-test directory.
 * @returns {Record<string, string>}
 */
export function fixtures() {
  return {
    'gitleaks/selftest-config.txt': `# synthetic self-test value (EVM-006), never a real credential\ngithub_token = "${syntheticGithubToken()}"\n`,
    'osv/pnpm-lock.yaml': LOCKFILE('lodash', '4.17.20'),
    'trivy-config/Dockerfile': 'FROM alpine:3.20\nRUN echo "self-test image without a USER instruction"\n',
    'license/package.json':
      '{ "name": "selftest", "version": "1.0.0", "private": true, "dependencies": { "selftest-gpl-fixture": "1.0.0" } }\n',
    'license/pnpm-lock.yaml': LOCKFILE('selftest-gpl-fixture', '1.0.0'),
    'license/node_modules/.pnpm/selftest-gpl-fixture@1.0.0/node_modules/selftest-gpl-fixture/package.json':
      '{ "name": "selftest-gpl-fixture", "version": "1.0.0", "license": "GPL-3.0-only" }\n',
    'zizmor/.github/workflows/selftest.yml': [
      'name: selftest',
      'on:',
      '  pull_request_target:',
      'permissions: {}',
      'jobs:',
      '  vulnerable:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: echo "${{ github.event.pull_request.title }}"',
      '',
    ].join('\n'),
  };
}

/**
 * Recreates the fixtures under root/SELFTEST_DIR.
 * @param {string} root repository root
 */
export function writeFixtures(root) {
  const base = join(root, SELFTEST_DIR);
  rmSync(base, { recursive: true, force: true });
  for (const [path, content] of Object.entries(fixtures())) {
    const target = join(base, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}
