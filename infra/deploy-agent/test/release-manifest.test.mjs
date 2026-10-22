// @ts-check
/**
 * The jq check of the "Release manifest" step of the publish job, evaluated for real (EVM-007 AC2). The line is taken
 * verbatim from .github/workflows/ci.yml (a `run: |` block keeps backslashes literally, so it is the exact shell text) and
 * run with bash and jq on sample manifests. A jq STRING literal needs `\\.`; `\.` is a compile error that only shows on
 * the first publish run. Run: docker compose -f compose.yaml run --rm deploy-sh-tests (the container has jq; not run
 * natively on Windows).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CI = new URL('../../../.github/workflows/ci.yml', import.meta.url).pathname;
const COMMIT = 'a'.repeat(40);
const DIGEST = `sha256:${'b'.repeat(64)}`;
const GOOD = {
  schemaVersion: 1,
  commit: COMMIT,
  images: { api: `ghcr.io/konradkluz/evia-api@${DIGEST}`, web: `ghcr.io/konradkluz/evia-web@${DIGEST}` },
  compose: 'infra/runtime/compose.staging.yaml',
};

/** The validating line of the step, exactly as written in ci.yml. */
function validationLine() {
  const lines = readFileSync(CI, 'utf8')
    .split('\n')
    .filter((line) => /^\s*jq -e --arg commit .*release\/release-manifest\.json > \/dev\/null\s*$/.test(line));
  assert.equal(lines.length, 1, 'exactly one manifest validation line in ci.yml');
  return /** @type {string} */ (lines[0]).trim();
}

/** Runs the line against `manifest`; returns jq's exit status and stderr. */
function validate(/** @type {unknown} */ manifest, commit = COMMIT) {
  const dir = mkdtempSync(join(tmpdir(), 'manifest-'));
  mkdirSync(join(dir, 'release'));
  writeFileSync(join(dir, 'release', 'release-manifest.json'), JSON.stringify(manifest));
  const run = spawnSync('bash', ['-c', validationLine()], {
    cwd: dir,
    env: { PATH: process.env['PATH'], EVIA_RELEASE_COMMIT: commit },
    encoding: 'utf8',
  });
  return { status: run.status, stderr: run.stderr };
}

describe('EVM-007 AC2: the release manifest check of the publish job', () => {
  it('accepts a manifest of the commit with both images by digest in ghcr.io/konradkluz', () => {
    const result = validate(GOOD);
    assert.deepEqual(result, { status: 0, stderr: '' });
  });

  it('rejects a commit that is not 40 lowercase hex digits (even when it equals EVIA_RELEASE_COMMIT)', () => {
    for (const commit of ['a'.repeat(39), 'a'.repeat(41), 'A'.repeat(40)]) {
      assert.equal(validate({ ...GOOD, commit }, commit).status, 1, commit);
    }
  });

  it('rejects a manifest of another commit than the release', () => {
    assert.equal(validate({ ...GOOD, commit: 'c'.repeat(40) }).status, 1);
  });

  it('rejects an image by tag instead of digest, a short digest and a foreign registry or repository', () => {
    const bad = [
      'ghcr.io/konradkluz/evia-api:sha-' + COMMIT,
      `ghcr.io/konradkluz/evia-api@sha256:${'b'.repeat(63)}`,
      `docker.io/konradkluz/evia-api@${DIGEST}`,
      `ghcr.io/other/evia-api@${DIGEST}`,
      `ghcr.io/konradkluz/evia-worker@${DIGEST}`,
      `ghcrXio/konradkluz/evia-api@${DIGEST}`,
    ];
    for (const api of bad) {
      const result = validate({ ...GOOD, images: { ...GOOD.images, api } });
      assert.equal(result.status, 1, api);
      assert.equal(result.stderr, '', `${api}: a plain false, not a jq compile error`);
    }
  });
});
