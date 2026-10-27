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
/**
 * The platform of the VM (Hetzner Arm64 CAX; ADR-0011/ADR-0018 annotation 2026-10-21): the release images are
 * cross-built for it on the x86 runner without emulation, the infrastructure images are pulled and scanned for it.
 */
export const RELEASE_PLATFORM = 'linux/arm64';

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
  /^docker buildx build --no-cache --pull --provenance=false --sbom=false --platform linux\/arm64 /,
  /^docker image inspect --format '\{\{\.Os\}\}\/\{\{\.Architecture\}\}' "(evia-\$image:candidate|\$ref)"\)"$/,
  /^docker save /,
  /^docker pull --platform linux\/arm64 "\$ref"$/,
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
    .flatMap((line) => line.split(/\s*(?:&&|\|\||\||\$\()\s*/))
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
  if (JSON.stringify(job['permissions']) !== JSON.stringify({ contents: 'read', packages: 'write', actions: 'read' }))
    problems.push(`${where}: permissions = { contents: read, packages: write, actions: read }`);
  const retention = steps(job).find((step) => text(step['run']) === 'node tools/ghcr-retention/cli.mjs');
  if (JSON.stringify(retention?.['env']) !== JSON.stringify({ GITHUB_TOKEN: '${{ github.token }}', GHCR_RETENTION_MODE: 'dry-run' }))
    problems.push(`${where}: retencja GHCR w trybie dry-run z tokenem joba`);
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
  if ((script.match(/\[ "\$platform" != linux\/arm64 \]/g) ?? []).length !== 2)
    problems.push(`${where}: platforma ${RELEASE_PLATFORM} obrazów wydania i infrastruktury sprawdzona przed skanem`);
  if (/ghcr\.io\/konradkluz\/[^"\s]*:(?!sha-)/.test(script)) problems.push(`${where}: obraz projektu po tagu innym niż sha-<commit>`);
  const scan = script.indexOf('scan-trivy-image image');
  const push = script.indexOf('docker push');
  const login = script.indexOf('docker login');
  if (scan < 0 || push < 0 || login < 0 || scan > push || scan > login)
    problems.push(`${where}: skan obrazów (bramka 6) przed logowaniem do GHCR i wypchnięciem`);
  if (!script.includes('--severity HIGH,CRITICAL --ignore-unfixed --exit-code 1'))
    problems.push(`${where}: bramka 6 — Critical/High z poprawką = czerwony`);
  // docker save writes 0600 archives; the unprivileged scanner (65534) must be able to read them before the first scan.
  const readable = script.indexOf('chmod a+r .scratch/scans/*.tar');
  if (readable < 0 || readable < script.lastIndexOf('docker save ') || readable > scan)
    problems.push(
      `${where}: archiwa docker save czytelne dla skanera (chmod a+r .scratch/scans/*.tar po ostatnim docker save, przed skanem)`,
    );
  if (!/mkdir -p \.scratch\/scans release && chmod 0777 \.scratch\/scans/.test(script))
    problems.push(`${where}: katalog .scratch/scans zapisywalny dla skanera (chmod 0777)`);
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

/** The exact condition of staging-verify: after a successful publish, when enabled for the repository (P8). */
export const STAGING_VERIFY_IF = "needs.publish.result == 'success' && vars.STAGING_VERIFY_ENABLED == 'true'";

/**
 * staging-verify (AC6; bramka 10; security-engineer B): after publish only, no secret, contents: read only (the checkout
 * of a private repository), at most 15 minutes, the four steps of tools/staging-verify with the ZAP baseline service, the
 * result even when a check failed, and the staging-verified artifact; publish warns when it is disabled.
 */
export function stagingVerifyProblems(document: unknown): string[] {
  const jobs = record(record(document)['jobs']);
  const where = 'ci.yml: staging-verify';
  if (!('staging-verify' in jobs)) return [`${where}: brak joba`];
  const job = record(jobs['staging-verify']);
  const problems: string[] = [];
  if (text(job['if']) !== STAGING_VERIFY_IF) problems.push(`${where}: wymagane if: ${STAGING_VERIFY_IF}`);
  if (JSON.stringify(job['needs']) !== '["publish"]') problems.push(`${where}: needs wyłącznie [publish]`);
  if (JSON.stringify(job['permissions']) !== JSON.stringify({ contents: 'read' }))
    problems.push(`${where}: permissions = { contents: read }`);
  if (typeof job['timeout-minutes'] !== 'number' || job['timeout-minutes'] > 15) problems.push(`${where}: timeout-minutes ≤ 15`);
  if (JSON.stringify(job).includes('secrets.')) problems.push(`${where}: bez sekretów`);
  const env = record(job['env']);
  if (env['EXPECTED_MANIFEST_SHA256'] !== '${{ needs.publish.outputs.manifestSha256 }}' || env['EXPECTED_COMMIT'] !== '${{ github.sha }}')
    problems.push(`${where}: oczekiwany commit i manifestSha256 wyłącznie z github.sha i wyjścia publish`);
  const commands = steps(job)
    .map((step) => text(step['run']).trim())
    .filter(Boolean);
  const expected = [
    'node tools/staging-verify/cli.mjs wait',
    'node tools/staging-verify/cli.mjs checks',
    'mkdir -p .scratch/scans && chmod 0777 .scratch/scans\ndocker compose -f compose.yaml run --rm zap-baseline',
    'node tools/staging-verify/cli.mjs report',
  ];
  if (JSON.stringify(commands) !== JSON.stringify(expected)) problems.push(`${where}: kroki wait → checks → ZAP → report`);
  const report = steps(job).find((step) => text(step['run']).includes('cli.mjs report'));
  if (report?.['if'] !== 'always()') problems.push(`${where}: wynik także po czerwonej kontroli (if: always())`);
  const upload = steps(job).find((step) => text(step['uses']).startsWith('actions/upload-artifact@'));
  if (record(upload?.['with'])['name'] !== 'staging-verified') problems.push(`${where}: artefakt staging-verified`);
  const publish = steps(record(jobs['publish'])).find((step) => text(step['if']) === "vars.STAGING_VERIFY_ENABLED != 'true'");
  if (!text(publish?.['run']).includes('::warning')) problems.push(`${where}: publish ostrzega, gdy staging-verify jest wyłączony`);
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

/**
 * File capabilities on the executed binary (EVM-007; staging VM incident): the official caddy image sets
 * cap_net_bind_service=+ep on /usr/bin/caddy, and exec of it under cap_drop: ALL + no-new-privileges fails with EPERM
 * (restart loop). A Dockerfile based on caddy must run a plain copy (cp without -a drops the xattr) from
 * /usr/local/bin/caddy, never /usr/bin/caddy; an image using setcap is refused as well.
 */
function fileCapabilityProblems(name: string, code: string): string[] {
  const problems: string[] = [];
  if (/^\s*FROM\s+(--\S+\s+)*caddy[:@]/im.test(code)) {
    if (!/^\s*RUN\s.*\bcp\s+(?!-\S*a)\S+\s+\S+/im.test(code))
      problems.push(`${name}: caddy bez kopii pliku (cp bez -a) zrzucającej file capabilities`);
    if (!/^\s*COPY\s.*--from=\S+\s+\S+\s+\/usr\/local\/bin\/caddy\s*$/im.test(code))
      problems.push(`${name}: etap końcowy musi kopiować caddy do /usr/local/bin/caddy`);
    if (!/^\s*(CMD|ENTRYPOINT)\s.*\[\s*"\/usr\/local\/bin\/caddy"/im.test(code))
      problems.push(`${name}: CMD/ENTRYPOINT musi uruchamiać /usr/local/bin/caddy (bez file capabilities)`);
  }
  if (/\bsetcap\s+(?!-r)/.test(code)) problems.push(`${name}: setcap nadaje file capabilities (cap_drop: ALL → EPERM przy exec)`);
  return problems;
}

const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL)/i;

/** The image (or stage) of a FROM line, after its flags (e.g. --platform=$BUILDPLATFORM). */
const fromImage = (from: string): string =>
  from
    .trim()
    .split(/\s+/)
    .slice(1)
    .find((token) => !token.startsWith('--')) ?? '';

/**
 * Cross build for the VM platform without emulation (Arm64 VM; RELEASE_PLATFORM): every stage that runs commands is on
 * the runner platform (`--platform=$BUILDPLATFORM`, itself or through the stage it starts from), the final stage is of
 * the target platform and only copies files (no RUN), and production dependencies are installed for the target CPU
 * (pnpm --os/--cpu/--libc from TARGETARCH) — a native addon of the runner platform would fail on the VM.
 */
function crossBuildProblems(name: string, code: string): string[] {
  const problems: string[] = [];
  const parts = code.split(/^(?=[ \t]*FROM\s)/im).filter((part) => /^[ \t]*FROM\s/i.test(part));
  const onRunner = new Set<string>();
  parts.forEach((part, index) => {
    const from = part.split('\n')[0] ?? '';
    const flag = /--platform=(\S+)/.exec(from)?.[1];
    const stage = /\bAS\s+(\S+)/i.exec(from)?.[1] ?? `#${String(index)}`;
    const last = index === parts.length - 1;
    if (flag !== undefined && flag !== '$BUILDPLATFORM') problems.push(`${name}: FROM --platform wyłącznie $BUILDPLATFORM (${flag})`);
    const runner = flag === '$BUILDPLATFORM' || onRunner.has(fromImage(from));
    if (runner) onRunner.add(stage);
    const runs = /^\s*RUN\s/im.test(part);
    if (last && (runner || runs)) problems.push(`${name}: etap końcowy platformy docelowej bez RUN (budowa bez emulacji)`);
    else if (runs && !runner) problems.push(`${name}: etap ${stage} z RUN poza --platform=$BUILDPLATFORM (emulacja)`);
  });
  const production = [...code.matchAll(/pnpm install([^&\n\\]*)/g)]
    .map((match) => match[1] ?? '')
    .filter((flags) => flags.includes('--prod'));
  if (production.length > 0) {
    if (production.some((flags) => !flags.includes('--os=linux --cpu="$cpu" --libc=glibc ')))
      problems.push(`${name}: zależności produkcyjne dla platformy docelowej (--os=linux --cpu="$cpu" --libc=glibc)`);
    if (!/^\s*ARG TARGETARCH\s*$/m.test(code) || !code.includes('arm64) cpu=arm64') || !code.includes('amd64) cpu=x64'))
      problems.push(`${name}: cpu pnpm z TARGETARCH (arm64 → arm64, amd64 → x64)`);
  }
  return problems;
}

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
    const image = fromImage(from);
    if (stages.includes(image)) continue;
    if (!/^[^@\s]+:[^@\s]+@sha256:[0-9a-f]{64}$/.test(image)) problems.push(`${name}: FROM ${image} bez tagu i digestu`);
    if (image.startsWith('ghcr.io/konradkluz/')) problems.push(`${name}: obraz projektu jako warstwa bazowa`);
  }
  problems.push(...crossBuildProblems(name, code));
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
  problems.push(...fileCapabilityProblems(name, code));
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

/** The repository the published images are linked to (org.opencontainers.image.source; GHCR connects the package to it). */
export const RELEASE_SOURCE = 'https://github.com/konradkluz/evia-manager';

/**
 * A published Dockerfile (api, web) carries exactly one source label equal to the repository URL, in the last stage
 * (metadata only — no RUN, so the arm64 cross-build stays emulation-free).
 */
export function releaseLabelProblems(name: string, dockerfile: string): string[] {
  const code = dockerfile.replace(/^\s*#.*$/gm, '');
  const lastStage = code.split(/^\s*FROM\s/im).at(-1) ?? '';
  const key = 'org.opencontainers.image.source';
  const all = [...code.matchAll(/org\.opencontainers\.image\.source=("[^"]*"|\S+)/g)].map((match) => match[1] ?? '');
  const inLast = [...lastStage.matchAll(/org\.opencontainers\.image\.source=/g)].length;
  const problems: string[] = [];
  if (all.length !== 1 || all[0] !== `"${RELEASE_SOURCE}"`) problems.push(`${name}: dokładnie jedna etykieta ${key}="${RELEASE_SOURCE}"`);
  if (inLast !== 1) problems.push(`${name}: etykieta ${key} w ostatnim etapie`);
  return problems;
}
