// @ts-check
/**
 * Gate decisions from scanner JSON reports (EVM-006 AC4, AC5; bramki 1, 2, 4, 5, 5a; security-engineer A4).
 * The gate is decided here, not by scanner exit codes: an empty scan target or a malformed report fails, and the
 * output names rules and files only — never secret values (gitleaks runs with --redact as well).
 */
import { evaluateOsv } from './osv.mjs';

/** @typedef {{ passed: boolean, summary: string, problems: string[] }} Verdict */

/** @param {unknown} value @returns {Record<string, unknown>} */
const record = (value) => (typeof value === 'object' && value !== null ? /** @type {Record<string, unknown>} */ (value) : {});
/** @param {unknown} value @returns {unknown[]} */
const list = (value) => (Array.isArray(value) ? value : []);
/** @param {unknown} value */
const text = (value) => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');

/**
 * Allowed licenses of distributed components (requirements.md → bramka 4, with OFL-1.1 for the panel fonts).
 * Exceptions only through .trivyignore.yaml (licenses: id, statement, expired_at).
 */
export const ALLOWED_LICENSES = Object.freeze([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'MPL-2.0',
  'Zlib',
  'CC0-1.0',
  'Unlicense',
  'BlueOak-1.0.0',
  'Python-2.0',
  'CC-BY-4.0',
  'OFL-1.1',
]);

/**
 * SPDX expression check: `A OR B` needs one allowed alternative, `A AND B` needs all.
 * @param {string} expression
 */
export function licenseAllowed(expression) {
  const clean = expression.replace(/[()]/g, ' ').trim();
  if (/\sOR\s/i.test(clean)) return clean.split(/\s+OR\s+/i).some(licenseAllowed);
  if (/\sAND\s/i.test(clean)) return clean.split(/\s+AND\s+/i).every(licenseAllowed);
  return ALLOWED_LICENSES.includes(clean);
}

/**
 * gitleaks (`--report-format json`): every finding blocks. In git mode the log must report scanned commits.
 * @param {unknown} report
 * @param {{ log?: string, requireCommits?: boolean }} [options]
 * @returns {Verdict}
 */
export function gitleaksVerdict(report, { log = '', requireCommits = false } = {}) {
  if (!Array.isArray(report)) return { passed: false, summary: 'brak poprawnego raportu JSON', problems: [] };
  const commits = Number(/(\d+) commits scanned/.exec(log)?.[1] ?? '0');
  if (requireCommits && commits === 0) return { passed: false, summary: 'pusty cel skanu (0 commitów)', problems: [] };
  const problems = report.map(record).map((finding) => {
    const commit = text(finding['Commit']).slice(0, 12);
    return `${text(finding['RuleID'])} · ${text(finding['File'])}:${text(finding['StartLine'])}${commit ? ` · commit ${commit}` : ''}`;
  });
  const scope = requireCommits ? `${commits} commitów` : 'katalog';
  return { passed: problems.length === 0, summary: `${scope}, wykrycia: ${problems.length}`, problems };
}

/** Our own Semgrep rules always block (ids `evm-…`). */
const OWN_RULE = /(?:^|\.)evm-[a-z0-9-]+$/;

/**
 * Semgrep (`--json`): ERROR findings and our own rules block; tool errors and an empty target fail.
 * @param {unknown} report
 * @returns {Verdict}
 */
export function semgrepVerdict(report) {
  const data = record(report);
  if (!Array.isArray(data['results'])) return { passed: false, summary: 'brak poprawnego raportu JSON', problems: [] };
  const scanned = list(record(data['paths'])['scanned']).length;
  const errors = list(data['errors'])
    .map(record)
    .filter((error) => text(error['level']) === 'error')
    .map((error) => `błąd narzędzia: ${text(error['type'])} ${text(error['message']).split('\n')[0] ?? ''}`.trim());
  const results = data['results'].map(record);
  const blocking = results.filter((result) => {
    const id = text(result['check_id']);
    return OWN_RULE.test(id) || text(record(result['extra'])['severity']) === 'ERROR';
  });
  const problems = [
    ...errors,
    ...blocking.map((result) => `${text(result['check_id'])} · ${text(result['path'])}:${text(record(result['start'])['line'])}`),
  ];
  if (scanned === 0) return { passed: false, summary: 'pusty cel skanu (0 plików)', problems };
  return {
    passed: problems.length === 0,
    summary: `${scanned} plików, ustalenia: ${results.length} (blokujące: ${blocking.length})`,
    problems,
  };
}

/**
 * OSV-Scanner: threshold from osv.mjs; zero packages means an empty or broken scan.
 * @param {unknown} report
 * @returns {Verdict}
 */
export function osvVerdict(report) {
  const { packages, findings } = evaluateOsv(report);
  if (packages === 0) return { passed: false, summary: 'pusty cel skanu (0 pakietów)', problems: [] };
  const blocking = findings.filter((finding) => finding.blocking);
  const problems = blocking.map(
    (finding) =>
      `${finding.ids.join(' / ')} · ${finding.package} · ${finding.malicious ? 'pakiet złośliwy' : `ważność ${finding.severity}, poprawka dostępna`}`,
  );
  return {
    passed: problems.length === 0,
    summary: `${packages} pakietów, podatności: ${findings.length} (blokujące: ${blocking.length}; pozostałe — raport)`,
    problems,
  };
}

/**
 * Trivy `config`: HIGH and CRITICAL misconfigurations block; the scan must have seen a Dockerfile.
 * @param {unknown} report
 * @returns {Verdict}
 */
export function trivyConfigVerdict(report) {
  const results = list(record(report)['Results']).map(record);
  if (!results.some((result) => text(result['Target']).endsWith('Dockerfile'))) {
    return { passed: false, summary: 'pusty cel skanu (brak Dockerfile w wyniku)', problems: [] };
  }
  const failures = results.flatMap((result) =>
    list(result['Misconfigurations'])
      .map(record)
      .filter((item) => text(item['Status']) === 'FAIL')
      .map((item) => ({ target: text(result['Target']), id: text(item['ID']), severity: text(item['Severity']) })),
  );
  const blocking = failures.filter((item) => item.severity === 'HIGH' || item.severity === 'CRITICAL');
  return {
    passed: blocking.length === 0,
    summary: `${results.length} plików, ustalenia: ${failures.length} (blokujące: ${blocking.length})`,
    problems: blocking.map((item) => `${item.id} (${item.severity}) · ${item.target}`),
  };
}

/**
 * Trivy `--scanners license`: every license outside the allow-list blocks, and so does an unknown license — a pnpm
 * package without any license (requirements.md → bramka 4; security-engineer review of EVM-006: Trivy reports no
 * license finding for such a package, so it is judged from the package list). The scan must have read a pnpm lockfile
 * with packages. Exceptions: only .trivyignore.yaml → licenses (by license name, with expired_at) — Trivy cannot bind a
 * license exception to a package, so an unknown license has no exception; such a dependency needs a story.
 * @param {unknown} report
 * @returns {Verdict}
 */
export function trivyLicenseVerdict(report) {
  const results = list(record(report)['Results']).map(record);
  const pnpm = results.filter((result) => text(result['Type']) === 'pnpm');
  if (pnpm.length === 0) {
    return { passed: false, summary: 'pusty cel skanu (brak pnpm-lock.yaml i node_modules)', problems: [] };
  }
  const packages = pnpm.flatMap((result) => list(result['Packages']).map(record));
  if (packages.length === 0) return { passed: false, summary: 'pusty cel skanu (0 pakietów pnpm)', problems: [] };
  const licenses = results.flatMap((result) => list(result['Licenses']).map(record));
  const violations = licenses.filter((license) => !licenseAllowed(text(license['Name'])));
  const licensed = new Set(licenses.map((license) => text(license['PkgName'])));
  const unknown = [
    ...new Set(
      packages
        .filter((pkg) => !list(pkg['Licenses']).some((name) => text(name).trim() !== '') && !licensed.has(text(pkg['Name'])))
        .map((pkg) => `${text(pkg['Name'])}@${text(pkg['Version'])}`),
    ),
  ];
  return {
    passed: violations.length === 0 && unknown.length === 0,
    summary: `pakiety: ${packages.length}, licencje: ${licenses.length} (spoza listy dozwolonych: ${violations.length}, nieznane: ${unknown.length})`,
    problems: [
      ...violations.map((license) => `${text(license['Name'])} · ${text(license['PkgName'])}`),
      ...unknown.map((name) => `licencja nieznana · ${name}`),
    ],
  };
}

/**
 * zizmor (`--format json`): every finding from severity low up blocks (the threshold is applied by the CLI).
 * @param {unknown} report
 * @returns {Verdict}
 */
export function zizmorVerdict(report) {
  if (!Array.isArray(report)) return { passed: false, summary: 'brak poprawnego raportu JSON', problems: [] };
  const findings = report.map(record).filter((finding) => finding['ignored'] !== true);
  const problems = findings.map((finding) => {
    const symbolic = record(record(list(finding['locations'])[0])['symbolic']);
    const file = text(record(record(symbolic['key'])['Local'])['verbatim_path']);
    return `${text(finding['ident'])} (${text(record(finding['determinations'])['severity'])}) · ${file}`;
  });
  return { passed: problems.length === 0, summary: `ustalenia: ${problems.length}`, problems };
}

/**
 * actionlint (`-format '{{json .}}'`): every error blocks.
 * @param {unknown} report
 * @returns {Verdict}
 */
export function actionlintVerdict(report) {
  if (!Array.isArray(report)) return { passed: false, summary: 'brak poprawnego raportu JSON', problems: [] };
  const problems = report
    .map(record)
    .map((error) => `${text(error['kind'])} · ${text(error['filepath'])}:${text(error['line'])} · ${text(error['message'])}`);
  return { passed: problems.length === 0, summary: `błędy: ${problems.length}`, problems };
}
