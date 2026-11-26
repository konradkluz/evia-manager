/**
 * EVM-153 (security-engineer: SR-SUPPLY-04/05/07, SR-INFRA-14, ASVS V15.2.1, V16.3.3, CWE-1395, CWE-636): the scan of the images
 * before the merge (`images-scan` of ci.yml), its parity with the two publish jobs (a divergence = ci-gate green and publish red, the very
 * silent failure this story ends), the nightly digest scan and the nightly alarm of a red publication (`publish-watch` of nightly.yml).
 */
import { list, record, text } from './files.ts';
import { CACHE_ACTIONS, POST_GATE_JOBS, dockerLines } from './release.ts';

export const IMAGES_SCAN_IF = "needs.changes.outputs.images == 'true'";
export const IMAGES_SCAN_COMMAND = 'node tools/image-scan/cli.mjs';
export const NIGHTLY_CRON = '30 2 * * *';

const steps = (job: Record<string, unknown>): Array<Record<string, unknown>> => list(job['steps']).map(record);
const script = (job: Record<string, unknown>): string =>
  steps(job)
    .map((step) => text(step['run']))
    .join('\n');

/** The checks shared by the two jobs that run the scan outside publish: least privilege, no cache, no secret, no registry, no foreign output. */
function isolationProblems(where: string, job: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (JSON.stringify(job['permissions']) !== JSON.stringify({ contents: 'read' }))
    problems.push(`${where}: permissions = { contents: read } i nic więcej`);
  if (job['runs-on'] !== 'ubuntu-24.04-arm') problems.push(`${where}: runs-on: ubuntu-24.04-arm (natywny linux/arm64, bez emulacji)`);
  for (const key of ['env', 'services', 'container', 'environment', 'outputs', 'strategy', 'continue-on-error'])
    if (key in job) problems.push(`${where}: bez ${key}`);
  const all = JSON.stringify(job);
  if (/secrets\.|github\.token|GITHUB_TOKEN|id-token|attestations|packages/.test(all))
    problems.push(`${where}: bez sekretów, tokenu, id-token, attestations i packages`);
  if (JSON.stringify(job['steps']).includes('needs.')) problems.push(`${where}: bez wyjść innych jobów w krokach`);
  if (text(job['if']).includes('always()')) problems.push(`${where}: bez always()`);
  const run = script(job);
  for (const step of steps(job)) {
    const uses = text(step['uses']);
    if (uses !== '' && !uses.startsWith('actions/checkout@'))
      problems.push(`${where}: akcja ${uses} spoza listy (wyłącznie actions/checkout)`);
    for (const action of CACHE_ACTIONS) if (uses.startsWith(`${action}@`)) problems.push(`${where}: zabroniona akcja ${action}`);
    if (
      uses.startsWith('actions/checkout@') &&
      (record(step['with'])['persist-credentials'] !== false || Object.keys(record(step['with'])).length !== 1)
    )
      problems.push(`${where}: checkout wyłącznie z persist-credentials: false`);
    if ('continue-on-error' in step || 'env' in step) problems.push(`${where}: kroki bez continue-on-error i env`);
  }
  if (
    /docker (login|push)|upload-artifact|download-artifact|cache-from|cache-to|type=gha|--mount=type=cache|ACTIONS_RUNTIME_TOKEN|ACTIONS_CACHE_URL/.test(
      all,
    )
  )
    problems.push(`${where}: bez logowania do rejestru, push, artefaktów i cache`);
  if (steps(job).filter((step) => text(step['run']) === IMAGES_SCAN_COMMAND).length !== 1)
    problems.push(`${where}: dokładnie jeden krok ${IMAGES_SCAN_COMMAND}`);
  if (run.includes('pull_request_target')) problems.push(`${where}: bez pull_request_target`);
  return problems;
}

/**
 * ci.yml `images-scan` (AC4): the exact condition, `needs: [changes]` only, a timeout, the isolation above, a required dependency of ci-gate and
 * never an input of the publication (not in POST_GATE_JOBS, not in the needs of publish, publish-infra or staging-verify).
 */
export function imagesScanProblems(document: unknown): string[] {
  const jobs = record(record(document)['jobs']);
  const where = 'ci.yml: images-scan';
  if (!('images-scan' in jobs)) return [`${where}: brak joba images-scan`];
  const job = record(jobs['images-scan']);
  const problems = isolationProblems(where, job);
  if (text(job['if']) !== IMAGES_SCAN_IF) problems.push(`${where}: wymagane if: ${IMAGES_SCAN_IF}`);
  if (JSON.stringify(job['needs']) !== '["changes"]') problems.push(`${where}: needs wyłącznie [changes]`);
  if (typeof job['timeout-minutes'] !== 'number' || job['timeout-minutes'] > 60) problems.push(`${where}: timeout-minutes <= 60`);
  if (POST_GATE_JOBS.includes('images-scan')) problems.push(`${where}: nie jest jobem po ci-gate`);
  if (!list(record(jobs['ci-gate'])['needs']).includes('images-scan')) problems.push(`${where}: ci-gate wymaga images-scan (needs)`);
  for (const name of POST_GATE_JOBS)
    if (list(record(jobs[name])['needs']).includes('images-scan') || JSON.stringify(record(jobs[name])).includes('images-scan'))
      problems.push(`${where}: wynik images-scan nie jest wejściem ${name}`);
  if (!steps(job).some((step) => text(step['run']).includes('uname -m')))
    problems.push(`${where}: sprawdzenie natywnej architektury aarch64 przed budową`);
  return problems;
}

export type ScanShape = {
  /** TRIVY_VULN_FLAGS of tools/image-scan joined by spaces. */
  vulnFlags: string;
  secretFlags: string;
  release: readonly string[];
  built: readonly string[];
};

/**
 * Parity of the scan with `publish` and `publish-infra` (security-engineer, threat 1): the same Trivy command and flags, the same
 * service, config and ignorefile semantics, the same lists of images and the same naming of the pulled infrastructure images.
 */
export function scanParityProblems(document: unknown, shape: ScanShape): string[] {
  const jobs = record(record(document)['jobs']);
  const publish = script(record(jobs['publish']));
  const infra = script(record(jobs['publish-infra']));
  const problems: string[] = [];
  const both: Array<[string, string]> = [
    ['publish', publish],
    ['publish-infra', infra],
  ];
  for (const [name, code] of both) {
    for (const needle of [
      `scan-trivy-image image --config /src/trivy.yaml --skip-version-check`,
      shape.vulnFlags,
      shape.secretFlags,
      '--format json --output "/out/trivy-image-$name.json"',
      '--skip-db-update --input "/out/$name.tar"',
    ])
      if (!code.includes(needle)) problems.push(`parytet skanu: ${name} nie zawiera „${needle}” (tools/image-scan musi być zgodne)`);
  }
  if (!publish.includes(`for image in ${shape.release.join(' ')}; do`))
    problems.push(`parytet skanu: publish buduje inne obrazy niż ${shape.release.join(', ')}`);
  if (!infra.includes(`for image in ${shape.built.join(' ')}; do`))
    problems.push(`parytet skanu: publish-infra buduje inne obrazy niż ${shape.built.join(', ')}`);
  if (!publish.includes("jq -r '.images[]' infra/runtime/infra-images.json"))
    problems.push('parytet skanu: publish nie czyta obrazów z infra-images.json');
  if (!publish.includes(`name="infra-$(echo "$ref" | sed -E 's#^([^/:@]+/)*([^/:@]+).*#\\2#')"`))
    problems.push('parytet skanu: nazwa obrazu infrastruktury w publish różni się od infraName() w tools/image-scan');
  for (const needle of [
    '--ignorefile "$ignore" --show-suppressed',
    'ignore=/src/.trivyignore.yaml',
    'ignore=/out/trivyignore-none.yaml',
    "printf 'vulnerabilities: []\\n'",
  ])
    if (!infra.includes(needle)) problems.push(`parytet skanu: publish-infra nie zawiera „${needle}”`);
  if (publish.includes('--ignorefile')) problems.push('parytet skanu: publish bez własnego --ignorefile (domyślny z trivy.yaml)');
  for (const [name, code] of both) {
    for (const line of dockerLines(code))
      if (line.includes('scan-trivy-image') && /\bdocker run\b/.test(line))
        problems.push(`parytet skanu: ${name}: wyłącznie docker compose run`);
    if (!code.includes('docker buildx build --no-cache --pull --provenance=false --sbom=false --platform linux/arm64'))
      problems.push(
        `parytet skanu: ${name} buduje inaczej niż tools/image-scan (--no-cache --pull --provenance=false --sbom=false --platform linux/arm64)`,
      );
  }
  return problems;
}

/** The names of the jobs that hold `actions: read` in a workflow. */
const actionsReaders = (jobs: Record<string, unknown>): string[] =>
  Object.entries(jobs)
    .filter(([, value]) => 'actions' in record(record(value)['permissions']))
    .map(([name]) => name);

/**
 * nightly.yml (AC4b): the schedule line is unchanged (the e-mail about a red scheduled run goes to the person who last changed it), `image-digests`
 * is isolated like images-scan, and `publish-watch` is the only job with `actions: read`, with GITHUB_TOKEN set only on its step and no other action but checkout.
 */
export function nightlyWatchProblems(document: unknown, raw: string): string[] {
  const workflow = record(document);
  const jobs = record(workflow['jobs']);
  const problems: string[] = [];
  const schedule = list(record(workflow['on'])['schedule']).map(record);
  if (schedule.length !== 1 || schedule[0]?.['cron'] !== NIGHTLY_CRON) problems.push(`nightly.yml: linia cron bez zmian (${NIGHTLY_CRON})`);
  if (!/^\s+- cron: '30 2 \* \* \*'$/m.test(raw)) problems.push('nightly.yml: linia cron musi pozostać bez zmian');
  const digests = record(jobs['image-digests']);
  if (!('image-digests' in jobs)) problems.push('nightly.yml: brak joba image-digests');
  else {
    problems.push(...isolationProblems('nightly.yml: image-digests', digests));
    if (text(digests['if']) !== "github.ref == 'refs/heads/main'")
      problems.push("nightly.yml: image-digests: if: github.ref == 'refs/heads/main'");
    if ('needs' in digests) problems.push('nightly.yml: image-digests bez needs');
  }
  const watch = record(jobs['publish-watch']);
  const where = 'nightly.yml: publish-watch';
  if (!('publish-watch' in jobs)) problems.push(`${where}: brak joba publish-watch`);
  else {
    if (JSON.stringify(watch['permissions']) !== JSON.stringify({ contents: 'read', actions: 'read' }))
      problems.push(`${where}: permissions = { contents: read, actions: read }`);
    if (text(watch['if']) !== "github.ref == 'refs/heads/main'") problems.push(`${where}: if: github.ref == 'refs/heads/main'`);
    if ('env' in watch || 'continue-on-error' in watch || 'needs' in watch)
      problems.push(`${where}: bez env, continue-on-error i needs na poziomie joba`);
    const watchSteps = steps(watch);
    const runStep = watchSteps.filter((step) => text(step['run']) === 'node tools/publish-watch/cli.mjs');
    if (runStep.length !== 1) problems.push(`${where}: dokładnie jeden krok node tools/publish-watch/cli.mjs`);
    if (JSON.stringify(runStep[0]?.['env']) !== JSON.stringify({ GITHUB_TOKEN: '${{ github.token }}' }))
      problems.push(`${where}: GITHUB_TOKEN wyłącznie w env tego kroku`);
    if (watchSteps.some((step) => 'continue-on-error' in step || text(step['if']) !== ''))
      problems.push(`${where}: kroki bez if i continue-on-error (fail-closed)`);
    for (const step of watchSteps) {
      const uses = text(step['uses']);
      if (uses !== '' && !uses.startsWith('actions/checkout@')) problems.push(`${where}: akcja ${uses} spoza listy`);
    }
    if (
      JSON.stringify(watchSteps.filter((step) => 'env' in step).map((step) => text(step['run']))) !== '["node tools/publish-watch/cli.mjs"]'
    )
      problems.push(`${where}: env wyłącznie w kroku publish-watch`);
  }
  if (JSON.stringify(actionsReaders(jobs)) !== '["publish-watch"]')
    problems.push('nightly.yml: actions: read wyłącznie w jobie publish-watch');
  if (/github\.token|GITHUB_TOKEN/.test(raw.replace(/\n\s+env:\n\s+GITHUB_TOKEN: \$\{\{ github\.token \}\}/, '')))
    problems.push('nightly.yml: token poza krokiem publish-watch');
  return problems;
}
