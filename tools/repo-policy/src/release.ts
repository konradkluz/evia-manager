/**
 * The hermetic `publish` job and the release images (EVM-007 AC2; ADR-0018 "Publikacja hermetyczna" B1a, n4; TM-112,
 * TM-113; security-engineer A4, A5; architect 18, 19) — instead of Rego, like the other workflow rules.
 */
import { list, record, text } from './files.ts';

/** The exact condition of `publish`: a push to main, a green ci-gate, a changed build input (tools/ci-changes). */
export const PUBLISH_IF =
  "github.event_name == 'push' && github.ref == 'refs/heads/main' && needs.ci-gate.result == 'success' && needs.changes.outputs.publish == 'true'";
/** Jobs that run after ci-gate and are never its dependencies (a red deployment never blocks a merge, and vice versa). */
export const POST_GATE_JOBS = Object.freeze(['publish', 'publish-infra', 'staging-verify']);
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
  problems.push(...secretScanProblems(script, where), ...secretReportUploadProblems(job, where));
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

/**
 * `packages: write` only in publish and publish-infra of ci.yml, `id-token` and `attestations` only in publish-infra, never at
 * the workflow level or in another job (AC2; EVM-124 P4).
 */
export function packagesWriteProblems(file: string, document: unknown): string[] {
  const workflow = record(document);
  const problems: string[] = [];
  const isCi = file.endsWith('ci.yml');
  const top = JSON.stringify(workflow['permissions'] ?? {});
  if (top.includes('packages')) problems.push(`${file}: packages na poziomie workflowu`);
  if (/id-token|attestations/.test(top)) problems.push(`${file}: id-token i attestations na poziomie workflowu`);
  for (const [name, value] of Object.entries(record(workflow['jobs']))) {
    const permissions = record(record(value)['permissions']);
    if ('packages' in permissions && !(isCi && (name === 'publish' || name === 'publish-infra')))
      problems.push(`${file}: job ${name}: packages wyłącznie w publish i publish-infra`);
    if (('id-token' in permissions || 'attestations' in permissions) && !(isCi && name === 'publish-infra'))
      problems.push(`${file}: job ${name}: id-token i attestations wyłącznie w publish-infra`);
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
/** The licence notice and source offer of the public images (org.opencontainers.image.documentation; ADR-0022 pt 3). */
export const RELEASE_DOCUMENTATION = `${RELEASE_SOURCE}/blob/main/infra/images/README.md`;

/**
 * A published Dockerfile (api, web) carries exactly one source label equal to the repository URL, in the last stage
 * (metadata only — no RUN, so the arm64 cross-build stays emulation-free).
 */
export function releaseLabelProblems(name: string, dockerfile: string): string[] {
  const code = dockerfile.replace(/^\s*#.*$/gm, '');
  const lastStage = code.slice(code.toUpperCase().lastIndexOf('\nFROM '));
  const key = 'org.opencontainers.image.source';
  const all = code.match(/org\.opencontainers\.image\.source=("[^"]*"|\S+)/g) ?? [];
  const inLast = [...lastStage.matchAll(/org\.opencontainers\.image\.source=/g)].length;
  const problems: string[] = [];
  if (all.length !== 1 || all[0] !== `${key}="${RELEASE_SOURCE}"`)
    problems.push(`${name}: dokładnie jedna etykieta ${key}="${RELEASE_SOURCE}"`);
  if (inLast !== 1) problems.push(`${name}: etykieta ${key} w ostatnim etapie`);
  const docKey = 'org.opencontainers.image.documentation';
  const docs = code.match(/org\.opencontainers\.image\.documentation=("[^"]*"|\S+)/g) ?? [];
  const inLastDocs = [...lastStage.matchAll(/org\.opencontainers\.image\.documentation=/g)].length;
  if (docs.length !== 1 || docs[0] !== `${docKey}="${RELEASE_DOCUMENTATION}"`)
    problems.push(`${name}: dokładnie jedna etykieta ${docKey}="${RELEASE_DOCUMENTATION}"`);
  if (inLastDocs !== 1) problems.push(`${name}: etykieta ${docKey} w ostatnim etapie`);
  return problems;
}

/** A path glob (`*` within a segment, `**` across segments) as a regular expression source. */
function globSource(path: string): string {
  return path
    .split('**')
    .map((part) =>
      part
        .split('*')
        .map((piece) => piece.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*'),
    )
    .join('.*');
}

/**
 * No upload-artifact step of a job may carry a secret scan report (trivy-secret-*.json): the report lists where a secret sits in an
 * image, so it stays in the log of the failing job only. A path matches when it names the report, a glob that matches it, or the
 * whole directory of the scans.
 */
export function secretReportUploadProblems(job: Record<string, unknown>, where: string): string[] {
  const sample = '.scratch/scans/trivy-secret-evia-api.json';
  return steps(job)
    .filter((step) => text(step['uses']).startsWith('actions/upload-artifact@'))
    .flatMap((step) => text(record(step['with'])['path']).split('\n'))
    .map((path) => path.trim())
    .filter((path) => path !== '')
    .filter((path) => {
      if (path.includes('trivy-secret')) return true;
      const glob = new RegExp(`^${globSource(path)}$`);
      return glob.test(sample) || path.replace(/\/$/, '') === '.scratch/scans' || path.replace(/\/$/, '') === '.scratch';
    })
    .map((path) => `${where}: artefakt z raportem skanu sekretów (${path}) — raport trivy-secret-* nie jest przesyłany`);
}

/**
 * Secrets of any severity in an image = red before the push (the GHCR packages are public, ADR-0022 pt 3; decision of Konrad 2026-11-13):
 * a vulnerability run (Critical/High) and an own secret run without --severity (the default covers every severity), the latter failing
 * the job (failed=1) and not uploaded as an artifact.
 */
export function secretScanProblems(script: string, where: string): string[] {
  const problems: string[] = [];
  const runs = script.match(/--scanners \S+[^\n]*/g) ?? [];
  const others = runs.filter((run) => !run.startsWith('--scanners secret ')).join('\n');
  if (!runs.some((run) => run.startsWith('--scanners vuln ')) || /--scanners [^ ]*secret/.test(others))
    problems.push(`${where}: skan podatności osobno od skanu sekretów (--scanners vuln i osobno --scanners secret)`);
  const secretRuns = runs.filter((run) => run.startsWith('--scanners secret '));
  if (secretRuns.length !== 1 || !secretRuns[0]?.includes('--exit-code 1') || /--severity/.test(secretRuns[0]))
    problems.push(`${where}: skan sekretów (--scanners secret --exit-code 1 bez --severity: każdy poziom = czerwony)`);
  if (!script.includes('trivy-secret-$name.json') || !/--scanners secret[\s\S]*?\|\| \{\s+failed=1/.test(script))
    problems.push(`${where}: sekret w obrazie = failed=1 przed pushem`);
  if (/secrets:/.test(script) || /--ignore-policy|--skip-files|--secret-config/.test(script))
    problems.push(`${where}: bez wyjątków dla sekretów w skanie obrazów`);
  return problems;
}

/** The infrastructure images built in CI (EVM-124): the order is the order of the builds, scans and pushes. */
export const INFRA_IMAGES = Object.freeze(['postgres-pgbackrest', 'media-processor']);
/** The exact condition of publish-infra: a push to main after a green ci-gate (every push — skipping unchanged inputs is out of scope). */
export const PUBLISH_INFRA_IF = "github.event_name == 'push' && github.ref == 'refs/heads/main' && needs.ci-gate.result == 'success'";
/** The only actions publish-infra may use: an OIDC token is reachable by every action of the job (K3); pinned by SHA with a version comment. */
const PUBLISH_INFRA_ACTIONS = [
  /^actions\/checkout@[0-9a-f]{40}$/,
  /^actions\/upload-artifact@[0-9a-f]{40}$/,
  /^actions\/attest-build-provenance@[0-9a-f]{40}$/,
];
/** The Docker commands publish-infra may run — nothing else. */
const PUBLISH_INFRA_DOCKER = [
  /^docker buildx build --no-cache --pull --provenance=false --sbom=false --platform linux\/arm64 /,
  /^docker image inspect --format '\{\{\.Os\}\}\/\{\{\.Architecture\}\}' "(evia-\$image:candidate|\$REGISTRY\/\$name@\$digest)"\)"$/,
  /^docker image inspect --format '\{\{json \.RepoDigests\}\}' "\$target"$/,
  /^docker save "evia-\$image:candidate" --output /,
  /^docker compose -f compose\.yaml run --rm scan-trivy-image image /,
  /^docker login ghcr\.io --username "\$GHCR_USER" --password-stdin$/,
  /^docker tag "\$name:candidate" "\$target"$/,
  /^docker push "\$target"$/,
  /^docker buildx imagetools inspect --raw "\$REGISTRY\/\$name@\$digest"$/,
  /^docker pull --platform linux\/arm64 "\$REGISTRY\/\$name@\$digest"$/,
  /^docker logout ghcr\.io$/,
];

const stepText = (step: Record<string, unknown>): string => `${text(step['run'])}\n${text(step['uses'])}`;
/** Index of the first step whose script or `uses` contains `needle` (-1 when none). */
const firstStep = (job: Record<string, unknown>, needle: string): number => steps(job).findIndex((step) => stepText(step).includes(needle));
const lastStep = (job: Record<string, unknown>, needle: string): number =>
  steps(job).findLastIndex((step) => stepText(step).includes(needle));

/**
 * The publish-infra job of ci.yml (EVM-124 AC1-AC4; security-engineer P1-P4, K1-K7, K10): trigger, permissions, native arm64
 * without emulation, hermetic (no cache, secret, foreign input or foreign action), all builds, then the platform check, the scan
 * and only then the push of both images (all or nothing), the binding of the scanned image to the digest, the attestation and the record.
 */
export function publishInfraProblems(document: unknown): string[] {
  const jobs = record(record(document)['jobs']);
  const where = 'ci.yml: publish-infra';
  if (!('publish-infra' in jobs)) return [`${where}: brak joba publish-infra`];
  const job = record(jobs['publish-infra']);
  const script = runs(job);
  const whole = JSON.stringify(job);
  const problems: string[] = [];
  if (text(job['if']) !== PUBLISH_INFRA_IF) problems.push(`${where}: wymagane if: ${PUBLISH_INFRA_IF}`);
  if (JSON.stringify(job['needs']) !== '["ci-gate"]') problems.push(`${where}: needs wyłącznie [ci-gate]`);
  if (text(job['runs-on']) !== 'ubuntu-24.04-arm') problems.push(`${where}: runs-on: ubuntu-24.04-arm (natywny arm64, bez QEMU)`);
  const timeout = job['timeout-minutes'];
  if (typeof timeout !== 'number' || timeout > 45) problems.push(`${where}: timeout-minutes ≤ 45`);
  const permissions = { contents: 'read', packages: 'write', 'id-token': 'write', attestations: 'write' };
  if (JSON.stringify(job['permissions']) !== JSON.stringify(permissions))
    problems.push(`${where}: permissions = { contents: read, packages: write, id-token: write, attestations: write }`);
  if (whole.includes('secrets.')) problems.push(`${where}: sekrety repozytorium są zabronione`);
  if (/\$\{\{\s*github\.event\./.test(whole)) problems.push(`${where}: interpolacja github.event.* (wyłącznie przez env)`);
  if (
    /--secret|--build-arg|ACTIONS_ID_TOKEN|ACTIONS_RUNTIME_TOKEN|ACTIONS_CACHE_URL|cache-from|cache-to|type=gha|--mount=type=cache/.test(
      script,
    )
  )
    problems.push(`${where}: sekret, --build-arg albo token Actions w budowie, cache buildx`);
  if (/qemu|binfmt|--platform linux\/amd64/i.test(whole)) problems.push(`${where}: emulacja (QEMU, binfmt) albo platforma amd64`);
  if (/apt(-get)? (dist-)?upgrade/.test(script)) problems.push(`${where}: apt upgrade`);
  if (/\|\| true|continue-on-error/.test(whole.replace(/failed=1/g, '')))
    problems.push(`${where}: błąd skanera albo kroku nie może być połknięty`);
  if (JSON.stringify(job['env'] ?? {}).includes('needs.')) problems.push(`${where}: wyjście innego joba w env`);
  for (const step of steps(job)) {
    const uses = text(step['uses']);
    if (uses !== '' && !PUBLISH_INFRA_ACTIONS.some((pattern) => pattern.test(uses)))
      problems.push(`${where}: akcja ${uses} spoza listy (checkout, upload-artifact, attest-build-provenance po SHA)`);
    if (JSON.stringify(step).includes('needs.')) problems.push(`${where}: wyjście innego joba jako wejście kroku`);
    if (/[^|]\|[^|]/.test(text(step['run'])) && step['shell'] !== 'bash')
      problems.push(`${where}: krok z potokiem bez shell: bash (pipefail)`);
    if (/docker push|actions\/attest-build-provenance@/.test(stepText(step)) && ('if' in step || 'continue-on-error' in step))
      problems.push(`${where}: krok push i atestacji bez if i continue-on-error`);
  }
  const checkouts = steps(job).filter((step) => text(step['uses']).startsWith('actions/checkout@'));
  if (checkouts.length !== 1 || record(checkouts[0]?.['with'])['persist-credentials'] !== false)
    problems.push(`${where}: jeden checkout z persist-credentials: false`);
  for (const line of dockerLines(script))
    if (!PUBLISH_INFRA_DOCKER.some((pattern) => pattern.test(line))) problems.push(`${where}: polecenie Docker spoza listy (${line})`);
  if (!script.includes('"$(uname -m)" != aarch64')) problems.push(`${where}: kontrola uname -m = aarch64 przed budową`);
  if (!script.includes('docker buildx build --no-cache --pull ')) problems.push(`${where}: budowa wyłącznie z --no-cache --pull`);
  for (const image of INFRA_IMAGES)
    if ((script.match(new RegExp(`for image in ${INFRA_IMAGES.join(' ')}`, 'g')) ?? []).length < 3 || !script.includes(image))
      problems.push(`${where}: obraz ${image} we wszystkich pętlach budowy, skanu i pushu`);
  if (!script.includes('infra/images/$image/Dockerfile')) problems.push(`${where}: Dockerfile z infra/images/$image/Dockerfile`);
  if (!script.includes('--severity HIGH,CRITICAL --ignore-unfixed --exit-code 1'))
    problems.push(`${where}: bramka — Critical/High z poprawką = czerwony (HIGH,CRITICAL, --ignore-unfixed, --exit-code 1)`);
  problems.push(...secretScanProblems(script, where), ...secretReportUploadProblems(job, where));
  if (!script.includes('--show-suppressed') || !script.includes('ExperimentalModifiedFindings'))
    problems.push(`${where}: skan z --show-suppressed; wyciszone znaleziska procesora = czerwony (P2)`);
  if (!script.includes('--ignorefile "$ignore"') || !script.includes('/out/trivyignore-none.yaml'))
    problems.push(`${where}: procesor skanowany bez rejestru wyjątków infrastruktury (osobny pusty --ignorefile)`);
  if (!script.includes('--format cyclonedx')) problems.push(`${where}: SBOM CycloneDX`);
  if (!script.includes('chmod a+r .scratch/scans/*.tar')) problems.push(`${where}: archiwa docker save czytelne dla skanera`);
  if (/ghcr\.io\/konradkluz\/[^"\s]*:(?!sha-)/.test(script)) problems.push(`${where}: obraz projektu po tagu innym niż sha-<commit>`);
  // all or nothing: every build, then the platform check, the scan of both, then the push, the attestations, the record
  const build = lastStep(job, 'docker buildx build');
  const platform = firstStep(job, 'not linux/arm64');
  const scan = firstStep(job, 'scan-trivy-image image');
  const push = firstStep(job, 'docker push');
  const login = firstStep(job, 'docker login');
  const attest = firstStep(job, 'actions/attest-build-provenance@');
  const lastAttest = lastStep(job, 'actions/attest-build-provenance@');
  const recorded = firstStep(job, 'infra-images-record.json');
  if (!(build >= 0 && build < platform && platform < scan && scan < push && push < attest && lastAttest < recorded))
    problems.push(`${where}: kolejność kroków: budowy, platforma, skan, push, atestacja, rekord`);
  if (login !== push) problems.push(`${where}: docker login dopiero po skanie, w kroku push`);
  const platformRun = text(steps(job)[platform]?.['run']);
  if (!/\[ "\$platform" != linux\/arm64 \]/.test(platformRun) || !platformRun.includes('is $platform, not linux/arm64'))
    problems.push(`${where}: kontrola platformy z komunikatem o platformie przed skanem`);
  const pushStep = steps(job)[push] ?? {};
  const pushRun = text(pushStep['run']);
  const pushEnv = { GHCR_TOKEN: '${{ github.token }}', GHCR_USER: '${{ github.actor }}' };
  if (JSON.stringify(pushStep['env']) !== JSON.stringify(pushEnv))
    problems.push(`${where}: logowanie do GHCR wyłącznie tokenem joba (env kroku push)`);
  if (
    !pushRun.includes('imagetools inspect --raw') ||
    !pushRun.includes('.config.digest') ||
    !pushRun.includes('[ "$config" != "$image_id" ]')
  )
    problems.push(`${where}: Metadata.ImageID ze skanu = config.digest manifestu z GHCR po digeście z pushu (P1)`);
  if (!pushRun.includes('.RepoDigests') || /grep -oE '[^']*digest:/.test(pushRun))
    problems.push(`${where}: digest publikacji z RepoDigests, nie z logu push`);
  if (
    !pushRun.includes('docker pull --platform linux/arm64 "$REGISTRY/$name@$digest"') ||
    !pushRun.includes('in GHCR is $platform, not linux/arm64')
  )
    problems.push(`${where}: platforma linux/arm64 obrazu pobranego z GHCR po digeście`);
  const attests = steps(job).filter((step) => text(step['uses']).startsWith('actions/attest-build-provenance@'));
  if (attests.length !== INFRA_IMAGES.length) problems.push(`${where}: atestacja każdego obrazu (${String(INFRA_IMAGES.length)})`);
  for (const image of INFRA_IMAGES) {
    const input = attests.map((step) => record(step['with'])).find((entry) => entry['subject-name'] === `ghcr.io/konradkluz/evia-${image}`);
    const digest = '${{ steps.push.outputs.digest-' + image + ' }}';
    if (input?.['subject-digest'] !== digest || input['push-to-registry'] !== true)
      problems.push(`${where}: atestacja evia-${image}: subject-name, subject-digest z kroku push, push-to-registry`);
  }
  const recordRun = text(steps(job)[recorded]?.['run']);
  for (const key of ['commit', 'runId', 'workflowRef', 'imageId', 'digest', 'platform'])
    if (!recordRun.includes(key)) problems.push(`${where}: rekord obrazów bez pola ${key}`);
  const uploads = steps(job)
    .filter((step) => text(step['uses']).startsWith('actions/upload-artifact@'))
    .map((step) => record(step['with']));
  const recordUpload = uploads.find((upload) => upload['name'] === 'infra-images-record');
  if (
    recordUpload?.['path'] !== 'infra-record/infra-images-record.json' ||
    recordUpload['if-no-files-found'] !== 'error' ||
    recordUpload['retention-days'] !== 90
  )
    problems.push(`${where}: artefakt infra-images-record (osobny od release-manifest, retencja 90 dni)`);
  const evidence = uploads.find((upload) => upload['name'] === 'infra-images-evidence');
  const evidencePath = text(evidence?.['path']);
  if (!evidencePath.includes('sbom-evia-') || !evidencePath.includes('trivy-image-evia-') || evidence?.['retention-days'] !== 90)
    problems.push(`${where}: artefakt SBOM i wyników skanu (retencja 90 dni)`);
  if (uploads.some((upload) => text(upload['path']).includes('release-manifest')))
    problems.push(`${where}: rekord osobny od release-manifest`);
  const logout = steps(job).at(-1);
  if (text(logout?.['run']) !== 'docker logout ghcr.io' || logout?.['if'] !== 'always()')
    problems.push(`${where}: ostatni krok: docker logout (if: always())`);
  return problems;
}

/** QEMU or binfmt anywhere in a workflow (K4: the infrastructure images are built natively). */
export function emulationProblems(file: string, raw: string): string[] {
  return /docker\/setup-qemu-action|tonistiigi\/binfmt/.test(raw) ? [`${file}: QEMU/binfmt zabronione (budowa natywna)`] : [];
}

/**
 * infra-images.json "builtImages" (EVM-124 AC6; architect 1): the images built in CI, without a digest (it comes from the CI record
 * and the attestation) — repository ghcr.io/konradkluz/evia-<name>, an existing Dockerfile and the names built by publish-infra.
 * `images` (tag + digest, pulled and scanned in publish) must not contain them.
 */
export function builtImagesProblems(document: unknown, dockerfileExists: (path: string) => boolean): string[] {
  const root = record(document);
  const built = record(root['builtImages']);
  const problems: string[] = [];
  if (JSON.stringify(Object.keys(built).sort()) !== JSON.stringify([...INFRA_IMAGES].sort()))
    problems.push(`infra-images.json: builtImages = ${INFRA_IMAGES.join(', ')} (obrazy budowane w publish-infra)`);
  for (const [name, value] of Object.entries(built)) {
    const entry = record(value);
    if (text(entry['repository']) !== `ghcr.io/konradkluz/evia-${name}`)
      problems.push(`infra-images.json: builtImages.${name}.repository = ghcr.io/konradkluz/evia-${name} (bez tagu i digestu)`);
    if (text(entry['dockerfile']) !== `infra/images/${name}/Dockerfile` || !dockerfileExists(text(entry['dockerfile'])))
      problems.push(`infra-images.json: builtImages.${name}.dockerfile = infra/images/${name}/Dockerfile (istniejący plik)`);
    if (Object.keys(entry).sort().join(',') !== 'dockerfile,repository')
      problems.push(`infra-images.json: builtImages.${name} bez digestu i innych pól`);
  }
  for (const ref of Object.values(record(root['images'])).map(text))
    if (ref.startsWith('ghcr.io/konradkluz/evia-'))
      problems.push(`infra-images.json: images bez obrazów projektu (${ref}) — digest z rekordu CI`);
  return problems;
}

/**
 * The Dockerfiles of the infrastructure images built in CI (EVM-124 AC2; security-engineer K5, K6): the apt packages at an exact
 * version (fail-closed, no range, no empty value), no unauthenticated source, no pipe into a shell, no upgrade; the processor
 * runtime without npm and corepack (RR-78); the source label of the repository on both.
 */
export function infraDockerfileProblems(name: string, dockerfile: string): string[] {
  const code = dockerfile.replace(/^\s*#.*$/gm, '');
  const where = `infra/images/${name}/Dockerfile`;
  const problems: string[] = [];
  if (/--allow-unauthenticated|\[trusted=yes\]|\bcurl\b[^\n]*\|\s*(ba)?sh|\bwget\b[^\n]*\|\s*(ba)?sh|apt(-get)? (dist-)?upgrade/.test(code))
    problems.push(`${where}: niepodpisane źródło, curl|sh albo apt upgrade`);
  if ((code.match(/org\.opencontainers\.image\.source="https:\/\/github\.com\/konradkluz\/evia-manager"/g) ?? []).length !== 1)
    problems.push(`${where}: dokładnie jedna etykieta source z adresem repozytorium`);
  if (name === 'media-processor') {
    const ffmpeg = /^ARG FFMPEG_VERSION=(\d+:[0-9][0-9.]*-[0-9][0-9a-z.+~]*)$/m.exec(code);
    if (ffmpeg === null) problems.push(`${where}: ARG FFMPEG_VERSION z dokładną wersją (epoch:wersja, bez *, >= i pustej wartości)`);
    if (!/^ARG ZLIB_VERSION=\d+:[0-9a-z.+~-]+$/m.test(code)) problems.push(`${where}: ARG ZLIB_VERSION z dokładną wersją`);
    if (!code.includes('test -n "${FFMPEG_VERSION}"')) problems.push(`${where}: test -n "\${FFMPEG_VERSION}"`);
    const runtime = code.slice(code.lastIndexOf('AS runtime'));
    const removal =
      /^RUN rm -rf [^\n]*\/usr\/local\/lib\/node_modules\/npm[^\n]*\/usr\/local\/lib\/node_modules\/corepack[^\n]*\/usr\/local\/bin\/npm[^\n]*\/usr\/local\/bin\/npx[^\n]*\/usr\/local\/bin\/corepack[^\n]*\\\n\s+&& ! command -v npm \\\n\s+&& ! command -v corepack \\\n\s+&& node --version$/m;
    if (!removal.test(runtime))
      problems.push(`${where}: runtime bez npm i corepack (rm -rf, asercje ! command -v, node --version w jednym RUN)`);
  }
  if (name === 'postgres-pgbackrest' && !/pgbackrest=\d+\.\d+\.\d+-\d+\.pgdg\d+\+\d+/.test(code))
    problems.push(`${where}: pgbackrest=<dokładna wersja>`);
  return problems;
}
