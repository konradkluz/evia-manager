/**
 * The hermetic `publish` job and the release images on the real repository, plus synthetic violations proving the
 * checkers detect them (EVM-007 AC2; ADR-0018 B1a, n4; TM-112, TM-113; security-engineer A4, A5; architect 18, 19).
 */
import { describe, expect, it } from 'vitest';
import { filesBelow, json, read, record, text, yaml } from '../src/files.ts';
import {
  dockerLines,
  downloadArtifactProblems,
  packagesWriteProblems,
  POST_GATE_JOBS,
  PUBLISH_IF,
  publishProblems,
  RELEASE_PLATFORM,
  releaseDockerfileProblems,
  STAGING_VERIFY_IF,
  stagingVerifyProblems,
} from '../src/release.ts';

const ci = record(yaml('.github/workflows/ci.yml'));
const jobs = record(ci['jobs']);
const publish = record(jobs['publish']);
const workflows = filesBelow('.github/workflows', (path) => /\.ya?ml$/.test(path));
const packageManager = text(record(json('package.json'))['packageManager']);
const IMAGES = ['api', 'web'];

/** A copy of ci.yml with the publish job changed by `patch`. */
const withPublish = (patch: (job: Record<string, unknown>) => Record<string, unknown>): unknown => ({
  ...ci,
  jobs: { ...jobs, publish: patch(structuredClone(publish)) },
});
const steps = (job: Record<string, unknown>): Array<Record<string, unknown>> => job['steps'] as Array<Record<string, unknown>>;
/** Replaces text in every run script of the job. */
const replaceRun = (from: string | RegExp, to: string) => (job: Record<string, unknown>) => ({
  ...job,
  steps: steps(job).map((step) => (typeof step['run'] === 'string' ? { ...step, run: step['run'].replace(from, to) } : step)),
});

/** Replaces the env of the step running `run`. */
const replaceRunEnv = (run: string, env: Record<string, string>) => (job: Record<string, unknown>) => ({
  ...job,
  steps: steps(job).map((step) => (step['run'] === run ? { ...step, env } : step)),
});

describe('publish on the repository (EVM-007 AC2)', () => {
  it('EVM-007 AC2: publish runs only for a push to main with a changed build input after a green ci-gate — hermetic, with bramka 6 before the push', () => {
    expect(publishProblems(ci)).toEqual([]);
    expect(publish['if']).toBe(PUBLISH_IF);
  });

  it('EVM-007 AC2 (A5): publish and staging-verify are not dependencies of ci-gate, so a red deployment never blocks a merge', () => {
    for (const name of POST_GATE_JOBS) expect(record(jobs['ci-gate'])['needs']).not.toContain(name);
  });

  it('EVM-007 AC2: packages: write only in publish and download-artifact never in a job that builds images, in every workflow', () => {
    expect(workflows.length).toBeGreaterThan(0);
    for (const path of workflows) {
      expect(packagesWriteProblems(path, yaml(path)), path).toEqual([]);
      expect(downloadArtifactProblems(path, yaml(path)), path).toEqual([]);
    }
  });

  it('EVM-007 AC2: the release Dockerfiles use bases by digest, verified pnpm, a frozen lockfile, a non-root user and an allow-list context', () => {
    for (const image of IMAGES) {
      const dir = `infra/images/${image}`;
      expect(releaseDockerfileProblems(dir, read(`${dir}/Dockerfile`), read(`${dir}/Dockerfile.dockerignore`), packageManager)).toEqual([]);
    }
  });

  it('EVM-007 AC2 (A4): the infrastructure images of the VM are pinned by tag + digest and scanned in the same gate', () => {
    const images = Object.values(record(record(json('infra/runtime/infra-images.json'))['images'])).map(text);
    expect(images.length).toBeGreaterThanOrEqual(3);
    for (const image of images) expect(image).toMatch(/^[^@\s]+:[^@\s]+@sha256:[0-9a-f]{64}$/);
  });

  it('EVM-007 AC1, AC2 (Arm64 VM, Hetzner CAX): every image is for linux/arm64 — release images cross-built, infrastructure images pulled for it, both checked before the scan', () => {
    expect(RELEASE_PLATFORM).toBe('linux/arm64');
    expect(text(record(json('infra/runtime/infra-images.json'))['platform'])).toBe(RELEASE_PLATFORM);
    const script = steps(publish)
      .map((step) => text(step['run']))
      .join('\n');
    expect(script).toContain('--sbom=false --platform linux/arm64 ');
    expect(script).toContain('docker pull --platform linux/arm64 "$ref"');
    expect(script.match(/\[ "\$platform" != linux\/arm64 \]/g)?.length).toBe(2);
  });

  it('EVM-007 AC1, AC2 (Arm64 VM): every release Dockerfile builds on the runner platform and has a final stage without RUN (no emulation)', () => {
    for (const image of [...IMAGES, 'deploy-agent']) {
      const dir = `infra/images/${image}`;
      expect(read(`${dir}/Dockerfile`)).toMatch(/^FROM --platform=\$BUILDPLATFORM /m);
      expect(releaseDockerfileProblems(dir, read(`${dir}/Dockerfile`), read(`${dir}/Dockerfile.dockerignore`), packageManager)).toEqual([]);
    }
  });
});

describe('publish checkers detect violations (EVM-007 AC2)', () => {
  it('EVM-007 AC2: a pull request or branch trigger, extra dependencies, wider permissions', () => {
    expect(publishProblems(withPublish((job) => ({ ...job, if: "needs.ci-gate.result == 'success'" })))).not.toEqual([]);
    expect(publishProblems(withPublish((job) => ({ ...job, if: PUBLISH_IF.replace("github.event_name == 'push' && ", '') })))).not.toEqual(
      [],
    );
    expect(publishProblems(withPublish((job) => ({ ...job, needs: ['changes', 'ci-gate', 'quality'] })))).not.toEqual([]);
    expect(publishProblems(withPublish((job) => ({ ...job, permissions: { contents: 'write', packages: 'write' } })))).not.toEqual([]);
    expect(
      publishProblems(
        withPublish(
          replaceRunEnv('node tools/ghcr-retention/cli.mjs', { GITHUB_TOKEN: '${{ github.token }}', GHCR_RETENTION_MODE: 'delete' }),
        ),
      ),
    ).not.toEqual([]);
    expect(publishProblems({ jobs: {} })).toEqual(['ci.yml: publish: brak joba publish']);
  });

  it('EVM-007 AC2 (TM-112, A5): any cache — actions/cache, setup-node, pnpm setup, buildx cache, the Actions runtime token', () => {
    for (const uses of [
      'actions/cache@0000000000000000000000000000000000000000',
      'actions/setup-node@0000000000000000000000000000000000000000',
      'pnpm/action-setup@0000000000000000000000000000000000000000',
      'crazy-max/ghaction-github-runtime@0000000000000000000000000000000000000000',
      'docker/build-push-action@0000000000000000000000000000000000000000',
    ])
      expect(publishProblems(withPublish((job) => ({ ...job, steps: [{ uses }, ...steps(job)] }))), uses).not.toEqual([]);
    for (const flag of ['--cache-from type=gha', '--cache-to type=registry,ref=x', '--mount=type=cache'])
      expect(publishProblems(withPublish(replaceRun('--provenance=false', `--provenance=false ${flag}`))), flag).not.toEqual([]);
    expect(publishProblems(withPublish(replaceRun('--no-cache --pull ', '')))).not.toEqual([]);
  });

  it('EVM-007 AC2 (n4): download-artifact, an output of another job or a secret as an input of the build', () => {
    const download = { uses: 'actions/download-artifact@0000000000000000000000000000000000000000', with: { name: 'x' } };
    expect(publishProblems(withPublish((job) => ({ ...job, steps: [download, ...steps(job)] })))).not.toEqual([]);
    expect(publishProblems(withPublish(replaceRun('"$EVIA_RELEASE_COMMIT"', '"${{ needs.quality.outputs.commit }}"')))).not.toEqual([]);
    expect(
      publishProblems(withPublish((job) => ({ ...job, env: { ...record(job['env']), X: '${{ secrets.GHCR }}' }, steps: steps(job) }))),
    ).not.toEqual([]);
    expect(
      publishProblems(withPublish((job) => ({ ...job, env: { ...record(job['env']), Y: '${{ needs.quality.outputs.x }}' } }))),
    ).not.toEqual([]);
    expect(
      publishProblems(
        withPublish((job) => ({
          ...job,
          steps: steps(job).map((step, index) => (index === 1 ? { ...step, env: { T: '${{ secrets.T }}' } } : step)),
        })),
      ),
    ).not.toEqual([]);
    const building = { jobs: { build: { steps: [download, { run: 'docker buildx build .' }] } } };
    expect(downloadArtifactProblems('x.yml', building)).not.toEqual([]);
  });

  it('EVM-007 AC2 (A4): the image gate after the push, without the severity threshold, without the SBOM or the infrastructure images', () => {
    expect(
      publishProblems(
        withPublish((job) => {
          const list = steps(job);
          const scan = list.findIndex((step) => text(step['run']).includes('scan-trivy-image'));
          const push = list.findIndex((step) => text(step['run']).includes('docker push'));
          const reordered = [...list];
          [reordered[scan], reordered[push]] = [list[push] ?? {}, list[scan] ?? {}];
          return { ...job, steps: reordered };
        }),
      ),
    ).not.toEqual([]);
    expect(publishProblems(withPublish(replaceRun('--exit-code 1', '--exit-code 0')))).not.toEqual([]);
    expect(publishProblems(withPublish(replaceRun('--format cyclonedx', '--format table')))).not.toEqual([]);
    expect(publishProblems(withPublish(replaceRun('infra/runtime/infra-images.json', 'x.json')))).not.toEqual([]);
  });

  it('EVM-007 AC2 (Arm64 VM): a build for the runner platform, an infrastructure image of the host platform, a missing platform check, emulation', () => {
    expect(publishProblems(withPublish(replaceRun('--platform linux/arm64 ', '')))).not.toEqual([]);
    expect(publishProblems(withPublish(replaceRun('--platform linux/arm64 ', '--platform linux/amd64 ')))).not.toEqual([]);
    expect(publishProblems(withPublish(replaceRun('docker pull --platform linux/arm64 "$ref"', 'docker pull "$ref"')))).not.toEqual([]);
    expect(publishProblems(withPublish(replaceRun(/\[ "\$platform" != linux\/arm64 \]/, '[ -z "$platform" ]')))).not.toEqual([]);
    // no platform check at all (both removed)
    expect(publishProblems(withPublish(replaceRun(/\[ "\$platform" != linux\/arm64 \]/g, '[ -z "$platform" ]')))).not.toEqual([]);
    expect(
      publishProblems(
        withPublish((job) => ({
          ...job,
          steps: [{ uses: 'docker/setup-qemu-action@0000000000000000000000000000000000000000' }, ...steps(job)],
        })),
      ),
    ).not.toEqual([]);
  });

  it('EVM-007 AC2: the image archives must be readable by the unprivileged scanner and its output directory writable', () => {
    expect(publishProblems(withPublish(replaceRun(/chmod a\+r \.scratch\/scans\/\*\.tar\n/, '')))).not.toEqual([]);
    expect(publishProblems(withPublish(replaceRun('chmod a+r .scratch/scans/*.tar', 'chmod a+r release/*.tar')))).not.toEqual([]);
    // a chmod before the last docker save does not cover the archive written after it
    expect(
      publishProblems(
        withPublish((job) =>
          replaceRun(
            'docker save "$ref"',
            'chmod a+r .scratch/scans/*.tar\n  docker save "$ref"',
          )(replaceRun(/chmod a\+r \.scratch\/scans\/\*\.tar\n/, '')(job)),
        ),
      ),
    ).not.toEqual([]);
    expect(publishProblems(withPublish(replaceRun('&& chmod 0777 .scratch/scans', '')))).not.toEqual([]);
  });

  it('EVM-007 AC2: a Docker command outside the list, a project image by tag, a manifest with another compose path, no logout, a pipe without pipefail', () => {
    expect(
      publishProblems(withPublish(replaceRun('docker save "evia-$image:candidate"', 'docker run --rm "evia-$image:candidate"'))),
    ).not.toEqual([]);
    expect(
      publishProblems(
        withPublish(replaceRun('docker tag "evia-$image:candidate" "$target"', 'docker tag x ghcr.io/konradkluz/evia-api:latest')),
      ),
    ).not.toEqual([]);
    expect(publishProblems(withPublish(replaceRun('infra/runtime/compose.staging.yaml', 'infra/runtime/other.yaml')))).not.toEqual([]);
    expect(publishProblems(withPublish(replaceRun('sha256sum release/release-manifest.json', 'sha256sum release/x.json')))).not.toEqual([]);
    expect(publishProblems(withPublish((job) => ({ ...job, steps: steps(job).slice(0, -1) })))).not.toEqual([]);
    expect(
      publishProblems(
        withPublish((job) => ({
          ...job,
          steps: steps(job).map((step) => (text(step['run']).includes('docker push') ? { ...step, shell: 'sh' } : step)),
        })),
      ),
    ).not.toEqual([]);
    expect(
      publishProblems(
        withPublish((job) => ({
          ...job,
          steps: steps(job).map((step) => (text(step['run']).includes('docker login') ? { ...step, env: {} } : step)),
        })),
      ),
    ).not.toEqual([]);
    expect(
      publishProblems(
        withPublish((job) => ({
          ...job,
          steps: steps(job).map((step) =>
            record(step['with'])['name'] === 'release-manifest' ? { ...step, with: { name: 'release-manifest', path: 'x' } } : step,
          ),
        })),
      ),
    ).not.toEqual([]);
    expect(
      publishProblems(
        withPublish((job) => ({ ...job, steps: [{ uses: 'other/action@0000000000000000000000000000000000000000' }, ...steps(job)] })),
      ),
    ).not.toEqual([]);
    expect(dockerLines('echo "$T" | docker login ghcr.io --username "$U" --password-stdin\ndocker push x | tee y')).toEqual([
      'docker login ghcr.io --username "$U" --password-stdin',
      'docker push x',
    ]);
  });

  it('EVM-007 AC2: packages: write at the workflow level or in another job', () => {
    expect(packagesWriteProblems('x.yml', { permissions: { contents: 'read', packages: 'write' }, jobs: {} })).not.toEqual([]);
    expect(packagesWriteProblems('ci.yml', { jobs: { quality: { permissions: { packages: 'write' } } } })).not.toEqual([]);
    expect(packagesWriteProblems('nightly.yml', { jobs: { publish: { permissions: { packages: 'write' } } } })).not.toEqual([]);
    expect(packagesWriteProblems('ci.yml', { jobs: { publish: { permissions: { packages: 'write' } } } })).toEqual([]);
  });

  it('EVM-007 AC2: a release Dockerfile with a base by tag, a project base, a cache mount, a secret ARG, unverified pnpm, root, an open context', () => {
    const dir = 'infra/images/api';
    const dockerfile = read(`${dir}/Dockerfile`);
    const ignore = read(`${dir}/Dockerfile.dockerignore`);
    const bad = (from: string, to: string): string[] =>
      releaseDockerfileProblems(dir, dockerfile.replace(from, to), ignore, packageManager);
    expect(
      bad('FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:', 'FROM gcr.io/distroless/nodejs26-debian13:nonroot#'),
    ).not.toEqual([]);
    expect(
      releaseDockerfileProblems(
        dir,
        `FROM ghcr.io/konradkluz/evia-api:sha-1@sha256:${'a'.repeat(64)}\n${dockerfile}`,
        ignore,
        packageManager,
      ),
    ).not.toEqual([]);
    expect(bad('RUN --mount=type=bind', 'RUN --mount=type=cache')).not.toEqual([]);
    expect(bad('ARG EVIA_RELEASE_COMMIT', 'ARG GHCR_TOKEN')).not.toEqual([]);
    expect(bad('sha512sum -c -', 'true')).not.toEqual([]);
    expect(bad('ARG PNPM_VERSION=12.8.1', 'ARG PNPM_VERSION=12.8.0')).not.toEqual([]);
    expect(bad('--frozen-lockfile --ignore-scripts --prod', '--prod')).not.toEqual([]);
    expect(bad('USER 65532:65532', 'USER root')).not.toEqual([]);
    expect(releaseDockerfileProblems(dir, dockerfile, ignore.replace(/^\*$/m, '!apps'), packageManager)).not.toEqual([]);
    expect(releaseDockerfileProblems(dir, dockerfile, `${ignore}\n!.env\n!docs/a.md\n!tools/scan`, packageManager)).not.toEqual([]);
    expect(releaseDockerfileProblems(dir, dockerfile, ignore, 'pnpm@12.8.1')).not.toEqual([]);
  });

  it('EVM-007 AC2 (staging incident): the web image must not leave file capabilities on the caddy binary it executes (cap_drop: ALL + no-new-privileges → EPERM)', () => {
    const dir = 'infra/images/web';
    const dockerfile = read(`${dir}/Dockerfile`);
    const ignore = read(`${dir}/Dockerfile.dockerignore`);
    const bad = (from: string, to: string): string[] =>
      releaseDockerfileProblems(dir, dockerfile.replace(from, to), ignore, packageManager);
    expect(bad('x', 'x')).toEqual([]);
    expect(bad('cp /tmp/caddy-orig', 'cp -a /tmp/caddy-orig')).not.toEqual([]);
    expect(bad('RUN cp ', 'RUN mv ')).not.toEqual([]);
    expect(bad('/usr/local/bin/caddy\n', '/usr/bin/caddy\n')).not.toEqual([]);
    expect(bad('CMD ["/usr/local/bin/caddy"', 'CMD ["caddy"')).not.toEqual([]);
    expect(bad('CMD ["/usr/local/bin/caddy"', 'CMD ["/usr/bin/caddy"')).not.toEqual([]);
    expect(bad('chmod 0555', 'setcap cap_net_bind_service=+ep /tmp/caddy && chmod 0555')).not.toEqual([]);
  });

  it('EVM-007 AC2 (Arm64 VM): a RUN stage of the target platform (emulation), a RUN in the final stage, production dependencies of the runner platform', () => {
    const dir = 'infra/images/api';
    const dockerfile = read(`${dir}/Dockerfile`);
    const ignore = read(`${dir}/Dockerfile.dockerignore`);
    const bad = (from: string, to: string): string[] =>
      releaseDockerfileProblems(dir, dockerfile.replace(from, to), ignore, packageManager);
    // a base by digest behind --platform is still checked
    expect(bad('FROM --platform=$BUILDPLATFORM node:26.10.0-trixie-slim@sha256:', 'FROM --platform=$BUILDPLATFORM node:26#')).not.toEqual(
      [],
    );
    expect(bad('FROM --platform=$BUILDPLATFORM node:', 'FROM node:')).not.toEqual([]);
    expect(bad('FROM --platform=$BUILDPLATFORM node:', 'FROM --platform=linux/arm64 node:')).not.toEqual([]);
    expect(bad('USER 65532:65532', 'RUN ["node", "--version"]\nUSER 65532:65532')).not.toEqual([]);
    expect(bad('FROM gcr.io/distroless', 'FROM --platform=$BUILDPLATFORM gcr.io/distroless')).not.toEqual([]);
    // a FROM with a flag but no image (and no stage name) is a base without tag and digest
    expect(bad('FROM gcr.io/distroless', 'FROM --platform=$BUILDPLATFORM\nFROM gcr.io/distroless')).not.toEqual([]);
    expect(bad('--os=linux --cpu="$cpu" --libc=glibc ', '')).not.toEqual([]);
    expect(bad('arm64) cpu=arm64', 'arm64) cpu=x64')).not.toEqual([]);
  });
});

describe('staging-verify (EVM-007 AC6; bramka 10)', () => {
  const verify = record(jobs['staging-verify']);
  const withVerify = (patch: (job: Record<string, unknown>) => Record<string, unknown>): unknown => ({
    ...ci,
    jobs: { ...jobs, 'staging-verify': patch(structuredClone(verify)) },
  });

  it('EVM-007 AC6: after publish, without secrets, contents: read only, at most 15 minutes, wait → checks → ZAP → report and the artifact', () => {
    expect(stagingVerifyProblems(ci)).toEqual([]);
    expect(verify['if']).toBe(STAGING_VERIFY_IF);
  });

  it('EVM-007 AC6: a secret, wider permissions, another trigger, a longer timeout, missing steps or no warning in publish are detected', () => {
    const secret = ['$', '{{ secrets.T }}'].join('');
    expect(stagingVerifyProblems(withVerify((job) => ({ ...job, env: { ...record(job['env']), T: secret } })))).not.toEqual([]);
    expect(stagingVerifyProblems(withVerify((job) => ({ ...job, permissions: { contents: 'read', actions: 'read' } })))).not.toEqual([]);
    expect(stagingVerifyProblems(withVerify((job) => ({ ...job, if: "needs.publish.result == 'success'" })))).not.toEqual([]);
    expect(stagingVerifyProblems(withVerify((job) => ({ ...job, needs: ['publish', 'quality'] })))).not.toEqual([]);
    expect(stagingVerifyProblems(withVerify((job) => ({ ...job, 'timeout-minutes': 30 })))).not.toEqual([]);
    expect(
      stagingVerifyProblems(
        withVerify((job) => ({ ...job, steps: steps(job).filter((step) => !text(step['run']).includes('zap-baseline')) })),
      ),
    ).not.toEqual([]);
    expect(
      stagingVerifyProblems(
        withVerify((job) => ({
          ...job,
          steps: steps(job).map((step) => (text(step['run']).includes('cli.mjs report') ? { ...step, if: 'success()' } : step)),
        })),
      ),
    ).not.toEqual([]);
    expect(
      stagingVerifyProblems(
        withVerify((job) => ({ ...job, steps: steps(job).filter((step) => !text(step['uses']).startsWith('actions/upload-artifact@')) })),
      ),
    ).not.toEqual([]);
    expect(
      stagingVerifyProblems(withVerify((job) => ({ ...job, env: { ...record(job['env']), EXPECTED_MANIFEST_SHA256: 'x' } }))),
    ).not.toEqual([]);
    expect(
      stagingVerifyProblems(
        withPublish((job) => ({ ...job, steps: steps(job).filter((step) => !text(step['run']).includes('::warning')) })),
      ),
    ).not.toEqual([]);
    expect(stagingVerifyProblems({ jobs: {} })).not.toEqual([]);
  });
});
