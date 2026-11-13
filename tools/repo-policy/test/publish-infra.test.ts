/**
 * The publish-infra job, the Dockerfiles of the infrastructure images, builtImages of infra-images.json and the runbooks on the
 * real repository, plus synthetic violations proving the checkers detect them (EVM-124 AC1-AC6; ADR-0022, ADR-0018;
 * security-engineer P1-P4, K1-K11; architect 1-8).
 */
import { describe, expect, it } from 'vitest';
import { exists, filesBelow, json, read, record, text, yaml } from '../src/files.ts';
import {
  builtImagesProblems,
  emulationProblems,
  INFRA_IMAGES,
  infraDockerfileProblems,
  packagesWriteProblems,
  POST_GATE_JOBS,
  PUBLISH_INFRA_IF,
  publishInfraProblems,
  publishProblems,
  RELEASE_SOURCE,
} from '../src/release.ts';

const ci = record(yaml('.github/workflows/ci.yml'));
const jobs = record(ci['jobs']);
const infra = record(jobs['publish-infra']);
const steps = (job: Record<string, unknown>): Array<Record<string, unknown>> => job['steps'] as Array<Record<string, unknown>>;
const withInfra = (patch: (job: Record<string, unknown>) => Record<string, unknown>): unknown => ({
  ...ci,
  jobs: { ...jobs, 'publish-infra': patch(structuredClone(infra)) },
});
const replaceRun = (from: string | RegExp, to: string) => (job: Record<string, unknown>) => ({
  ...job,
  steps: steps(job).map((step) => (typeof step['run'] === 'string' ? { ...step, run: step['run'].replace(from, to) } : step)),
});
const replaceWith = (action: string, patch: Record<string, unknown>) => (job: Record<string, unknown>) => ({
  ...job,
  steps: steps(job).map((step) =>
    text(step['uses']).startsWith(action) ? { ...step, with: { ...record(step['with']), ...patch } } : step,
  ),
});
const problems = (patch: (job: Record<string, unknown>) => Record<string, unknown>): string[] => publishInfraProblems(withInfra(patch));
const indexOfRun = (job: Record<string, unknown>, needle: string): number =>
  steps(job).findIndex((step) => text(step['run']).includes(needle) || text(step['uses']).includes(needle));
const swap = (first: string, second: string) => (job: Record<string, unknown>) => {
  const list = [...steps(job)];
  const a = indexOfRun(job, first);
  const b = indexOfRun(job, second);
  [list[a], list[b]] = [list[b] ?? {}, list[a] ?? {}];
  return { ...job, steps: list };
};

describe('publish-infra on the repository (EVM-124 AC1-AC4)', () => {
  it('EVM-124 AC1: a push to main after a green ci-gate, natively on ubuntu-24.04-arm without QEMU, hermetic, with the exact permissions', () => {
    expect(publishInfraProblems(ci)).toEqual([]);
    expect(infra['if']).toBe(PUBLISH_INFRA_IF);
    expect(infra['runs-on']).toBe('ubuntu-24.04-arm');
    expect(record(infra['permissions'])).toEqual({ contents: 'read', packages: 'write', 'id-token': 'write', attestations: 'write' });
    // K1: none of the other triggers of a post-gate job, and the job is not a dependency of ci-gate
    expect(POST_GATE_JOBS).toContain('publish-infra');
    expect(record(jobs['ci-gate'])['needs']).not.toContain('publish-infra');
    expect(Object.keys(record(ci['on'])).sort()).toEqual(['pull_request', 'push', 'workflow_dispatch']);
    for (const path of filesBelow('.github/workflows', (file) => /\.ya?ml$/.test(file))) {
      expect(emulationProblems(path, read(path)), path).toEqual([]);
      expect(packagesWriteProblems(path, yaml(path)), path).toEqual([]);
    }
  });

  it('EVM-124 AC1 (P4): id-token and attestations only in publish-infra, never at the workflow level; publish stays as it was', () => {
    expect(record(jobs['publish'])['permissions']).toEqual({ contents: 'read', packages: 'write', actions: 'read' });
    expect(packagesWriteProblems('ci.yml', { permissions: { contents: 'read', 'id-token': 'write' }, jobs: {} })).not.toEqual([]);
    expect(packagesWriteProblems('ci.yml', { jobs: { publish: { permissions: { 'id-token': 'write' } } } })).not.toEqual([]);
    expect(packagesWriteProblems('ci.yml', { jobs: { quality: { permissions: { attestations: 'write' } } } })).not.toEqual([]);
    expect(packagesWriteProblems('nightly.yml', { jobs: { 'publish-infra': { permissions: { 'id-token': 'write' } } } })).not.toEqual([]);
    expect(
      packagesWriteProblems('ci.yml', { jobs: { 'publish-infra': { permissions: { packages: 'write', 'id-token': 'write' } } } }),
    ).toEqual([]);
    expect(publishProblems(ci)).toEqual([]);
  });

  it('EVM-124 AC1 AC3: the record is a separate artifact from release-manifest (commit, run, image, digest, imageId, platform) and the evidence has the retention of sbom', () => {
    const uploads = steps(infra)
      .filter((step) => text(step['uses']).startsWith('actions/upload-artifact@'))
      .map((step) => record(step['with']));
    expect(uploads.map((upload) => upload['name'])).toEqual(['infra-images-record', 'infra-images-evidence']);
    const publishUploads = steps(record(jobs['publish']))
      .filter((step) => text(step['uses']).startsWith('actions/upload-artifact@'))
      .map((step) => record(step['with']));
    expect(publishUploads.find((upload) => upload['name'] === 'sbom')?.['retention-days']).toBe(90);
    for (const upload of uploads) expect(upload['retention-days']).toBe(90);
  });

  it('EVM-124 AC2 AC3: the attestation action is pinned by SHA to a release tag, from GitHub, used only here', () => {
    const uses = steps(infra)
      .map((step) => text(step['uses']))
      .filter((value) => value.startsWith('actions/attest-build-provenance@'));
    expect(uses).toHaveLength(INFRA_IMAGES.length);
    for (const value of uses) expect(value).toMatch(/^actions\/attest-build-provenance@[0-9a-f]{40}$/);
    expect(read('.github/workflows/ci.yml')).toMatch(/attest-build-provenance@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
    for (const name of Object.keys(jobs).filter((name) => name !== 'publish-infra'))
      expect(JSON.stringify(jobs[name]), name).not.toContain('attest-build-provenance');
  });
});

describe('publish-infra checkers detect violations (EVM-124)', () => {
  it('EVM-124 AC1 (K1, K4): another trigger, dependencies, an x86 runner, QEMU, a missing aarch64 check, an extra permission, a longer timeout', () => {
    expect(problems((job) => ({ ...job, if: "needs.ci-gate.result == 'success'" }))).not.toEqual([]);
    expect(problems((job) => ({ ...job, needs: ['ci-gate', 'changes'] }))).not.toEqual([]);
    expect(problems((job) => ({ ...job, 'runs-on': 'ubuntu-24.04' }))).not.toEqual([]);
    expect(problems((job) => ({ ...job, 'timeout-minutes': 90 }))).not.toEqual([]);
    expect(
      problems((job) => ({
        ...job,
        permissions: { contents: 'read', packages: 'write', 'id-token': 'write', attestations: 'write', actions: 'read' },
      })),
    ).not.toEqual([]);
    expect(
      problems((job) => ({
        ...job,
        steps: [{ uses: 'docker/setup-qemu-action@0000000000000000000000000000000000000000' }, ...steps(job)],
      })),
    ).not.toEqual([]);
    expect(problems(replaceRun('"$(uname -m)" != aarch64', '"$(uname -m)" != x86_64'))).not.toEqual([]);
    expect(problems(replaceRun('--platform linux/arm64 ', '--platform linux/amd64 '))).not.toEqual([]);
    expect(emulationProblems('x.yml', 'uses: docker/setup-qemu-action@x')).not.toEqual([]);
    expect(emulationProblems('x.yml', 'run: docker run tonistiigi/binfmt --install all')).not.toEqual([]);
    expect(publishInfraProblems({ jobs: {} })).toEqual(['ci.yml: publish-infra: brak joba publish-infra']);
  });

  it('EVM-124 AC1 (K2, K3): a cache, a secret, a build argument, a token of Actions, a foreign action, an output of another job, an expression of the event', () => {
    for (const flag of [
      '--cache-from type=gha',
      '--cache-to type=registry,ref=x',
      '--mount=type=cache',
      '--secret id=x',
      '--build-arg X=${GITHUB_TOKEN}',
    ])
      expect(problems(replaceRun('--provenance=false', `--provenance=false ${flag}`)), flag).not.toEqual([]);
    expect(problems(replaceRun('--no-cache --pull ', ''))).not.toEqual([]);
    expect(
      problems(replaceRun('"evia-$image:candidate" --load .', '"evia-$image:candidate" -e ACTIONS_ID_TOKEN_REQUEST_URL --load .')),
    ).not.toEqual([]);
    for (const uses of [
      'actions/cache@0000000000000000000000000000000000000000',
      'actions/download-artifact@0000000000000000000000000000000000000000',
      'actions/setup-node@0000000000000000000000000000000000000000',
      'docker/login-action@0000000000000000000000000000000000000000',
      'actions/checkout@v7',
    ])
      expect(
        problems((job) => ({ ...job, steps: [{ uses }, ...steps(job)] })),
        uses,
      ).not.toEqual([]);
    expect(problems((job) => ({ ...job, env: { ...record(job['env']), X: ['$', '{{ secrets.T }}'].join('') } }))).not.toEqual([]);
    expect(problems((job) => ({ ...job, env: { ...record(job['env']), X: '${{ needs.ci-gate.outputs.x }}' } }))).not.toEqual([]);
    expect(problems(replaceRun('echo "$GHCR_TOKEN"', 'echo "${{ github.event.head_commit.message }}"'))).not.toEqual([]);
    expect(
      problems((job) => ({
        ...job,
        steps: steps(job).map((step, index) => (index === 0 ? { ...step, with: { 'persist-credentials': true } } : step)),
      })),
    ).not.toEqual([]);
    expect(
      problems((job) => ({
        ...job,
        steps: steps(job).map((step) => (text(step['run']).includes('docker push') ? { ...step, shell: 'sh' } : step)),
      })),
    ).not.toEqual([]);
  });

  it('EVM-124 AC1 (SR-INFRA-09; ADR-0022 pt 3): the packages must be private - an anonymous manifest request after the push and before the attestation, red unless 401, 403 or 404', () => {
    const anonymousIndex = indexOfRun(infra, 'anonymous access denied');
    expect(anonymousIndex).toBeGreaterThan(indexOfRun(infra, 'docker push'));
    expect(anonymousIndex).toBeLessThan(indexOfRun(infra, 'actions/attest-build-provenance@'));
    // the check moved after the attestation, removed, accepting a 200, or authenticated is a violation
    expect(problems(swap('anonymous access denied', 'actions/attest-build-provenance@'))).not.toEqual([]);
    expect(
      problems((job) => ({ ...job, steps: steps(job).filter((step) => !text(step['run']).includes('anonymous access denied')) })),
    ).not.toEqual([]);
    expect(problems(replaceRun('401|403|404)', '200|401|403|404)'))).not.toEqual([]);
    expect(problems(replaceRun('exit 1 ;;', 'true ;;'))).not.toEqual([]);
    expect(problems(replaceRun('--max-time 20 --write-out', '--max-time 20 --user "$GHCR_USER:$GHCR_TOKEN" --write-out'))).not.toEqual([]);
    expect(problems(replaceRun('/manifests/$digest"', '/manifests/latest"'))).not.toEqual([]);
  });

  it('EVM-124 AC2 (architect 4; K2): all or nothing — a push before the scan or the platform check, a login before the scan, a push step that may be skipped or fail open', () => {
    expect(problems(swap('scan-trivy-image image', 'docker push'))).not.toEqual([]);
    expect(problems(swap('not linux/arm64', 'scan-trivy-image image'))).not.toEqual([]);
    expect(problems(swap('docker buildx build', 'not linux/arm64'))).not.toEqual([]);
    expect(problems(swap('docker push', 'actions/attest-build-provenance@'))).not.toEqual([]);
    expect(problems(swap('actions/attest-build-provenance@', 'infra-images-record.json'))).not.toEqual([]);
    expect(
      problems((job) => ({
        ...job,
        steps: steps(job).map((step) => (text(step['run']).includes('docker push') ? { ...step, if: 'always()' } : step)),
      })),
    ).not.toEqual([]);
    expect(
      problems((job) => ({
        ...job,
        steps: steps(job).map((step) => (text(step['run']).includes('docker push') ? { ...step, 'continue-on-error': true } : step)),
      })),
    ).not.toEqual([]);
    expect(
      problems((job) => ({
        ...job,
        steps: steps(job).map((step) =>
          text(step['uses']).startsWith('actions/attest-build-provenance@') ? { ...step, if: 'always()' } : step,
        ),
      })),
    ).not.toEqual([]);
    expect(
      problems((job) => ({
        ...job,
        steps: steps(job).map((step) => (text(step['run']).includes('docker push') ? { ...step, env: {} } : step)),
      })),
    ).not.toEqual([]);
    expect(problems((job) => ({ ...job, steps: steps(job).slice(0, -1) }))).not.toEqual([]);
  });

  it('EVM-124 AC2 (K7, P2): the scan without the threshold, with the exit code 0, swallowed, without suppressed findings shown, with the infrastructure register for the processor, without the SBOM', () => {
    expect(problems(replaceRun('--exit-code 1', '--exit-code 0'))).not.toEqual([]);
    expect(problems(replaceRun('--ignore-unfixed ', ''))).not.toEqual([]);
    expect(problems(replaceRun('--severity HIGH,CRITICAL', '--severity CRITICAL'))).not.toEqual([]);
    expect(
      problems(replaceRun('--output "/out/trivy-image-$name.json" || {', '--output "/out/trivy-image-$name.json" || true || {')),
    ).not.toEqual([]);
    expect(problems(replaceRun('--show-suppressed ', ''))).not.toEqual([]);
    expect(problems(replaceRun('ExperimentalModifiedFindings', 'Results'))).not.toEqual([]);
    expect(problems(replaceRun('/out/trivyignore-none.yaml', '/src/.trivyignore.yaml'))).not.toEqual([]);
    expect(problems(replaceRun('--format cyclonedx', '--format table'))).not.toEqual([]);
    expect(problems(replaceRun('chmod a+r .scratch/scans/*.tar', 'true'))).not.toEqual([]);
  });

  it('EVM-124 AC2 (P1; architect 3): the scanned image is the published one — ImageID = config.digest from GHCR, the digest of the push from RepoDigests, a single manifest, linux/arm64 after the pull', () => {
    expect(problems(replaceRun('[ "$config" != "$image_id" ]', '[ -z "$config" ]'))).not.toEqual([]);
    expect(problems(replaceRun('imagetools inspect --raw', 'imagetools inspect'))).not.toEqual([]);
    expect(problems(replaceRun('.RepoDigests', '.Id'))).not.toEqual([]);
    expect(
      problems(replaceRun('docker pull --platform linux/arm64 "$REGISTRY/$name@$digest"', 'docker pull "$REGISTRY/$name@$digest"')),
    ).not.toEqual([]);
    expect(problems(replaceRun('in GHCR is $platform, not linux/arm64', 'in GHCR is $platform'))).not.toEqual([]);
    expect(problems(replaceRun('"$target"', '"$REGISTRY/$name:latest"'))).not.toEqual([]);
  });

  it('EVM-124 AC4: a missing platform check, a check that does not name the platform, a check after the scan', () => {
    expect(problems(replaceRun('[ "$platform" != linux/arm64 ]', '[ -z "$platform" ]'))).not.toEqual([]);
    expect(problems(replaceRun('is $platform, not linux/arm64', 'is wrong'))).not.toEqual([]);
    const platformStep = steps(infra).find(
      (step) => text(step['run']).includes('Platform') || text(step['run']).includes('is $platform, not linux/arm64'),
    );
    expect(text(platformStep?.['run'])).toContain('evia-$image is $platform, not linux/arm64');
  });

  it('EVM-124 AC3: an attestation without the digest of the push, for another subject, without push-to-registry, or only for one image; a record without fields', () => {
    expect(problems(replaceWith('actions/attest-build-provenance@', { 'subject-digest': 'sha256:abc' }))).not.toEqual([]);
    expect(problems(replaceWith('actions/attest-build-provenance@', { 'push-to-registry': false }))).not.toEqual([]);
    expect(problems(replaceWith('actions/attest-build-provenance@', { 'subject-name': 'ghcr.io/other/evia-x' }))).not.toEqual([]);
    expect(
      problems((job) => ({
        ...job,
        steps: steps(job)
          .filter((step) => !text(step['uses']).startsWith('actions/attest-build-provenance@'))
          .slice(0),
      })),
    ).not.toEqual([]);
    for (const key of ['workflowRef', 'imageId', 'runId']) expect(problems(replaceRun(new RegExp(key, 'g'), 'x')), key).not.toEqual([]);
    expect(
      problems((job) => ({
        ...job,
        steps: steps(job).map((step) =>
          record(step['with'])['name'] === 'infra-images-record'
            ? { ...step, with: { name: 'release-manifest', path: 'release/release-manifest.json' } }
            : step,
        ),
      })),
    ).not.toEqual([]);
    expect(
      problems((job) => ({
        ...job,
        steps: steps(job).map((step) =>
          record(step['with'])['name'] === 'infra-images-evidence'
            ? { ...step, with: { ...record(step['with']), 'retention-days': 7 } }
            : step,
        ),
      })),
    ).not.toEqual([]);
  });

  it('EVM-124: a Docker command outside the list, a project image by a tag other than sha-<commit>', () => {
    expect(problems(replaceRun('docker save "evia-$image:candidate"', 'docker run --rm "evia-$image:candidate"'))).not.toEqual([]);
    expect(problems(replaceRun('docker tag "$name:candidate" "$target"', 'docker tag x ghcr.io/konradkluz/evia-api:latest'))).not.toEqual(
      [],
    );
  });
});

describe('the Dockerfiles of the infrastructure images (EVM-124 AC2; K5, K6)', () => {
  const media = read('infra/images/media-processor/Dockerfile');
  const pgbackrest = read('infra/images/postgres-pgbackrest/Dockerfile');

  it('EVM-124 AC2: exact apt versions, no unauthenticated source, no upgrade, a source label; the processor runtime without npm and corepack', () => {
    expect(infraDockerfileProblems('media-processor', media)).toEqual([]);
    expect(infraDockerfileProblems('postgres-pgbackrest', pgbackrest)).toEqual([]);
    expect(RELEASE_SOURCE).toBe('https://github.com/konradkluz/evia-manager');
    expect(media).toContain('ARG FFMPEG_VERSION=7:7.1.5-0+deb13u1');
    // the sandbox of the processor is unchanged by this story (K6)
    const compose = read('infra/runtime/compose.media.yaml');
    for (const setting of ['network_mode: none', 'read_only: true', 'cap_drop: [ALL]', "'no-new-privileges:true'", "user: '10005:10002'"])
      expect(compose, setting).toContain(setting);
  });

  it('EVM-124 AC2 (K5): an empty, ranged or floating apt version, an unsigned source, curl|sh, apt upgrade, a missing or duplicated label', () => {
    const bad = (name: string, source: string, from: string | RegExp, to: string): string[] =>
      infraDockerfileProblems(name, source.replace(from, to));
    expect(bad('media-processor', media, 'ARG FFMPEG_VERSION=7:7.1.5-0+deb13u1', 'ARG FFMPEG_VERSION=')).not.toEqual([]);
    expect(bad('media-processor', media, 'ARG FFMPEG_VERSION=7:7.1.5-0+deb13u1', 'ARG FFMPEG_VERSION=7:7.1.*')).not.toEqual([]);
    expect(bad('media-processor', media, 'ARG FFMPEG_VERSION=7:7.1.5-0+deb13u1', 'ARG FFMPEG_VERSION=>=7:7.1')).not.toEqual([]);
    expect(bad('media-processor', media, 'ARG ZLIB_VERSION=', 'ARG ZLIB_OTHER=')).not.toEqual([]);
    expect(bad('media-processor', media, 'test -n "${FFMPEG_VERSION}"', 'true')).not.toEqual([]);
    expect(bad('media-processor', media, 'apt-get update', 'apt-get update && apt-get upgrade -y')).not.toEqual([]);
    expect(bad('media-processor', media, 'apt-get update', 'apt-get update --allow-unauthenticated')).not.toEqual([]);
    expect(bad('media-processor', media, 'apt-get update', 'curl https://example.invalid/x | sh && apt-get update')).not.toEqual([]);
    expect(bad('media-processor', media, 'LABEL org.opencontainers.image.source', 'LABEL x')).not.toEqual([]);
    expect(bad('postgres-pgbackrest', pgbackrest, 'pgbackrest=2.60.0-1.pgdg13+1', 'pgbackrest')).not.toEqual([]);
    expect(bad('postgres-pgbackrest', pgbackrest, 'pgbackrest=2.60.0-1.pgdg13+1', 'pgbackrest=2.*')).not.toEqual([]);
    expect(bad('postgres-pgbackrest', pgbackrest, 'LABEL org.opencontainers.image.source', 'LABEL x')).not.toEqual([]);
    expect(bad('postgres-pgbackrest', pgbackrest, 'apt-get update', 'apt-get update && apt-get dist-upgrade -y')).not.toEqual([]);
  });

  it('EVM-124 AC2 (K6, RR-78): npm and corepack stay in the processor runtime, are removed non-idempotently, or are not asserted away', () => {
    const bad = (from: string | RegExp, to: string): string[] => infraDockerfileProblems('media-processor', media.replace(from, to));
    expect(bad('/usr/local/lib/node_modules/corepack ', '')).not.toEqual([]);
    expect(bad('&& ! command -v npm', '&& true')).not.toEqual([]);
    expect(bad('&& node --version\n', '\n')).not.toEqual([]);
    expect(bad('RUN rm -rf /usr/local/lib/node_modules/npm', 'RUN rm /usr/local/lib/node_modules/npm')).not.toEqual([]);
    // a removal in the build stage does not count: it must be after `AS runtime`
    const stage = media.indexOf('AS runtime');
    const removal = media.slice(media.indexOf('RUN rm -rf /usr/local/lib'), media.indexOf('node --version') + 'node --version'.length);
    expect(
      infraDockerfileProblems('media-processor', media.slice(0, stage).concat(media.slice(stage).replace(removal, 'RUN true'))),
    ).not.toEqual([]);
  });

  it('EVM-124 AC2: the bases are by digest and the processor shares the digest of the API image (one base, one place for Renovate)', () => {
    const api = read('infra/images/api/Dockerfile');
    for (const digest of media.match(/sha256:[0-9a-f]{64}/g) ?? []) expect(api).toContain(digest);
    expect(pgbackrest).toMatch(/^FROM postgres:18\.6-trixie@sha256:[0-9a-f]{64}$/m);
    expect(media.match(/^FROM .*node:26\.\d+\.\d+-trixie-slim@sha256:[0-9a-f]{64}/gm)).toHaveLength(2);
  });
});

describe('builtImages of infra-images.json (EVM-124 AC6; architect 1)', () => {
  const document = json('infra/runtime/infra-images.json');

  it('EVM-124 AC6: pgbackrest and the processor are listed without a digest, with the repository and the Dockerfile; `images` (pulled in publish) does not contain them', () => {
    expect(builtImagesProblems(document, exists)).toEqual([]);
    const built = record(record(document)['builtImages']);
    expect(Object.keys(built)).toEqual(INFRA_IMAGES);
    expect(text(record(document)['platform'])).toBe('linux/arm64');
  });

  it('EVM-124 AC6: a digest, a foreign repository, a missing Dockerfile, a name not built in CI or a project image in `images` is detected', () => {
    const base = structuredClone(record(document));
    const built = (patch: (value: Record<string, unknown>) => void): unknown => {
      const copy = structuredClone(base);
      patch(record(copy['builtImages']));
      return copy;
    };
    expect(
      builtImagesProblems(
        built((value) => (record(value['media-processor'])['digest'] = `sha256:${'0'.repeat(64)}`)),
        exists,
      ),
    ).not.toEqual([]);
    expect(
      builtImagesProblems(
        built((value) => (record(value['media-processor'])['repository'] = 'ghcr.io/other/evia-media-processor')),
        exists,
      ),
    ).not.toEqual([]);
    expect(
      builtImagesProblems(
        built((value) => (record(value['media-processor'])['dockerfile'] = 'infra/images/none/Dockerfile')),
        exists,
      ),
    ).not.toEqual([]);
    expect(
      builtImagesProblems(
        built((value) => delete value['media-processor']),
        exists,
      ),
    ).not.toEqual([]);
    expect(
      builtImagesProblems(
        built((value) => (value['extra'] = { repository: 'ghcr.io/konradkluz/evia-extra', dockerfile: 'x' })),
        exists,
      ),
    ).not.toEqual([]);
    expect(
      builtImagesProblems(
        built((value) => (record(value['postgres-pgbackrest'])['dockerfile'] = 'infra/images/media-processor/Dockerfile')),
        exists,
      ),
    ).not.toEqual([]);
    const copy = structuredClone(base);
    record(copy['images'])['processor'] = `ghcr.io/konradkluz/evia-media-processor:sha-1@sha256:${'0'.repeat(64)}`;
    expect(builtImagesProblems(copy, exists)).not.toEqual([]);
  });

  it('EVM-124 AC6 (K8): the pull loop of publish still reads `.images[]` only, so nothing from builtImages is pulled; no image of the project is in compose.infra.yaml yet', () => {
    const script = steps(record(jobs['publish']))
      .map((step) => text(step['run']))
      .join('\n');
    expect(script).toContain("jq -r '.images[]' infra/runtime/infra-images.json");
    expect(read('infra/runtime/compose.infra.yaml')).not.toContain('ghcr.io/konradkluz/evia-postgres-pgbackrest@sha256:0');
  });
});

describe('runbooks: the IaC session verifies, it does not build (EVM-124 AC5, AC6; P3)', () => {
  const runbook = read('docs/ops/runbooks/media-processor.md');
  const restore = read('docs/ops/runbooks/restore.md');
  const section = runbook.slice(runbook.indexOf('## Instalacja'), runbook.indexOf('## Pliki sprzed wdrożenia'));

  it('EVM-124 AC5: the verification names the push run on main, the attestation with the workflow, the ref, the commit and the runners, the pull by digest and linux/arm64', () => {
    for (const phrase of [
      'gh run download <run-id> -n infra-images-record',
      '.github/workflows/ci.yml',
      '`push`, `main`, `success`',
      'gh attestation verify oci://ghcr.io/konradkluz/evia-media-processor@sha256:',
      '--repo konradkluz/evia-manager',
      '--signer-workflow konradkluz/evia-manager/.github/workflows/ci.yml',
      '--source-ref refs/heads/main',
      '--source-digest <commit z rekordu>',
      '--deny-self-hosted-runners',
      'docker pull ghcr.io/konradkluz/evia-media-processor@sha256:',
      'linux/arm64',
      'Odrzucamy bez wyjątków ręcznych',
      'bez rekordu, bez atestacji',
      'Version … not found',
      'FFMPEG_VERSION',
    ])
      expect(section, phrase).toContain(phrase);
  });

  it('EVM-124 AC6: no step builds an image on the VM, the evidence points at the CI run, the old debt entry is gone', () => {
    for (const [name, text_] of [
      ['media-processor.md', section],
      ['restore.md', restore.slice(restore.indexOf('## Sesja IaC'), restore.indexOf('## Wynik testu'))],
    ] as const) {
      expect(text_, name).not.toMatch(/docker build\b|docker buildx build/);
      expect(text_, name).not.toMatch(/--build-arg FFMPEG_VERSION/);
    }
    expect(runbook).not.toContain('Publikacja obrazu `evia-media-processor` w CI');
    expect(section).toContain('odsyłacz do przebiegu');
    expect(restore).toContain('publish-infra');
    expect(restore).toContain('gh attestation verify');
    expect(read('docs/ops/github-i-ci.md')).toContain('publiczne');
    expect(read('docs/ops/github-i-ci.md')).toContain('Sigstore/Rekor');
  });
});
