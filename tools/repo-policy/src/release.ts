/**
 * The hermetic `publish` job and the release images (EVM-007 AC2; ADR-0018 "Publikacja hermetyczna" B1a, n4; TM-112,
 * TM-113; security-engineer A4, A5; architect 18, 19) — instead of Rego, like the other workflow rules.
 */
import { list, record, text } from './files.ts';

/** The exact condition of `publish`: a push to main, a green ci-gate, a changed build input (tools/ci-changes). */
export const PUBLISH_IF =
  "github.event_name == 'push' && github.ref == 'refs/heads/main' && needs.ci-gate.result == 'success' && needs.changes.outputs.publish == 'true'";
/** Jobs that run after ci-gate and are never its dependencies (a red deployment never blocks a merge, and vice versa). */
export const POST_GATE_JOBS = Object.freeze(['publish', 'staging-verify']);
/** The compose file of the deployment channel — a constant of the VM configuration as well (V3, architect 7). */
export const RELEASE_COMPOSE = 'infra/runtime/compose.staging.yaml';

/** Actions or settings that bring a cache or a runtime token into the build (TM-112; A5). */
const CACHE_ACTIONS = [
  'actions/cache',
  'actions/setup-node',
  'pnpm/action-setup',
  'actions/download-artifact',
  'docker/setup-buildx-action',
  'docker/build-push-action',
  'crazy-max/ghaction-github-runtime',
];
/** The Docker commands `publish` may run — nothing else (A6 has one exception: this job). */
const PUBLISH_DOCKER = [
  /^docker buildx build --no-cache --pull --provenance=false --sbom=false /,
  /^docker save /,
  /^docker pull "\$ref"$/,
  /^docker compose -f compose\.yaml run --rm scan-trivy-image image /,
  /^docker login ghcr\.io --username "\$GHCR_USER" --password-stdin$/,
  /^docker tag /,
  /^docker push /,
  /^docker logout ghcr\.io$/,
];

const steps = (job: Record<string, unknown>): Array<Record<string, unknown>> => list(job['steps']).map(record);
const runs = (job: Record<string, unknown>): string =>
  steps(job)
    .map((step) => text(step['run']))
    .join('\n');

/** Docker command lines of a script, joined across `\` continuations. */
export function dockerLines(script: string): string[] {
  return script
    .replace(/\\\n\s*/g, ' ')
    .split('\n')
    .map((line) => line.trim().replace(/^(?:echo "\$GHCR_TOKEN" \| )/, ''))
    .flatMap((line) => line.split(/\s*(?:&&|\|\||\|)\s*/))
    .map((line) => line.trim())
    .filter((line) => /^docker\s/.test(line));
}

/**
 * The publish job of ci.yml (AC2; A4, A5; architect 18, 19): trigger and dependencies, permissions, no cache and no
 * foreign input, the image gate before the push, the manifest and the logout.
 */
export function publishProblems(document: unknown): string[] {
  const jobs = record(record(document)['jobs']);
  const where = 'ci.yml: publish';
  if (!('publish' in jobs)) return [`${where}: brak joba publish`];
  const job = record(jobs['publish']);
  const script = runs(job);
  const problems: string[] = [];
  if (text(job['if']) !== PUBLISH_IF) problems.push(`${where}: wymagane if: ${PUBLISH_IF}`);
  if (JSON.stringify(job['needs']) !== '["changes","ci-gate"]') problems.push(`${where}: needs wyłącznie [changes, ci-gate]`);
  if (JSON.stringify(job['permissions']) !== JSON.stringify({ contents: 'read', packages: 'write' }))
    problems.push(`${where}: permissions = { contents: read, packages: write }`);
  for (const step of steps(job)) {
    const uses = text(step['uses']);
    const action = CACHE_ACTIONS.find((name) => uses.startsWith(`${name}@`));
    if (action !== undefined) problems.push(`${where}: zabroniona akcja ${action} (cache albo cudze wejście budowy)`);
    if (uses !== '' && !/^actions\/(checkout|upload-artifact)@/.test(uses)) problems.push(`${where}: akcja ${uses} spoza listy`);
    const run = text(step['run']);
    if (/[^|]\|[^|]/.test(run) && step['shell'] !== 'bash') problems.push(`${where}: krok z potokiem bez shell: bash (pipefail)`);
    if (JSON.stringify(step).includes('needs.')) problems.push(`${where}: wyjście innego joba jako wejście kroku (n4)`);
  }
  if (JSON.stringify(job).includes('secrets.')) problems.push(`${where}: sekrety repozytorium są zabronione`);
  if (JSON.stringify([job['env'], job['outputs']]).includes('needs.')) problems.push(`${where}: wyjście innego joba w env (n4)`);
  if (/cache-from|cache-to|type=gha|--mount=type=cache|ACTIONS_RUNTIME_TOKEN|ACTIONS_CACHE_URL/.test(script))
    problems.push(`${where}: cache buildx albo token cache Actions`);
  for (const line of dockerLines(script))
    if (!PUBLISH_DOCKER.some((pattern) => pattern.test(line))) problems.push(`${where}: polecenie Docker spoza listy (${line})`);
  if (!/docker buildx build --no-cache --pull /.test(script)) problems.push(`${where}: budowa wyłącznie z --no-cache --pull`);
  if (/ghcr\.io\/konradkluz\/[^"\s]*:(?!sha-)/.test(script)) problems.push(`${where}: obraz projektu po tagu innym niż sha-<commit>`);
  const scan = script.indexOf('scan-trivy-image image');
  const push = script.indexOf('docker push');
  const login = script.indexOf('docker login');
  if (scan < 0 || push < 0 || login < 0 || scan > push || scan > login)
    problems.push(`${where}: skan obrazów (bramka 6) przed logowaniem do GHCR i wypchnięciem`);
  if (!script.includes('--severity HIGH,CRITICAL --ignore-unfixed --exit-code 1'))
    problems.push(`${where}: bramka 6 — Critical/High z poprawką = czerwony`);
  if (!script.includes('--format cyclonedx')) problems.push(`${where}: SBOM CycloneDX`);
  if (!script.includes('infra/runtime/infra-images.json')) problems.push(`${where}: obrazy infrastruktury w tej samej bramce`);
  if (!script.includes(`compose: "${RELEASE_COMPOSE}"`)) problems.push(`${where}: manifest ze stałą ścieżką Compose ${RELEASE_COMPOSE}`);
  if (!script.includes('sha256sum release/release-manifest.json'))
    problems.push(`${where}: manifestSha256 = SHA-256 bajtów release-manifest.json`);
  const uploads = steps(job)
    .filter((step) => text(step['uses']).startsWith('actions/upload-artifact@'))
    .map((step) => record(step['with']));
  const manifest = uploads.find((upload) => upload['name'] === 'release-manifest');
  if (manifest?.['path'] !== 'release/release-manifest.json' || manifest['if-no-files-found'] !== 'error')
    problems.push(`${where}: artefakt release-manifest (release/release-manifest.json, if-no-files-found: error)`);
  const login_ = steps(job).find((step) => text(step['run']).includes('docker login'));
  if (text(record(login_?.['env'])['GHCR_TOKEN']) !== '${{ github.token }}')
    problems.push(`${where}: logowanie do GHCR wyłącznie tokenem joba`);
  const logout = steps(job).at(-1);
  if (text(logout?.['run']) !== 'docker logout ghcr.io' || logout?.['if'] !== 'always()')
    problems.push(`${where}: ostatni krok: docker logout (if: always())`);
  return problems;
}

/** `packages: write` only in the publish job of ci.yml, never at the workflow level or in another job (AC2). */
export function packagesWriteProblems(file: string, document: unknown): string[] {
  const workflow = record(document);
  const problems: string[] = [];
  if (JSON.stringify(workflow['permissions'] ?? {}).includes('packages')) problems.push(`${file}: packages na poziomie workflowu`);
  for (const [name, value] of Object.entries(record(workflow['jobs']))) {
    const permissions = record(record(value)['permissions']);
    if ('packages' in permissions && !(file.endsWith('ci.yml') && name === 'publish'))
      problems.push(`${file}: job ${name}: packages wyłącznie w publish`);
  }
  return problems;
}

/** `download-artifact` never in a job that builds images (n4): only the coverage job downloads artifacts. */
export function downloadArtifactProblems(file: string, document: unknown): string[] {
  return Object.entries(record(record(document)['jobs'])).flatMap(([name, value]) => {
    const job = record(value);
    const downloads = steps(job).some((step) => text(step['uses']).startsWith('actions/download-artifact@'));
    return downloads && /docker (buildx )?build/.test(runs(job))
      ? [`${file}: job ${name}: download-artifact w jobie budującym obrazy`]
      : [];
  });
}

const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL)/i;

/**
 * A release Dockerfile (AC2; SR-INFRA-05; architect 18): bases by tag + digest, nothing from the project registry, no
 * cache mounts, no secret-like ARG/ENV, pnpm in the exact version and SHA-512 of "packageManager", frozen lockfile and
 * no install scripts, a non-root user; the build context is an allow-list.
 */
export function releaseDockerfileProblems(name: string, dockerfile: string, ignore: string, packageManager: string): string[] {
  const problems: string[] = [];
  const code = dockerfile.replace(/^\s*#.*$/gm, '');
  const froms = code.split('\n').filter((line) => /^\s*FROM\s/i.test(line));
  const stages = froms.map((line) => /\bAS\s+(\S+)/i.exec(line)?.[1]).filter(Boolean);
  for (const from of froms) {
    const image = from.trim().split(/\s+/)[1] ?? '';
    if (stages.includes(image)) continue;
    if (!/^[^@\s]+:[^@\s]+@sha256:[0-9a-f]{64}$/.test(image)) problems.push(`${name}: FROM ${image} bez tagu i digestu`);
    if (image.startsWith('ghcr.io/konradkluz/')) problems.push(`${name}: obraz projektu jako warstwa bazowa`);
  }
  if (/--mount=type=(cache|secret|ssh)/.test(code)) problems.push(`${name}: zabronione montaże cache/secret/ssh`);
  for (const line of code.split('\n').filter((entry) => /^\s*(ENV|ARG)\s/i.test(entry))) {
    const variable = line.trim().split(/[\s=]+/)[1] ?? '';
    if (SECRET_NAME.test(variable)) problems.push(`${name}: sekret w ${line.trim().split(/\s+/)[0] ?? ''} (${variable})`);
  }
  const [version = '', hash = ''] = (/^pnpm@([^+]+)\+sha512\.([0-9a-f]+)$/.exec(packageManager) ?? []).slice(1);
  if (!code.includes(`ARG PNPM_VERSION=${version}`) || !code.includes(`ARG PNPM_SHA512=${hash}`) || hash === '')
    problems.push(`${name}: pnpm w wersji i skrócie SHA-512 z packageManager`);
  if (!code.includes('sha512sum -c -')) problems.push(`${name}: sprawdzenie SHA-512 paczki pnpm`);
  for (const flags of [...code.matchAll(/pnpm install([^&\n\\]*)/g)].map((match) => match[1] ?? ''))
    if (!flags.includes('--frozen-lockfile') || !flags.includes('--ignore-scripts'))
      problems.push(`${name}: każde pnpm install z --frozen-lockfile i --ignore-scripts`);
  const user =
    code
      .match(/^\s*USER\s+(\S+)/gm)
      ?.at(-1)
      ?.trim()
      .split(/\s+/)[1] ?? '';
  if (['', '0', 'root', '0:0', 'root:root'].includes(user)) problems.push(`${name}: ostatnie USER inne niż root`);
  const entries = ignore
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  if (entries[0] !== '*') problems.push(`${name}.dockerignore: pierwszy wpis * (lista dozwolonych)`);
  for (const entry of entries.filter((item) => item.startsWith('!')))
    if (/(^|\/)(\.env|\.scratch|\.git|coverage|docs|\.claude|tools\/[^*])/.test(entry.slice(1)) || entry === '!.')
      problems.push(`${name}.dockerignore: niedozwolony wpis ${entry}`);
  return problems;
}
