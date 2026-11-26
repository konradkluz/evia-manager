/**
 * EVM-153 AC4, AC4b on the real workflows, plus synthetic violations proving the checkers detect them (security-engineer: parity of the scan
 * with publish and publish-infra, isolation of the job that runs the code of a pull request, fail-closed alarm of a red publication).
 */
import { describe, expect, it } from 'vitest';
import { json, read, record, text, yaml } from '../src/files.ts';
import { imagesScanProblems, nightlyWatchProblems, scanParityProblems, type ScanShape } from '../src/images.ts';
import { POST_GATE_JOBS } from '../src/release.ts';
import { BUILT_IMAGES, RELEASE_IMAGES, TRIVY_SECRET_FLAGS, TRIVY_VULN_FLAGS, planImages } from '../../image-scan/lib/scan.mjs';

const ci = record(yaml('.github/workflows/ci.yml'));
const jobs = record(ci['jobs']);
const nightly = record(yaml('.github/workflows/nightly.yml'));
const nightlyRaw = read('.github/workflows/nightly.yml');
const shape: ScanShape = {
  vulnFlags: (TRIVY_VULN_FLAGS as string[]).join(' '),
  secretFlags: (TRIVY_SECRET_FLAGS as string[]).join(' '),
  release: RELEASE_IMAGES,
  built: BUILT_IMAGES,
};
type Doc = Record<string, unknown>;
const withJob = (name: string, patch: (job: Doc) => Doc): unknown => ({
  ...ci,
  jobs: { ...jobs, [name]: patch(structuredClone(record(jobs[name]))) },
});
const nightlyWith = (name: string, patch: (job: Doc) => Doc): unknown => ({
  ...nightly,
  jobs: { ...record(nightly['jobs']), [name]: patch(structuredClone(record(record(nightly['jobs'])[name]))) },
});
const steps = (job: Doc): Doc[] => job['steps'] as Doc[];
const replaceRun = (from: string | RegExp, to: string) => (job: Doc) => ({
  ...job,
  steps: steps(job).map((step) => (typeof step['run'] === 'string' ? { ...step, run: step['run'].replace(from, to) } : step)),
});

describe('EVM-153 AC4: images-scan of ci.yml', () => {
  it('EVM-153 AC4: the real job is isolated, required by ci-gate and not an input of the publication', () => {
    expect(imagesScanProblems(ci)).toEqual([]);
    const job = record(jobs['images-scan']);
    expect(job['permissions']).toEqual({ contents: 'read' });
    expect(POST_GATE_JOBS).not.toContain('images-scan');
    expect(record(jobs['ci-gate'])['needs']).toContain('images-scan');
    expect(read('.github/workflows/ci.yml')).not.toMatch(/pull_request_target|workflow_run/);
  });

  it('EVM-153 AC4: isolation violations are reported (permissions, secrets, cache, registry, artifacts, other actions, if, needs, timeout)', () => {
    const cases: Array<[string, (job: Doc) => Doc, string]> = [
      [
        'packages write',
        (job) => ({ ...job, permissions: { contents: 'read', packages: 'write' } }),
        'permissions = { contents: read } i nic więcej',
      ],
      ['id-token', (job) => ({ ...job, permissions: { contents: 'read', 'id-token': 'write' } }), 'permissions = { contents: read }'],
      ['no permissions', (job) => ({ ...job, permissions: undefined }), 'permissions = { contents: read }'],
      ['x86 runner', (job) => ({ ...job, 'runs-on': 'ubuntu-24.04' }), 'runs-on: ubuntu-24.04-arm'],
      ['job env', (job) => ({ ...job, env: { A: 'b' } }), 'bez env'],
      ['token', (job) => ({ ...job, steps: [...steps(job), { run: 'echo ${{ github.token }}' }] }), 'bez sekretów, tokenu'],
      ['secret', (job) => ({ ...job, steps: [...steps(job), { run: 'echo ${{ secrets.X }}' }] }), 'bez sekretów, tokenu'],
      [
        'cache action',
        (job) => ({ ...job, steps: [{ uses: 'actions/cache@abc # v1', with: {} }, ...steps(job)] }),
        'zabroniona akcja actions/cache',
      ],
      [
        'setup-node',
        (job) => ({ ...job, steps: [{ uses: 'actions/setup-node@abc # v1' }, ...steps(job)] }),
        'zabroniona akcja actions/setup-node',
      ],
      ['foreign action', (job) => ({ ...job, steps: [{ uses: 'evil/action@abc # v1' }, ...steps(job)] }), 'spoza listy'],
      [
        'upload',
        (job) => ({ ...job, steps: [...steps(job), { run: 'echo upload-artifact' }] }),
        'bez logowania do rejestru, push, artefaktów i cache',
      ],
      ['login', (job) => ({ ...job, steps: [...steps(job), { run: 'docker login ghcr.io' }] }), 'bez logowania do rejestru'],
      [
        'buildx cache',
        (job) => ({ ...job, steps: [...steps(job), { run: 'docker buildx build --cache-from type=gha .' }] }),
        'bez logowania do rejestru',
      ],
      [
        'persisted credentials',
        (job) => ({ ...job, steps: [{ uses: 'actions/checkout@abc # v1', with: {} }, ...steps(job).slice(1)] }),
        'persist-credentials: false',
      ],
      [
        'continue-on-error on a step',
        (job) => ({ ...job, steps: steps(job).map((step) => ({ ...step, 'continue-on-error': true })) }),
        'kroki bez continue-on-error',
      ],
      ['continue-on-error', (job) => ({ ...job, 'continue-on-error': true }), 'bez continue-on-error'],
      ['always()', (job) => ({ ...job, if: "always() && needs.changes.outputs.images == 'true'" }), 'bez always()'],
      ['wrong if', (job) => ({ ...job, if: 'true' }), "wymagane if: needs.changes.outputs.images == 'true'"],
      ['needs of another job', (job) => ({ ...job, needs: ['changes', 'quality'] }), 'needs wyłącznie [changes]'],
      [
        'output of another job',
        (job) => ({ ...job, steps: [...steps(job), { run: 'echo ${{ needs.changes.outputs.images }}' }] }),
        'bez wyjść innych jobów',
      ],
      ['no timeout', (job) => ({ ...job, 'timeout-minutes': undefined }), 'timeout-minutes <= 60'],
      [
        'other command',
        replaceRun('node tools/image-scan/cli.mjs', 'node other.mjs'),
        'dokładnie jeden krok node tools/image-scan/cli.mjs',
      ],
      ['no architecture check', replaceRun(/uname -m/g, 'true'), 'sprawdzenie natywnej architektury'],
    ];
    for (const [name, patch, fragment] of cases)
      expect(imagesScanProblems(withJob('images-scan', patch)).join('\n'), name).toContain(fragment);
    expect(imagesScanProblems({ jobs: {} })).toEqual(['ci.yml: images-scan: brak joba images-scan']);
  });

  it('EVM-153 AC4: images-scan out of ci-gate, or its result used by a publication job, is reported', () => {
    expect(imagesScanProblems(withJob('ci-gate', (job) => ({ ...job, needs: ['changes'] }))).join('\n')).toContain(
      'ci-gate wymaga images-scan',
    );
    expect(
      imagesScanProblems(withJob('publish', (job) => ({ ...job, needs: ['changes', 'ci-gate', 'images-scan'] }))).join('\n'),
    ).toContain('wynik images-scan nie jest wejściem publish');
  });
});

describe('EVM-153 AC4: parity of tools/image-scan with publish and publish-infra', () => {
  it('EVM-153 AC4: the real scan and the two publish jobs use the same command, flags, images and ignorefile semantics', () => {
    expect(scanParityProblems(ci, shape)).toEqual([]);
    expect(shape.vulnFlags).toBe('--scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1');
    expect(shape.release).toEqual(['api', 'web']);
    expect(shape.built).toEqual(['postgres-pgbackrest', 'media-processor']);
  });

  it('EVM-153 AC4: the plan covers every image of infra-images.json and the four built images (the images of publish and publish-infra together)', () => {
    const infra = json('infra/runtime/infra-images.json');
    const plan = planImages(infra) as Array<{ name: string; image: string; kind: string }>;
    const pulled = Object.values(record(record(infra)['images'])).map(text);
    expect(plan.filter((item) => item.kind === 'pulled').map((item) => item.image)).toEqual(pulled);
    expect(plan.filter((item) => item.kind !== 'pulled').map((item) => item.name)).toEqual([
      'evia-api',
      'evia-web',
      'evia-postgres-pgbackrest',
      'evia-media-processor',
    ]);
    expect(Object.keys(record(record(infra)['builtImages']))).toEqual(shape.built);
    expect(read('trivy.yaml')).toContain('ignorefile: .trivyignore.yaml');
  });

  it('EVM-153 AC4: a divergence of the flags, the images or the naming is reported', () => {
    const cases: Array<[string, ScanShape, unknown, string]> = [
      ['severity', { ...shape, vulnFlags: shape.vulnFlags.replace('HIGH,CRITICAL', 'CRITICAL') }, ci, 'nie zawiera'],
      ['release images', { ...shape, release: ['api'] }, ci, 'publish buduje inne obrazy'],
      ['built images', { ...shape, built: ['media-processor'] }, ci, 'publish-infra buduje inne obrazy'],
      ['secret flags', { ...shape, secretFlags: '--scanners secret --severity HIGH' }, ci, 'nie zawiera'],
      [
        'ignorefile in publish',
        shape,
        withJob(
          'publish',
          replaceRun('--input "/out/$name.tar" --scanners vuln', '--ignorefile /x --input "/out/$name.tar" --scanners vuln'),
        ),
        'publish bez własnego --ignorefile',
      ],
      ['naming', shape, withJob('publish', replaceRun('name="infra-$(echo', 'name="img-$(echo')), 'nazwa obrazu infrastruktury'],
      [
        'infra list',
        shape,
        withJob('publish', replaceRun("jq -r '.images[]'", "jq -r '.other[]'")),
        'nie czyta obrazów z infra-images.json',
      ],
      ['build flags', shape, withJob('publish-infra', replaceRun('--provenance=false', '--provenance=true')), 'buduje inaczej'],
      [
        'empty processor register',
        shape,
        withJob('publish-infra', replaceRun('ignore=/out/trivyignore-none.yaml', 'ignore=/src/.trivyignore.yaml')),
        'trivyignore-none.yaml',
      ],
    ];
    for (const [name, mutated, document, fragment] of cases)
      expect(scanParityProblems(document, mutated).join('\n'), name).toContain(fragment);
  });
});

describe('EVM-153 AC4: Docker commands of tools/image-scan (A6, RR-03)', () => {
  it('EVM-153 AC4: only build, pull, image inspect, save and the compose run of scan-trivy-image — never docker run, exec, cp, login or push', () => {
    const code = read('tools/image-scan/lib/scan.mjs');
    const calls = [...code.matchAll(/exec\(\s*'docker',\s*(\[[^\]]*|vulnArgs|secretArgs)/g)].map((match) =>
      (match[1] ?? '').replace(/\s+/g, ' ').replace('[ ', '['),
    );
    expect(calls.length).toBe(6);
    for (const call of calls)
      expect(call, call).toMatch(/^(\['pull'|\['buildx', 'build'|\['image', 'inspect'|\['save'|vulnArgs|secretArgs)/);
    expect(code.replace(/\s+/g, '')).toContain(
      "TRIVY_BASE=Object.freeze(['compose','-f','compose.yaml','run','--rm','scan-trivy-image','image'",
    );
    expect(code).not.toMatch(/'(login|push|exec|cp|attest)'/);
  });
});

describe('EVM-153 AC4b: nightly.yml publish-watch and image-digests', () => {
  it('EVM-153 AC4b: the real nightly workflow is isolated, keeps its schedule line and holds actions: read only in publish-watch', () => {
    expect(nightlyWatchProblems(nightly, nightlyRaw)).toEqual([]);
    const watch = record(record(nightly['jobs'])['publish-watch']);
    expect(watch['permissions']).toEqual({ contents: 'read', actions: 'read' });
    expect(nightlyRaw).toContain("- cron: '30 2 * * *'");
  });

  it('EVM-153 AC4b: violations are reported (cron, permissions, token scope, fail-open steps, extra actions: read, a cached or privileged scan)', () => {
    const cases: Array<[string, (job: Doc) => Doc, string, string]> = [
      [
        'watch permissions',
        (job) => ({ ...job, permissions: { contents: 'read' } }),
        'publish-watch',
        'permissions = { contents: read, actions: read }',
      ],
      ['watch job env', (job) => ({ ...job, env: { GITHUB_TOKEN: 'x' } }), 'publish-watch', 'bez env, continue-on-error i needs'],
      [
        'watch token in no step',
        (job) => ({ ...job, steps: steps(job).map((step) => ({ ...step, env: undefined })) }),
        'publish-watch',
        'GITHUB_TOKEN wyłącznie w env tego kroku',
      ],
      [
        'watch continue-on-error',
        (job) => ({ ...job, steps: steps(job).map((step) => ({ ...step, 'continue-on-error': true })) }),
        'publish-watch',
        'fail-closed',
      ],
      ['watch foreign action', (job) => ({ ...job, steps: [{ uses: 'x/y@abc # v1' }, ...steps(job)] }), 'publish-watch', 'spoza listy'],
      ['watch if', (job) => ({ ...job, if: 'true' }), 'publish-watch', "if: github.ref == 'refs/heads/main'"],
      [
        'watch command',
        replaceRun('node tools/publish-watch/cli.mjs', 'true'),
        'publish-watch',
        'dokładnie jeden krok node tools/publish-watch/cli.mjs',
      ],
      [
        'digests actions: read',
        (job) => ({ ...job, permissions: { contents: 'read', actions: 'read' } }),
        'image-digests',
        'actions: read wyłącznie w jobie publish-watch',
      ],
      [
        'digests packages',
        (job) => ({ ...job, permissions: { contents: 'read', packages: 'write' } }),
        'image-digests',
        'permissions = { contents: read } i nic więcej',
      ],
      ['digests if', (job) => ({ ...job, if: undefined }), 'image-digests', "if: github.ref == 'refs/heads/main'"],
      ['digests needs', (job) => ({ ...job, needs: ['scans'] }), 'image-digests', 'bez needs'],
      [
        'digests cache',
        (job) => ({ ...job, steps: [{ uses: 'actions/cache@abc # v1' }, ...steps(job)] }),
        'image-digests',
        'zabroniona akcja actions/cache',
      ],
    ];
    for (const [name, patch, job, fragment] of cases)
      expect(nightlyWatchProblems(nightlyWith(job, patch), nightlyRaw).join('\n'), name).toContain(fragment);
    expect(nightlyWatchProblems(nightly, nightlyRaw.replace("'30 2 * * *'", "'0 3 * * *'")).join('\n')).toContain('linia cron');
    expect(nightlyWatchProblems({ ...nightly, on: { schedule: [{ cron: '0 3 * * *' }] } }, nightlyRaw).join('\n')).toContain(
      'linia cron bez zmian',
    );
    expect(nightlyWatchProblems(nightly, `${nightlyRaw}\n# \${{ github.token }}`).join('\n')).toContain('token poza krokiem');
    expect(nightlyWatchProblems({ on: {}, jobs: {} }, '').join('\n')).toContain('brak joba publish-watch');
    expect(nightlyWatchProblems({ on: {}, jobs: {} }, '').join('\n')).toContain('brak joba image-digests');
  });
});
