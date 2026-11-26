// @ts-check
/**
 * Image scan of bramka 6 outside the publish jobs (EVM-153 AC4, AC4b; security-engineer: parity with publish and publish-infra,
 * V15.2.1, CWE-1395). Builds the images that `publish` (evia-api, evia-web) and `publish-infra` (evia-postgres-pgbackrest,
 * evia-media-processor) would build, pulls the infrastructure images of infra/runtime/infra-images.json, checks that every one is
 * linux/arm64, and scans each with the SAME Trivy command (same service `scan-trivy-image`, same trivy.yaml, same severity,
 * --ignore-unfixed, --exit-code and ignorefile semantics) — plus the secret pass for the evia-* images. Nothing is pushed, no
 * registry login, no secret, no cache, no SBOM and no attestation; findings go to the log (rule and location only for secrets).
 * tools/repo-policy compares this module with ci.yml, so a divergence of the two gates is a red policy test.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export const PLATFORM = 'linux/arm64';
/** Release images of `publish` (built from infra/images/<name>/Dockerfile, with build arguments). */
export const RELEASE_IMAGES = Object.freeze(['api', 'web']);
/** Infrastructure images built by `publish-infra`. */
export const BUILT_IMAGES = Object.freeze(['postgres-pgbackrest', 'media-processor']);
/** The vulnerability pass of bramka 6: identical flags in publish and publish-infra (--format/--output differ per image). */
export const TRIVY_VULN_FLAGS = Object.freeze([
  '--scanners',
  'vuln',
  '--severity',
  'HIGH,CRITICAL',
  '--ignore-unfixed',
  '--exit-code',
  '1',
]);
/** The secret pass (any severity) for the images we publish. */
export const TRIVY_SECRET_FLAGS = Object.freeze(['--scanners', 'secret', '--exit-code', '1']);
export const TRIVY_BASE = Object.freeze([
  'compose',
  '-f',
  'compose.yaml',
  'run',
  '--rm',
  'scan-trivy-image',
  'image',
  '--config',
  '/src/trivy.yaml',
  '--skip-version-check',
]);
export const SCANS_DIR = '.scratch/scans';
const PLACEHOLDER_COMMIT = '0'.repeat(40);

/**
 * @typedef {{ name: string, kind: 'release' | 'built' | 'pulled', image: string, ignorefile: string | null, secret: boolean, noExceptions: boolean }} Plan
 * `ignorefile` null = the default of trivy.yaml (.trivyignore.yaml); noExceptions = the empty register of the media processor.
 */

/** Name of a pulled infrastructure image in the scan files, as in publish: `infra-<repository name>`. @param {string} ref */
export function infraName(ref) {
  return `infra-${ref.replace(/^([^/:@]+\/)*([^/:@]+).*/, '$2')}`;
}

/** The images to scan: the very list of publish + publish-infra. @param {unknown} infraImages parsed infra/runtime/infra-images.json @returns {Plan[]} */
export function planImages(infraImages) {
  const images = /** @type {{ images?: unknown } | null} */ (infraImages)?.images;
  if (typeof images !== 'object' || images === null || Array.isArray(images)) throw new Error('infra-images.json: no images');
  const refs = Object.values(/** @type {Record<string, unknown>} */ (images));
  if (refs.length === 0 || refs.some((ref) => typeof ref !== 'string' || !/@sha256:[0-9a-f]{64}$/.test(ref)))
    throw new Error('infra-images.json: every image needs a digest');
  /** @type {Plan[]} */
  const plan = [
    ...RELEASE_IMAGES.map((image) => ({
      name: `evia-${image}`,
      kind: /** @type {const} */ ('release'),
      image,
      ignorefile: null,
      secret: true,
      noExceptions: false,
    })),
    ...BUILT_IMAGES.map((image) => ({
      name: `evia-${image}`,
      kind: /** @type {const} */ ('built'),
      image,
      ignorefile: image === 'media-processor' ? '/out/trivyignore-none.yaml' : '/src/.trivyignore.yaml',
      secret: true,
      noExceptions: image === 'media-processor',
    })),
    ...refs.map((ref) => ({
      name: infraName(/** @type {string} */ (ref)),
      kind: /** @type {const} */ ('pulled'),
      image: /** @type {string} */ (ref),
      ignorefile: null,
      secret: false,
      noExceptions: false,
    })),
  ];
  const names = new Set(plan.map((item) => item.name));
  if (names.size !== plan.length) throw new Error('infra-images.json: duplicate scan names');
  return plan;
}

/** Arguments of the vulnerability pass of one image (docker compose …). @param {Plan} item */
export function vulnArgs(item) {
  const ignore =
    item.ignorefile === null
      ? []
      : item.kind === 'built'
        ? ['--ignorefile', item.ignorefile, '--show-suppressed']
        : ['--ignorefile', item.ignorefile];
  return [
    ...TRIVY_BASE,
    ...ignore,
    '--input',
    `/out/${item.name}.tar`,
    ...TRIVY_VULN_FLAGS,
    '--format',
    'json',
    '--output',
    `/out/trivy-image-${item.name}.json`,
  ];
}

/** Arguments of the secret pass of one image. @param {Plan} item */
export function secretArgs(item) {
  const ignore = item.kind === 'built' && item.ignorefile !== null ? ['--ignorefile', item.ignorefile] : [];
  return [
    ...TRIVY_BASE,
    ...ignore,
    '--skip-db-update',
    '--input',
    `/out/${item.name}.tar`,
    ...TRIVY_SECRET_FLAGS,
    '--format',
    'json',
    '--output',
    `/out/trivy-secret-${item.name}.json`,
  ];
}

/** @param {string} path @returns {unknown} */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** @param {unknown} value @returns {unknown[]} */
const array = (value) => (Array.isArray(value) ? value : []);
/** @param {unknown} value @returns {Record<string, unknown>} */
const object = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : {};

/** Lines of the findings of a vulnerability report (severity, id, package, versions, target). @param {unknown} report */
export function vulnerabilityLines(report) {
  return array(object(report)['Results']).flatMap((result) =>
    array(object(result)['Vulnerabilities']).map((item) => {
      const v = object(item);
      return `${String(v['Severity'])} ${String(v['VulnerabilityID'])} ${String(v['PkgName'])} ${String(v['InstalledVersion'])} -> ${String(v['FixedVersion'])} [${String(object(result)['Target'])}]`;
    }),
  );
}

/** Lines of a secret report: ONLY severity, rule and location — never the match (it holds a fragment of the secret). @param {unknown} report */
export function secretLines(report) {
  return array(object(report)['Results']).flatMap((result) =>
    array(object(result)['Secrets']).map((item) => {
      const s = object(item);
      return `${String(s['Severity'])} ${String(s['RuleID'])} [${String(object(result)['Target'])}:${String(s['StartLine'])}]`;
    }),
  );
}

/** Whether a report holds findings suppressed by the exception register. @param {unknown} report */
export function hasSuppressed(report) {
  return array(object(report)['Results']).some((result) => array(object(result)['ExperimentalModifiedFindings']).length > 0);
}

/**
 * @typedef {{ status: number, stdout: string }} Outcome
 * @typedef {(command: string, args: readonly string[], options?: { capture?: boolean }) => Outcome} Exec
 * @typedef {{ exec: Exec, log: (line: string) => void, env: Record<string, string | undefined>, savePlatform: boolean, only: string[] | null }} Io
 */

/**
 * @param {Io} io @param {Plan} item
 * @returns {boolean} true when the image is built/pulled, is linux/arm64 and was saved.
 */
function prepare({ exec, log, env, savePlatform }, item) {
  const archive = `${SCANS_DIR}/${item.name}.tar`;
  const tag = `evia-${item.image}:candidate`;
  const reference = item.kind === 'pulled' ? item.image : tag;
  if (item.kind === 'pulled') {
    if (exec('docker', ['pull', '--platform', PLATFORM, item.image]).status !== 0) return fail(log, `${item.name}: pull failed`);
  } else {
    const buildArgs =
      item.kind === 'release'
        ? [
            '--build-arg',
            `EVIA_RELEASE_COMMIT=${env['EVIA_RELEASE_COMMIT'] ?? env['GITHUB_SHA'] ?? PLACEHOLDER_COMMIT}`,
            '--build-arg',
            'PANEL_ORIGIN=https://panel.eviacharge.pl',
          ]
        : [];
    const built = exec('docker', [
      'buildx',
      'build',
      '--no-cache',
      '--pull',
      '--provenance=false',
      '--sbom=false',
      '--platform',
      PLATFORM,
      ...buildArgs,
      '--file',
      `infra/images/${item.image}/Dockerfile`,
      '--tag',
      tag,
      '--load',
      '.',
    ]);
    if (built.status !== 0) return fail(log, `${item.name}: build failed`);
  }
  const inspected = exec(
    'docker',
    ['image', 'inspect', ...(savePlatform ? ['--platform', PLATFORM] : []), '--format', '{{.Os}}/{{.Architecture}}', reference],
    { capture: true },
  );
  if (inspected.status !== 0 || inspected.stdout.trim() !== PLATFORM)
    return fail(log, `${item.name} is ${inspected.stdout.trim() || 'unknown'}, not ${PLATFORM}`);
  const saved = exec('docker', ['save', ...(savePlatform ? ['--platform', PLATFORM] : []), reference, '--output', archive]);
  if (saved.status !== 0) return fail(log, `${item.name}: docker save failed`);
  // docker save writes the archive 0600 owned by the runner user; the scanner runs as 65534 and only reads it.
  chmodSync(archive, 0o644);
  return true;
}

/** @param {(line: string) => void} log @param {string} message */
function fail(log, message) {
  log(`::error::bramka 6 (images-scan): ${message}`);
  return false;
}

/** The vulnerability and secret passes of one saved image. @param {Io} io @param {Plan} item @returns {boolean} true = green */
function scan({ exec, log }, item) {
  const vuln = exec('docker', vulnArgs(item));
  if (vuln.status !== 0) {
    log(`::error::bramka 6: Critical/High with a fix in ${item.name} (or a scanner error)`);
    const report = readJson(`${SCANS_DIR}/trivy-image-${item.name}.json`);
    const lines = vulnerabilityLines(report);
    if (report === null) log(`no Trivy report for ${item.name} - see the scanner log above`);
    for (const line of lines) log(line);
    return false;
  }
  if (item.noExceptions && hasSuppressed(readJson(`${SCANS_DIR}/trivy-image-${item.name}.json`))) {
    log(`::error::bramka 6: suppressed findings in ${item.name} (the processor has no exception register)`);
    return false;
  }
  if (item.secret) {
    const secrets = exec('docker', secretArgs(item));
    if (secrets.status !== 0) {
      log(`::error::bramka 6: secret in ${item.name} (or a scanner error)`);
      const report = readJson(`${SCANS_DIR}/trivy-secret-${item.name}.json`);
      if (report === null) log(`no Trivy secret report for ${item.name} - see the scanner log above`);
      for (const line of secretLines(report)) log(line);
      return false;
    }
  }
  return true;
}

/**
 * Builds/pulls and scans every planned image (all of them even after a failure). @param {Io} io @param {Plan[]} plan
 * @returns {number} exit code: 0 all green, 1 otherwise (also an unknown `only` name).
 */
export function runScan(io, plan) {
  const selected = io.only === null ? plan : plan.filter((item) => io.only?.includes(item.name));
  if (io.only !== null && selected.length !== io.only.length) {
    io.log(`::error::unknown image in --only (known: ${plan.map((item) => item.name).join(', ')})`);
    return 1;
  }
  mkdirSync(SCANS_DIR, { recursive: true });
  // The scanner container runs as 65534 and writes its reports and cache here (publish: chmod 0777 .scratch/scans).
  chmodSync(SCANS_DIR, 0o777);
  // The processor parses hostile files: its own empty exception register (as in publish-infra).
  writeFileSync(`${SCANS_DIR}/trivyignore-none.yaml`, 'vulnerabilities: []\n');
  chmodSync(`${SCANS_DIR}/trivyignore-none.yaml`, 0o644);
  let failed = 0;
  // Two passes: every image is built/pulled first and scanned afterwards. The scanner container (root-owned cache in .scratch/scans)
  // would otherwise leave an unreadable directory inside the build context of the next image ("permission denied" while sending it).
  const prepared = selected.filter((item) => {
    const ready = prepare(io, item);
    if (!ready) {
      io.log(`images-scan: ${item.name} RED`);
      failed = 1;
    }
    return ready;
  });
  for (const item of prepared) {
    const green = scan(io, item);
    io.log(`images-scan: ${item.name} ${green ? 'green' : 'RED'}`);
    if (!green) failed = 1;
  }
  return failed;
}

/** Runs the plan from the repository root files. @param {Io} io */
export function runFromRepository(io) {
  const path = 'infra/runtime/infra-images.json';
  if (!existsSync(path)) {
    io.log(`::error::${path} is missing`);
    return 1;
  }
  try {
    return runScan(io, planImages(readJson(path)));
  } catch (error) {
    io.log(`::error::${error instanceof Error ? error.message : 'unexpected error'}`);
    return 1;
  }
}
