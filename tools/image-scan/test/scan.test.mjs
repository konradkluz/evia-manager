// @ts-check
/**
 * EVM-153 AC4 / AC4b: the image scan outside publish, on a stand-in of Docker and Trivy (no network, no containers).
 * Every planned image is built/pulled, checked for linux/arm64, saved and scanned with the Trivy command of bramka 6; a finding,
 * a wrong platform or a scanner error is red; the output never carries a secret match.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILT_IMAGES,
  RELEASE_IMAGES,
  TRIVY_VULN_FLAGS,
  hasSuppressed,
  infraName,
  planImages,
  runFromRepository,
  runScan,
  secretArgs,
  secretLines,
  vulnArgs,
  vulnerabilityLines,
} from '../lib/scan.mjs';

const DIGEST = 'a'.repeat(64);
const INFRA = {
  images: {
    caddy: `caddy:2.11.9-alpine@sha256:${DIGEST}`,
    clamav: `clamav/clamav-debian:1.5.4@sha256:${DIGEST}`,
  },
};
const OLD = process.cwd();
/** @type {string} */
let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'image-scan-'));
  process.chdir(dir);
});
afterEach(() => {
  process.chdir(OLD);
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Stand-in of docker: platform per reference, failing commands by a predicate, reports written where Trivy would write them.
 * @param {{ platform?: (reference: string) => string, failOn?: (args: readonly string[]) => boolean, reports?: Record<string, unknown>, failPull?: boolean }} [spec]
 */
function fakeDocker(spec = {}) {
  /** @type {string[][]} */
  const calls = [];
  /** @type {string[]} */
  const lines = [];
  /** @type {import('../lib/scan.mjs').Exec} */
  const exec = (command, args, options) => {
    calls.push([command, ...args]);
    if (spec.failOn?.(args)) {
      const output = args[args.indexOf('--output') + 1];
      if (output !== undefined && spec.reports?.[output] !== undefined)
        writeFileSync(`.scratch/scans/${output.replace('/out/', '')}`, JSON.stringify(spec.reports[output]));
      return { status: 1, stdout: '' };
    }
    if (args[0] === 'pull' && spec.failPull) return { status: 1, stdout: '' };
    if (args[0] === 'image' && args[1] === 'inspect' && options?.capture) {
      return { status: 0, stdout: `${(spec.platform ?? (() => 'linux/arm64'))(args[4] ?? '')}\n` };
    }
    if (args[0] === 'save') writeFileSync(args[args.indexOf('--output') + 1] ?? '', 'tar');
    if (args[0] === 'compose') {
      const output = args[args.indexOf('--output') + 1];
      if (output !== undefined) writeFileSync(`.scratch/scans/${output.replace('/out/', '')}`, JSON.stringify({ Results: [] }));
    }
    return { status: 0, stdout: '' };
  };
  /** @param {Partial<import('../lib/scan.mjs').Io>} [extra] */
  const io = (extra = {}) => ({
    exec,
    log: (/** @type {string} */ line) => lines.push(line),
    env: {},
    savePlatform: false,
    only: null,
    ...extra,
  });
  return { calls, lines, io };
}

describe('EVM-153 AC4 image-scan plan', () => {
  it('EVM-153 AC4: the plan is the images of publish (api, web), publish-infra (postgres-pgbackrest, media-processor) and every pulled infra image', () => {
    const plan = planImages(INFRA);
    assert.deepEqual(
      plan.map((item) => item.name),
      ['evia-api', 'evia-web', 'evia-postgres-pgbackrest', 'evia-media-processor', 'infra-caddy', 'infra-clamav-debian'],
    );
    assert.deepEqual(RELEASE_IMAGES, ['api', 'web']);
    assert.deepEqual(BUILT_IMAGES, ['postgres-pgbackrest', 'media-processor']);
    assert.equal(infraName('grafana/alloy:v1.21.3@sha256:' + DIGEST), 'infra-alloy');
    assert.equal(infraName('postgres:18.7-trixie@sha256:' + DIGEST), 'infra-postgres');
  });

  it('EVM-153 AC4: the plan rejects a missing list, an image without a digest and duplicated names', () => {
    assert.throws(() => planImages(null), /no images/);
    assert.throws(() => planImages({ images: {} }), /digest/);
    assert.throws(() => planImages({ images: { caddy: 'caddy:2.11.9-alpine' } }), /digest/);
    assert.throws(() => planImages({ images: { a: `x/caddy:1@sha256:${DIGEST}`, b: `y/caddy:2@sha256:${DIGEST}` } }), /duplicate/);
    assert.throws(() => planImages({ images: [] }), /no images/);
  });

  it('EVM-153 AC4: the Trivy command carries the threshold of bramka 6 and the ignorefile semantics of publish / publish-infra', () => {
    const plan = planImages(INFRA);
    const by = Object.fromEntries(plan.map((item) => [item.name, item]));
    const vuln = (/** @type {string} */ name) => vulnArgs(/** @type {any} */ (by[name])).join(' ');
    assert.ok(
      vuln('evia-api').includes(
        `image --config /src/trivy.yaml --skip-version-check --input /out/evia-api.tar ${TRIVY_VULN_FLAGS.join(' ')} --format json --output /out/trivy-image-evia-api.json`,
      ),
    );
    assert.ok(!vuln('evia-api').includes('--ignorefile'));
    assert.ok(!vuln('infra-caddy').includes('--ignorefile'));
    assert.ok(vuln('evia-postgres-pgbackrest').includes('--ignorefile /src/.trivyignore.yaml --show-suppressed'));
    assert.ok(vuln('evia-media-processor').includes('--ignorefile /out/trivyignore-none.yaml --show-suppressed'));
    assert.equal(TRIVY_VULN_FLAGS.join(' '), '--scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1');
    const secret = (/** @type {string} */ name) => secretArgs(/** @type {any} */ (by[name])).join(' ');
    assert.ok(secret('evia-api').includes('--skip-db-update --input /out/evia-api.tar --scanners secret --exit-code 1'));
    assert.ok(!secret('evia-api').includes('--severity'));
    assert.ok(secret('evia-media-processor').includes('--ignorefile /out/trivyignore-none.yaml'));
    assert.ok(!secret('evia-api').includes('--ignorefile'));
  });

  it('EVM-153 AC4: report lines carry the findings of a vulnerability report and only the rule and place of a secret', () => {
    const vulnerable = {
      Results: [
        {
          Target: 'x (debian 13.7)',
          Vulnerabilities: [{ Severity: 'HIGH', VulnerabilityID: 'CVE-1', PkgName: 'libzstd1', InstalledVersion: '1', FixedVersion: '2' }],
        },
      ],
    };
    assert.deepEqual(vulnerabilityLines(vulnerable), ['HIGH CVE-1 libzstd1 1 -> 2 [x (debian 13.7)]']);
    const secrets = {
      Results: [
        { Target: 'app/.env', Secrets: [{ Severity: 'CRITICAL', RuleID: 'aws-key', StartLine: 3, Match: 'AKIA-SECRET-FRAGMENT' }] },
      ],
    };
    assert.deepEqual(secretLines(secrets), ['CRITICAL aws-key [app/.env:3]']);
    assert.deepEqual(vulnerabilityLines(null), []);
    assert.deepEqual(secretLines({ Results: 'x' }), []);
    assert.equal(hasSuppressed({ Results: [{ ExperimentalModifiedFindings: [{}] }] }), true);
    assert.equal(hasSuppressed({ Results: [{}] }), false);
  });
});

describe('EVM-153 AC4 image-scan run', () => {
  it('EVM-153 AC4: every image is built or pulled before the first scan (the root-owned scanner cache must not enter a later build context)', () => {
    const docker = fakeDocker();
    assert.equal(runScan(docker.io(), planImages(INFRA)), 0);
    const commands = docker.calls.map((call) => call.join(' '));
    const lastPrepare = commands
      .map((line, index) => (/^docker (buildx build|pull) /.test(line) ? index : -1))
      .reduce((a, b) => Math.max(a, b), -1);
    const firstScan = commands.findIndex((line) => line.includes('--scanners'));
    assert.ok(lastPrepare >= 0 && firstScan > lastPrepare);
  });

  it('EVM-153 AC4: all green — every image built or pulled for linux/arm64, saved, scanned; nothing is pushed or logged in', () => {
    const docker = fakeDocker();
    const code = runScan(docker.io({ env: { GITHUB_SHA: 'b'.repeat(40) } }), planImages(INFRA));
    assert.equal(code, 0);
    const commands = docker.calls.map((call) => call.join(' '));
    assert.ok(
      commands.some((line) =>
        line.startsWith(
          'docker buildx build --no-cache --pull --provenance=false --sbom=false --platform linux/arm64 --build-arg EVIA_RELEASE_COMMIT=' +
            'b'.repeat(40),
        ),
      ),
    );
    assert.ok(
      commands.some((line) =>
        line.includes('--file infra/images/media-processor/Dockerfile --tag evia-media-processor:candidate --load .'),
      ),
    );
    assert.ok(commands.some((line) => line.startsWith(`docker pull --platform linux/arm64 caddy:2.11.9-alpine@sha256:${DIGEST}`)));
    assert.equal(commands.filter((line) => line.includes('--scanners vuln')).length, 6);
    assert.equal(commands.filter((line) => line.includes('--scanners secret')).length, 4);
    assert.ok(!commands.some((line) => /push|login|--cache|attest|cyclonedx/.test(line)));
    assert.equal(docker.lines.filter((line) => line.endsWith('green')).length, 6);
    assert.equal(readFileSync('.scratch/scans/trivyignore-none.yaml', 'utf8'), 'vulnerabilities: []\n');
  });

  it('EVM-153 AC4: a finding with a fix is red, is printed and the remaining images are still scanned', () => {
    const name = 'evia-api';
    const docker = fakeDocker({
      failOn: (args) => args.includes(`/out/trivy-image-${name}.json`),
      reports: {
        [`/out/trivy-image-${name}.json`]: {
          Results: [
            {
              Target: 'evia-api.tar (debian 13.7)',
              Vulnerabilities: [
                {
                  Severity: 'HIGH',
                  VulnerabilityID: 'CVE-2026-124851',
                  PkgName: 'libzstd1',
                  InstalledVersion: '1.5.7+dfsg-1',
                  FixedVersion: '1.5.7+dfsg-1+deb13u1',
                },
              ],
            },
          ],
        },
      },
    });
    const code = runScan(docker.io(), planImages(INFRA));
    assert.equal(code, 1);
    const log = docker.lines.join('\n');
    assert.match(log, /Critical\/High with a fix in evia-api/);
    assert.match(log, /HIGH CVE-2026-124851 libzstd1 1\.5\.7\+dfsg-1 -> 1\.5\.7\+dfsg-1\+deb13u1/);
    assert.match(log, /infra-clamav-debian green/);
    assert.match(log, /evia-api RED/);
  });

  it('EVM-153 AC4: a scanner error without a report is red', () => {
    const docker = fakeDocker({ failOn: (args) => args.includes('/out/infra-caddy.tar') && args.includes('vuln') });
    assert.equal(runScan(docker.io(), planImages(INFRA)), 1);
    assert.match(docker.lines.join('\n'), /no Trivy report for infra-caddy/);
  });

  it('EVM-153 AC4: a secret is red and only its rule and place are printed, never the match', () => {
    const docker = fakeDocker({
      failOn: (args) => args.includes('/out/trivy-secret-evia-web.json'),
      reports: {
        '/out/trivy-secret-evia-web.json': {
          Results: [
            { Target: 'srv/x', Secrets: [{ Severity: 'HIGH', RuleID: 'private-key', StartLine: 7, Match: 'TOP-SECRET-FRAGMENT' }] },
          ],
        },
      },
    });
    assert.equal(runScan(docker.io(), planImages(INFRA)), 1);
    const log = docker.lines.join('\n');
    assert.match(log, /secret in evia-web/);
    assert.match(log, /HIGH private-key \[srv\/x:7\]/);
    assert.doesNotMatch(log, /TOP-SECRET-FRAGMENT/);
    rmSync('.scratch/scans/trivy-secret-evia-api.json', { force: true });
    const missing = fakeDocker({ failOn: (args) => args.includes('/out/trivy-secret-evia-api.json') });
    assert.equal(runScan(missing.io(), planImages(INFRA)), 1);
    assert.match(missing.lines.join('\n'), /no Trivy secret report for evia-api/);
  });

  it('EVM-153 AC4: the media processor with a suppressed finding is red (its register stays empty)', () => {
    const docker = fakeDocker();
    const plan = planImages(INFRA);
    const original = docker.io();
    /** @type {import('../lib/scan.mjs').Exec} */
    const exec = (command, args, options) => {
      const outcome = original.exec(command, args, options);
      if (args.includes('/out/trivy-image-evia-media-processor.json')) {
        writeFileSync(
          '.scratch/scans/trivy-image-evia-media-processor.json',
          JSON.stringify({ Results: [{ ExperimentalModifiedFindings: [{ VulnerabilityID: 'CVE-1' }] }] }),
        );
      }
      return outcome;
    };
    assert.equal(runScan({ ...original, exec }, plan), 1);
    assert.match(docker.lines.join('\n'), /suppressed findings in evia-media-processor/);
  });

  it('EVM-153 AC4: a platform other than linux/arm64 is red before the scan (no scan of that image)', () => {
    const docker = fakeDocker({ platform: (reference) => (reference.includes('caddy') ? 'linux/amd64' : 'linux/arm64') });
    assert.equal(runScan(docker.io(), planImages(INFRA)), 1);
    assert.match(docker.lines.join('\n'), /infra-caddy is linux\/amd64, not linux\/arm64/);
    assert.ok(!docker.calls.some((call) => call.includes('/out/infra-caddy.tar')));
  });

  it('EVM-153 AC4: a failed pull, build or save is red', () => {
    assert.equal(runScan(fakeDocker({ failPull: true }).io(), planImages(INFRA)), 1);
    const build = fakeDocker({ failOn: (args) => args[0] === 'buildx' && args.includes('infra/images/web/Dockerfile') });
    assert.equal(runScan(build.io(), planImages(INFRA)), 1);
    assert.match(build.lines.join('\n'), /evia-web: build failed/);
    const save = fakeDocker({ failOn: (args) => args[0] === 'save' && args.includes('evia-api:candidate') });
    assert.equal(runScan(save.io(), planImages(INFRA)), 1);
    assert.match(save.lines.join('\n'), /evia-api: docker save failed/);
    const inspect = { ...fakeDocker(), exec: /** @type {import('../lib/scan.mjs').Exec} */ (() => ({ status: 1, stdout: '' })) };
    assert.equal(runScan({ ...inspect.io(), exec: inspect.exec }, planImages(INFRA)), 1);
  });

  it('EVM-153 AC4: --only limits the images; an unknown name is red; --save-platform is passed to docker save', () => {
    const docker = fakeDocker();
    assert.equal(runScan(docker.io({ only: ['infra-caddy'], savePlatform: true }), planImages(INFRA)), 0);
    assert.ok(
      docker.calls.some(
        (call) =>
          call.join(' ') ===
          `docker save --platform linux/arm64 caddy:2.11.9-alpine@sha256:${DIGEST} --output .scratch/scans/infra-caddy.tar`,
      ),
    );
    assert.equal(docker.calls.filter((call) => call[1] === 'pull').length, 1);
    assert.ok(docker.calls.some((call) => call.join(' ').startsWith('docker image inspect --platform linux/arm64 --format')));
    const unknown = fakeDocker();
    assert.equal(runScan(unknown.io({ only: ['nope'] }), planImages(INFRA)), 1);
    assert.equal(unknown.calls.length, 0);
  });

  it('EVM-153 AC4: runFromRepository reads infra-images.json; missing or broken is red', () => {
    const missing = fakeDocker();
    assert.equal(runFromRepository(missing.io()), 1);
    assert.match(missing.lines.join('\n'), /infra-images\.json is missing/);
    mkdirSync('infra/runtime', { recursive: true });
    writeFileSync('infra/runtime/infra-images.json', '{ not json');
    const broken = fakeDocker();
    assert.equal(runFromRepository(broken.io()), 1);
    assert.match(broken.lines.join('\n'), /no images/);
    writeFileSync('infra/runtime/infra-images.json', JSON.stringify(INFRA));
    const ok = fakeDocker();
    assert.equal(runFromRepository(ok.io()), 0);
    const throwing = fakeDocker();
    const notAnError = () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the branch of a thrown non-Error
      throw 'not an Error';
    };
    assert.equal(runFromRepository({ ...throwing.io(), exec: notAnError }), 1);
    assert.match(throwing.lines.join('\n'), /unexpected error/);
  });

  it('EVM-153 AC4: the CLI without Docker images in the repository is red (no infra file)', () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../cli.mjs', import.meta.url)), '--only', 'x'], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /infra-images\.json is missing/);
  });
});
